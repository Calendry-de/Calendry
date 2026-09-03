import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';
import { assembleSolverInput, footprintTag } from '../server/utils/solverInput';
import { manageEntities } from '../app/utils/manageRegistry';
import { englishT } from './helpers/manageMessages';

/**
 * Shared footprints (issue #122), reworked from free-text tags into PAIRS of
 * Rooms (`room_footprint`, edited as the `rooms/footprint` relation).
 *
 * Pinned at four boundaries:
 *
 *  - the relation is SYMMETRIC by trigger: written from one Room, it reads
 *    complete from the other, and clearing it from either side clears both;
 *  - the wire derives one `footprint_tags` entry per pair, carried by exactly
 *    its two Rooms, so the solver's non-transitive expansion sees what the
 *    pairs say (the hall pairs with each part; the parts do not pair);
 *  - the write refuses a self-pair and a virtual Room on either end with a
 *    field-level 422, and refuses making a paired Room virtual, the database
 *    trigger being the backstop for a write that bypasses the route;
 *  - the Room form offers the relation as a searchable room picker scoped to
 *    exclude the room itself.
 */
let f: Fixtures;
let adminCookie = '';
/** A second tenant-A room, so a pair has two ends the admin may write. */
let hallId = '';

beforeAll(async () => {
    f = await seed();
    adminCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;

    const hall = await api<{ id: string }>('/api/rooms', {
        method: 'POST',
        cookie: adminCookie,
        body: JSON.stringify({ code: 'HALL', name: 'The hall the parts form', capacity: 90 }),
    });

    expect(hall.status, JSON.stringify(hall.body)).toBe(201);
    hallId = hall.body.id;
});

afterEach(async () => {
    await ownerDb.roomFootprint.deleteMany({ where: { roomId: { in: [f.roomPrivateA, hallId] } } });
    await ownerDb.room.update({ where: { id: f.roomPrivateA }, data: { isVirtual: false } });
});

afterAll(async () => {
    await ownerDb.room.deleteMany({ where: { id: hallId } });
    await teardown();
    await ownerDb.$disconnect();
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA, now: new Date() });
});

const putFootprint = (roomId: string, otherRoomIds: string[]) => api<Record<string, unknown>>(
    `/api/rooms/${roomId}/footprint`,
    { method: 'PUT', cookie: adminCookie, body: JSON.stringify(otherRoomIds.map((otherRoomId) => ({ otherRoomId }))) },
);

const getFootprint = (roomId: string) => api<{ otherRoomId: string }[]>(
    `/api/rooms/${roomId}/footprint`,
    { cookie: adminCookie },
);

describe('the relation is symmetric', () => {
    it('written from the hall, it reads complete from the part', async () => {
        const res = await putFootprint(hallId, [f.roomPrivateA]);

        expect(res.status, JSON.stringify(res.body)).toBe(200);

        const fromPart = await getFootprint(f.roomPrivateA);

        expect(fromPart.body.map((row) => row.otherRoomId)).toEqual([hallId]);
    });

    it('cleared from the part, it is gone from the hall too', async () => {
        await putFootprint(hallId, [f.roomPrivateA]);

        const cleared = await putFootprint(f.roomPrivateA, []);

        expect(cleared.status).toBe(200);
        expect((await getFootprint(hallId)).body).toEqual([]);
    });
});

describe('the wire', () => {
    it('sends no tags by default: the proto\'s documented "no footprint blocking"', async () => {
        const { input } = await assemble();

        expect(input.rooms.find((r) => r.id === f.roomPrivateA)!.footprintTags).toEqual([]);
    });

    it('derives one tag per pair, carried by exactly its two rooms', async () => {
        await putFootprint(hallId, [f.roomPrivateA]);

        const { input } = await assemble();
        const tag = footprintTag(hallId, f.roomPrivateA);

        expect(input.rooms.find((r) => r.id === hallId)!.footprintTags).toEqual([tag]);
        expect(input.rooms.find((r) => r.id === f.roomPrivateA)!.footprintTags).toEqual([tag]);

        // Non-transitivity is a property of what the tag DOESN'T say: no other
        // room carries it, so nothing else is blocked by a booking of either.
        const carriers = input.rooms.filter((r) => r.footprintTags.includes(tag)).map((r) => r.id).sort();

        expect(carriers).toEqual([hallId, f.roomPrivateA].sort());
    });

    it('derives the same tag from either end', () => {
        expect(footprintTag('b', 'a')).toBe(footprintTag('a', 'b'));
    });
});

describe('the write boundary', () => {
    it('refuses pairing a room with itself, naming the field', async () => {
        const res = await putFootprint(hallId, [hallId]);

        expect(res.status).toBe(422);
        expect(JSON.stringify(res.body)).toContain('otherRoomId');
        // Rolled back, not half-applied.
        expect((await getFootprint(hallId)).body).toEqual([]);
    });

    it('refuses a VIRTUAL room on the other end, before the trigger would', async () => {
        await ownerDb.room.update({ where: { id: f.roomPrivateA }, data: { isVirtual: true } });

        const res = await putFootprint(hallId, [f.roomPrivateA]);

        expect(res.status).toBe(422);
        expect(JSON.stringify(res.body)).toContain('otherRoomId');
    });

    it('refuses making a paired room virtual, the other half of the same rule', async () => {
        await putFootprint(hallId, [f.roomPrivateA]);

        const res = await api<Record<string, unknown>>(`/api/rooms/${f.roomPrivateA}`, {
            method: 'PATCH', cookie: adminCookie, body: JSON.stringify({ isVirtual: true }),
        });

        expect(res.status).toBe(422);
        expect(JSON.stringify(res.body)).toContain('isVirtual');
    });

    it('the database is the backstop for a write that bypasses the route', async () => {
        await ownerDb.room.update({ where: { id: f.roomPrivateA }, data: { isVirtual: true } });

        await expect(ownerDb.roomFootprint.create({
            data: { roomId: hallId, otherRoomId: f.roomPrivateA, tenantId: f.tenantA },
        })).rejects.toThrow();

        await expect(ownerDb.roomFootprint.create({
            data: { roomId: hallId, otherRoomId: hallId, tenantId: f.tenantA },
        })).rejects.toThrow();
    });
});

describe('the form', () => {
    it('offers the footprint as a searchable room picker that excludes the room itself', () => {
        const relation = manageEntities(englishT)
            .find((entity) => entity.key === 'rooms')!
            .relations!.find((def) => def.key === 'footprint');

        expect(relation).toBeDefined();
        expect(relation!.resource).toBe('rooms');
        expect(relation!.valueKey).toBe('otherRoomId');
        expect(relation!.searchable).toBe(true);
        expect(relation!.scopeBy).toEqual({ filter: 'excludeId', from: 'id' });
        // The question the tag model could only answer in prose is answered
        // in the help: it does not matter which side you add it from.
        expect(relation!.help).toContain('either side');
    });

    it('the exclusion is a real filter the list route honours', async () => {
        const res = await api<{ rows: { id: string }[] }>(`/api/rooms?excludeId=${hallId}&limit=200`, { cookie: adminCookie });

        expect(res.status).toBe(200);
        expect(res.body.rows.map((row) => row.id)).not.toContain(hallId);
        expect(res.body.rows.map((row) => row.id)).toContain(f.roomPrivateA);
    });
});
