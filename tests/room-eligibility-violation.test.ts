import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { refreshViolations } from '../server/utils/violations';

/**
 * `no_session_outside_allowed_room` (issue #123): the manual-edit half of the
 * room pin and the online mode.
 *
 * WARN, DON'T BLOCK (TAXONOMY.md §3). The solver enforces the restriction
 * absolutely — an ineligible Room is simply never chosen — but a person
 * dragging a Session on the grid can put it wherever they like, and the
 * restriction they break was set on a different page, possibly by someone else.
 * A refusal would be wrong (the edit may be exactly what a Friday afternoon
 * needs) and silence would be worse, so it becomes queryable state.
 *
 * THE SAME RESOLUTION AS THE WIRE, deliberately: both go through
 * `resolveRoomRestriction`, so "the solver would not place it here" and "the UI
 * warns about it here" cannot become different questions. The case that proves
 * it is the virtual Room under `FORBIDDEN`, which `byRoom` (the collision map)
 * excludes on purpose and which this rule must still see.
 */
let f: Fixtures;
let virtualRoom = '';
let otherRoom = '';
let sessionId = '';

beforeAll(async () => {
    f = await seed();

    virtualRoom = (await ownerDb.room.create({
        data: { tenantId: f.tenantA, code: 'ONLINE', name: 'Virtual', capacity: 0, isVirtual: true },
    })).id;
    otherRoom = (await ownerDb.room.create({
        data: { tenantId: f.tenantA, code: 'B202', name: 'Lab', capacity: 40 },
    })).id;

    // Hand-seeded rather than provisioned, matching the other violation
    // suites: this fixture never runs `provisionTenant`, so no default
    // constraint rows exist.
    await ownerDb.constraint.create({
        data: {
            tenantId: f.tenantA, type: 'no_session_outside_allowed_room',
            name: 'Rooms the offering allows', severity: 'HARD', isDefault: true, isEnabled: true,
        },
    });

    sessionId = f.sessionA;
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

beforeEach(async () => {
    await ownerDb.offeringRoom.deleteMany({ where: { offeringId: 'test-offering-a' } });
    await ownerDb.offering.update({
        where: { id: 'test-offering-a' }, data: { onlineMode: 'FORBIDDEN' },
    });
    await ownerDb.sessionRoom.deleteMany({ where: { sessionId } });
    await ownerDb.sessionRoom.create({
        data: { tenantId: f.tenantA, sessionId, roomId: f.roomPrivateA },
    });
});

const refresh = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return refreshViolations(tx as never, { tenantId: f.tenantA, sessionIds: [sessionId] });
});

const violations = async () => {
    await refresh();

    return ownerDb.constraintViolation.findMany({ where: { tenantId: f.tenantA, sessionId } });
};

const putInto = async (roomId: string) => {
    await ownerDb.sessionRoom.deleteMany({ where: { sessionId } });
    await ownerDb.sessionRoom.create({ data: { tenantId: f.tenantA, sessionId, roomId } });
};

describe('an offering with no restriction', () => {
    it('warns about nothing, wherever the session sits', async () => {
        await putInto(otherRoom);

        expect(await violations()).toEqual([]);
    });
});

describe('a room pin', () => {
    it('warns when a manual move lands outside it, naming the room', async () => {
        await ownerDb.offeringRoom.create({
            data: { tenantId: f.tenantA, offeringId: 'test-offering-a', roomId: f.roomPrivateA },
        });
        await putInto(otherRoom);

        const rows = await violations();

        expect(rows).toHaveLength(1);
        expect(rows[0]?.severity).toBe('HARD');
        // HARD, so no penalty: the database CHECK ties the two together.
        expect(rows[0]?.penalty).toBeNull();
        expect(rows[0]?.detail).toMatchObject({
            reason: 'room_outside_allowed_set',
            onlineMode: 'FORBIDDEN',
            roomIds: [otherRoom],
        });
    });

    it('clears the warning when the session moves back inside', async () => {
        await ownerDb.offeringRoom.create({
            data: { tenantId: f.tenantA, offeringId: 'test-offering-a', roomId: f.roomPrivateA },
        });
        await putInto(otherRoom);
        await refresh();

        await putInto(f.roomPrivateA);

        expect(await violations()).toEqual([]);
    });
});

describe('the online mode', () => {
    it('warns when a required-online session is moved into a physical room', async () => {
        await ownerDb.offering.update({
            where: { id: 'test-offering-a' }, data: { onlineMode: 'REQUIRED' },
        });
        await putInto(otherRoom);

        const rows = await violations();

        expect(rows).toHaveLength(1);
        expect(rows[0]?.detail).toMatchObject({ onlineMode: 'REQUIRED', roomIds: [otherRoom] });
    });

    it('is satisfied by the virtual room', async () => {
        await ownerDb.offering.update({
            where: { id: 'test-offering-a' }, data: { onlineMode: 'REQUIRED' },
        });
        await putInto(virtualRoom);

        expect(await violations()).toEqual([]);
    });

    it('sees a virtual room under FORBIDDEN, which the collision map deliberately does not', async () => {
        // `byRoom` drops virtual rooms, because two sessions in one virtual room
        // do not collide. Reusing it here would have made this breach — the one
        // an all-in-person offering most obviously commits — structurally
        // invisible.
        await putInto(virtualRoom);

        const rows = await violations();

        expect(rows).toHaveLength(1);
        expect(rows[0]?.detail).toMatchObject({ onlineMode: 'FORBIDDEN', roomIds: [virtualRoom] });
    });
});
