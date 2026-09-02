import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput } from '../server/utils/solverInput';
import { NO_ELIGIBLE_ROOM_ID, resolveRoomRestriction } from '../server/utils/offeringRooms';

/**
 * `offering_room` and `Offering.onlineMode` (issue #123): who narrows the set
 * of Rooms a placement may use, and how the narrowing reaches the wire.
 *
 * WHAT IS ACTUALLY AT RISK HERE, and it is not "the column saves".
 *
 * The two features write the SAME wire field, `Offering.allowed_room_ids`,
 * whose EMPTY value means "any eligible Room". So the naive mapping of "must be
 * online, and there is no virtual room" is an empty list, which the solver
 * reads as its exact opposite: place it anywhere. Every Session lands in a
 * physical room, the run reports no violation, and nothing anywhere says the
 * tenant's instruction was discarded. That is the failure this file exists to
 * make impossible, and it is why the assertions below are about the REPORT
 * ENTRY as much as about the wire.
 *
 * The second risk is composition. A pin and `REQUIRED` INTERSECT: not "pin
 * wins", not "online wins". An Offering pinned to two lecture halls and marked
 * online-only is a contradiction somebody typed, and the honest answer is an
 * empty intersection — reported, never sent as "anywhere".
 */
let f: Fixtures;
let virtualRoom: string;
let smallRoom: string;
let bigRoom: string;

const OFFERING = 'test-offering-a';

