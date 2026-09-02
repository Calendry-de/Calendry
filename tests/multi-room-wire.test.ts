import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput } from '../server/utils/solverInput';
import { sessionsOverRoomCap, toWireSession } from '../server/utils/solverSessions';
import { MAX_WIRE_ROOMS_PER_SESSION } from '../shared/solverBudget';

/**
 * A Session occupying more than one Room, both directions across the wire.
 *
 * The app has always been able to store several Rooms on a Session; the wire
 * carried one, so `assembleSolverInput` flattened to the first and COUNTED the
 * rest as dropped. The solver reasoned about a Session occupying less Room than
 * it really did, and would place something else in the Room that was dropped.
 *
 * `Session.room_ids` closes that, and the convention is the sharp part: EMPTY
 * for an ordinary single-Room Session, because `room_id` alone is already the
 * complete answer and `partition_sessions` reads a non-empty list as
 * authoritative. A one-element echo is not "more correct": it is a second
 * spelling of one state, and the encoded bytes feed `inputHash`.
 *
 * The report moved rather than retired. Beyond `MAX_WIRE_ROOMS_PER_SESSION` the
 * solver TRUNCATES, warn-and-allow, and says nothing on the wire about having
 * done so, which is the old failure again, one cap higher.
 */
let f: Fixtures;

const ROOMS = ['test-mr-room-1', 'test-mr-room-2', 'test-mr-room-3', 'test-mr-room-4', 'test-mr-room-5'];

beforeAll(async () => {
    f = await seed();

    await ownerDb.room.createMany({
        data: ROOMS.map((id, n) => ({
            id, tenantId: f.tenantA, code: `MR${n + 1}`, name: `Multi ${n + 1}`, capacity: 50,
        })),
    });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
});

async function setRooms(sessionId: string, roomIds: string[]) {
    await ownerDb.sessionRoom.deleteMany({ where: { sessionId } });

    if (roomIds.length) {
        await ownerDb.sessionRoom.createMany({
            data: roomIds.map((roomId) => ({ sessionId, roomId, tenantId: f.tenantA })),
        });
    }
}

const wireSession = async () => (await assemble()).input.existingSessions
    .find((s) => s.id === f.sessionA)!;

describe('the wire convention', () => {
    it('leaves room_ids EMPTY for an ordinary single-Room Session', async () => {
        await setRooms(f.sessionA, [ROOMS[0]!]);

        const s = await wireSession();

        expect(s.roomId).toBe(ROOMS[0]);
        // Not `[ROOMS[0]]`: `room_id` is already the complete answer, and a
        // one-element echo is a second spelling of one state.
        expect(s.roomIds).toEqual([]);
    });

    it('sends the FULL set, primary included, for a multi-Room Session', async () => {
        await setRooms(f.sessionA, [ROOMS[0]!, ROOMS[1]!]);

        const s = await wireSession();

        // `partition_sessions` derives its extras by filtering `room_id` out of
        // this list, so omitting the primary would lose a Room rather than
        // deduplicate one.
        expect(s.roomIds).toContain(s.roomId);
        expect([...s.roomIds].sort()).toEqual([ROOMS[0], ROOMS[1]].sort());
    });

    it('changes the input hash, so the extra Room is really in the problem', async () => {
        // The assertion that a wrong implementation cannot fake: if the second
        // Room never reached the encoded message, these two would hash alike.
        await setRooms(f.sessionA, [ROOMS[0]!]);
        const one = (await assemble()).inputHash;

        await setRooms(f.sessionA, [ROOMS[0]!, ROOMS[1]!]);
        const two = (await assemble()).inputHash;

        expect(two).not.toBe(one);
    });
});

describe('the cap report', () => {
    const row = (roomIds: string[]) => ({
        id: 's', tenantId: f.tenantA, federationId: null, offeringId: 'o', kindKey: 'k',
        termWeek: 1, dayOfWeek: 1, blockIndex: 0, durationBlocks: 1,
        roomIds, lecturerIds: [], groupIds: [], personIds: [], isLocked: false,
    });

    it('says nothing at the cap and names a Session past it', () => {
        // Both directions, so the report cannot pass by naming everything or
        // nothing. Four fit: one primary plus MAX_ADDITIONAL_ROOMS extras.
        expect(sessionsOverRoomCap([row(ROOMS.slice(0, MAX_WIRE_ROOMS_PER_SESSION))])).toEqual([]);
        expect(sessionsOverRoomCap([row(ROOMS.slice(0, MAX_WIRE_ROOMS_PER_SESSION + 1))])).toEqual(['s']);
    });

    it('still sends the over-cap Session rather than dropping it', () => {
        // Warn and allow: the solver truncates and places it, so withholding it
        // here would turn a partially-known occupancy into no occupancy at all.
        expect(toWireSession(row(ROOMS)).roomIds).toHaveLength(ROOMS.length);
    });
});