beforeAll(async () => {
    f = await seed();

    virtualRoom = (await ownerDb.room.create({
        data: { tenantId: f.tenantA, code: 'ONLINE', name: 'Virtual', capacity: 0, isVirtual: true },
    })).id;
    smallRoom = (await ownerDb.room.create({
        data: { tenantId: f.tenantA, code: 'S1', name: 'Seminar', capacity: 8 },
    })).id;
    bigRoom = (await ownerDb.room.create({
        data: { tenantId: f.tenantA, code: 'H1', name: 'Hall', capacity: 200 },
    })).id;
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

beforeEach(async () => {
    await ownerDb.offeringRoom.deleteMany({ where: { offeringId: OFFERING } });
    await ownerDb.offering.update({
        where: { id: OFFERING },
        data: { onlineMode: 'FORBIDDEN', requiredCapacity: null, requiredRoomCount: 1 },
    });
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
});

const wire = async () => {
    const { input, report } = await assemble();

    return { offering: input.offerings.find((o) => o.id === OFFERING)!, report };
};

const pin = (...roomIds: string[]) => ownerDb.offeringRoom.createMany({
    data: roomIds.map((roomId) => ({ tenantId: f.tenantA, offeringId: OFFERING, roomId })),
});

const setMode = (onlineMode: 'FORBIDDEN' | 'ALLOWED' | 'REQUIRED') => ownerDb.offering.update({
    where: { id: OFFERING }, data: { onlineMode },
});

describe('an offering with no restriction of its own', () => {
    it('still sends an EMPTY allow-list, exactly as before this feature', async () => {
        // The whole feature has to be a no-op for every Offering that predates
        // it. Empty means "any eligible Room" on the wire; sending anything
        // else here would silently re-scope every existing timetable.
        const { offering, report } = await wire();

        expect(offering.allowedRoomIds).toEqual([]);
        expect(offering.allowOnline).toBe(false);
        expect(report.offeringsWithUnsatisfiableRoomRestriction).toEqual([]);
        expect(report.pinnedRoomsNotSent).toEqual([]);
    });

    it('sends allowOnline for ALLOWED without narrowing the rooms', async () => {
        await setMode('ALLOWED');

        const { offering } = await wire();

        // ALLOWED is a PERMISSION: virtual rooms join the physical ones rather
        // than replacing them, so there is still no allow-list to send.
        expect(offering.allowOnline).toBe(true);
        expect(offering.allowedRoomIds).toEqual([]);
    });
});

describe('a room pin', () => {
    it('reaches the wire as the allow-list, replacing the hardcoded empty one', async () => {
        await pin(bigRoom, smallRoom);

        const { offering } = await wire();

        expect([...offering.allowedRoomIds].sort()).toEqual([bigRoom, smallRoom].sort());
    });

    it('drops a room that is not sent, and REPORTS the drop rather than shrinking quietly', async () => {
        await ownerDb.room.update({ where: { id: smallRoom }, data: { isActive: false } });
        await pin(bigRoom, smallRoom);

        const { offering, report } = await wire();

        expect(offering.allowedRoomIds).toEqual([bigRoom]);
        expect(report.pinnedRoomsNotSent).toEqual([
            { id: OFFERING, title: 'Databases', roomId: smallRoom, reason: 'inactive' },
        ]);

        await ownerDb.room.update({ where: { id: smallRoom }, data: { isActive: true } });
    });

    it('reports a pin smaller than the offering needs at once', async () => {
        await ownerDb.offering.update({ where: { id: OFFERING }, data: { requiredRoomCount: 2 } });
        await pin(bigRoom);

        const { report } = await wire();

        // A DEFINITE impossibility, and one `offeringsNeedingMoreRoomsThanExist`
        // cannot see: the tenant has plenty of rooms, this offering may use one.
        expect(report.offeringsWithRestrictionBelowRoomCount).toEqual([
            { id: OFFERING, title: 'Databases', available: 1, needs: 2 },
        ]);
        expect(report.offeringsNeedingMoreRoomsThanExist).toEqual([]);
    });

    it('reports a pin whose only room is too small, rather than only sending it', async () => {
        await ownerDb.offering.update({ where: { id: OFFERING }, data: { requiredCapacity: 120 } });
        await pin(smallRoom);

        const { offering, report } = await wire();

        // The wire is still honest: the tenant said this room, so this room is
        // sent. What must not happen is the mismatch going unnamed, because the
        // run comes back with a slot-shaped violation and the cause (somebody
        // raised the capacity weeks after somebody else pinned the room) is
        // unguessable from it.
        expect(offering.allowedRoomIds).toEqual([smallRoom]);
        expect(report.offeringsWithNoSuitablePinnedRoom).toEqual([{
            id: OFFERING,
            title: 'Databases',
            reason: 'capacity',
            available: 1,
            minCapacity: 120,
            bestCapacity: 8,
        }]);
    });

    it('says nothing when the pinned room does fit', async () => {
        await ownerDb.offering.update({ where: { id: OFFERING }, data: { requiredCapacity: 120 } });
        await pin(bigRoom);

        expect((await wire()).report.offeringsWithNoSuitablePinnedRoom).toEqual([]);
    });
});

describe('online mode REQUIRED', () => {
    it('derives the allow-list from Room.isVirtual, never from a stored list', async () => {
        await setMode('REQUIRED');

        const { offering } = await wire();

        expect(offering.allowedRoomIds).toEqual([virtualRoom]);
        expect(offering.allowOnline).toBe(true);
    });

    it('picks up a virtual room created after the offering was set to REQUIRED', async () => {
        await setMode('REQUIRED');

        const second = await ownerDb.room.create({
            data: { tenantId: f.tenantA, code: 'ONLINE2', name: 'Virtual 2', capacity: 0, isVirtual: true },
        });

        // THE REASON THE LIST IS NEVER PERSISTED. A stored list would exclude
        // this room from every offering that had already asked for "online",
        // and nothing would ever say so.
        expect([...(await wire()).offering.allowedRoomIds].sort()).toEqual([virtualRoom, second.id].sort());

        await ownerDb.room.delete({ where: { id: second.id } });
    });

    it('INTERSECTS with a pin rather than letting either side win', async () => {
        await setMode('REQUIRED');
        await pin(virtualRoom, bigRoom);

        const { offering, report } = await wire();

        // Not `[virtualRoom, bigRoom]` ("pin wins") and not every virtual room
        // ("online wins"): the intersection, which here is one room.
        expect(offering.allowedRoomIds).toEqual([virtualRoom]);
        expect(report.offeringsWithUnsatisfiableRoomRestriction).toEqual([]);
    });
});

/**
 * THE SINGLE MOST IMPORTANT CASE IN THE TICKET.
 *
 * Every assertion here is about the REPORT, and the wire assertion is
 * deliberately `not.toEqual([])`: an empty allow-list is the one value that
 * means the opposite of what the tenant asked for.
 */
describe('a restriction nothing can satisfy', () => {
    it('never sends an empty allow-list for a contradictory pin, and reports the contradiction', async () => {
        await setMode('REQUIRED');
        await pin(bigRoom, smallRoom);

        const { offering, report } = await wire();

        expect(offering.allowedRoomIds).not.toEqual([]);
        expect(offering.allowedRoomIds).toEqual([NO_ELIGIBLE_ROOM_ID]);
        expect(report.offeringsWithUnsatisfiableRoomRestriction).toEqual([{
            id: OFFERING,
            title: 'Databases',
            reason: 'empty_intersection',
            pinnedStored: 2,
            pinnedInSnapshot: 2,
            virtualInSnapshot: 1,
        }]);
    });

    it('reports REQUIRED with no virtual room at all, rather than widening to every room', async () => {
        await ownerDb.room.update({ where: { id: virtualRoom }, data: { isActive: false } });
        await setMode('REQUIRED');

        const { offering, report } = await wire();

        expect(offering.allowedRoomIds).not.toEqual([]);
        expect(report.offeringsWithUnsatisfiableRoomRestriction).toEqual([{
            id: OFFERING,
            title: 'Databases',
            reason: 'no_virtual_rooms',
            pinnedStored: 0,
            pinnedInSnapshot: 0,
            virtualInSnapshot: 0,
        }]);

        await ownerDb.room.update({ where: { id: virtualRoom }, data: { isActive: true } });
    });

    it('reports a pin whose every room has gone, rather than widening to every room', async () => {
        await pin(smallRoom);
        await ownerDb.room.update({ where: { id: smallRoom }, data: { isActive: false } });

        const { offering, report } = await wire();

        expect(offering.allowedRoomIds).not.toEqual([]);
        expect(report.offeringsWithUnsatisfiableRoomRestriction[0]).toMatchObject({
            id: OFFERING,
            reason: 'pinned_rooms_absent',
            pinnedStored: 1,
            pinnedInSnapshot: 0,
        });

        await ownerDb.room.update({ where: { id: smallRoom }, data: { isActive: true } });
    });
});

/**
 * The composition rules as a pure unit, with no database in the way. The suites
 * above prove they are reached; this one pins what they SAY, including the two
 * cases the wire cannot distinguish on its own.
 */
describe('resolveRoomRestriction, directly', () => {
    const rooms = [
        { id: 'v1', isVirtual: true },
        { id: 'p1', isVirtual: false },
        { id: 'p2', isVirtual: false },
    ];

    it('leaves an unrestricted offering unrestricted on the wire', () => {
        const r = resolveRoomRestriction({ onlineMode: 'ALLOWED', pinnedRoomIds: [] }, rooms);

        expect(r.allowedRoomIds).toEqual([]);
        expect(r.permittedRoomIds).toBeNull();
        expect(r.failure).toBeNull();
    });

    it('narrows a manual placement for FORBIDDEN while still sending an empty allow-list', () => {
        // The one case where the wire and the manual-edit answer differ, and
        // deliberately: `allow_online = false` carries it on the wire, but
        // `violations.ts` has no such flag and needs the room set.
        const r = resolveRoomRestriction({ onlineMode: 'FORBIDDEN', pinnedRoomIds: [] }, rooms);

        expect(r.allowedRoomIds).toEqual([]);
        expect(r.allowOnline).toBe(false);
        expect(r.permittedRoomIds).toEqual(['p1', 'p2']);
    });

    it('treats a pin naming only a virtual room under FORBIDDEN as unsatisfiable', () => {
        const r = resolveRoomRestriction({ onlineMode: 'FORBIDDEN', pinnedRoomIds: ['v1'] }, rooms);

        expect(r.allowedRoomIds).toEqual([NO_ELIGIBLE_ROOM_ID]);
        expect(r.failure?.reason).toBe('empty_intersection');
    });
});
