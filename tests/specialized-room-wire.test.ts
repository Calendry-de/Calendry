import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';
import { assembleSolverInput, toWireConstraint } from '../server/utils/solverInput';
import { findConstraintType } from '../shared/constraintTypes';
import { manageEntities } from '../app/utils/manageRegistry';
import { englishT } from './helpers/manageMessages';

/**
 * `Room.isSpecialized` and `minimize_specialized_room_use` (issue #121).
 *
 * Room eligibility is a SUPERSET filter, so an ordinary lecture can take the
 * computer lab. The proto's `Room.is_specialized` and the solver's
 * `MinimizeSpecializedRoomUse` had shipped and this app hardcoded
 * `isSpecialized: false` with a comment saying so. Three boundaries are pinned:
 * the column reaches the wire, the constraint reaches the wire, and the flag is
 * reachable through the generic CRUD route and the Room form.
 */
let f: Fixtures;
let adminCookie = '';

beforeAll(async () => {
    f = await seed();
    adminCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA, now: new Date() });
});

describe('the flag on the wire', () => {
    it('defaults to false, which is the proto\'s documented no-op', async () => {
        const { input } = await assemble();
        const room = input.rooms.find((r) => r.id === f.roomPrivateA);

        expect(room).toBeDefined();
        expect(room!.isSpecialized).toBe(false);
    });

    it('travels as true once set, without touching rank', async () => {
        await ownerDb.room.update({ where: { id: f.roomPrivateA }, data: { isSpecialized: true, ranking: 0 } });

        const { input } = await assemble();
        const room = input.rooms.find((r) => r.id === f.roomPrivateA)!;

        // A separate axis: MinimizeRoomRank.invert reads rank the other way
        // round, so a lab must never be spelled as a high rank.
        expect(room.isSpecialized).toBe(true);
        expect(room.rank).toBe(0);

        await ownerDb.room.update({ where: { id: f.roomPrivateA }, data: { isSpecialized: false } });
    });
});

describe('the constraint', () => {
    it('is a SOFT, parameterless, solver-owned rule sent as an empty variant with its weight', () => {
        const type = findConstraintType('minimize_specialized_room_use')!;

        expect(type.severity).toBe('SOFT');
        expect(type.params).toEqual([]);
        expect(type.evaluator).toBe('solver');

        const result = toWireConstraint(
            { id: 'c', type: type.key, severity: 'SOFT', weight: 7, params: {}, scopes: [] },
            new Map<string, string>(),
        );
        const config = (result as { config: Record<string, unknown> }).config;

        expect(config.minimizeSpecializedRoomUse).toEqual({});
        expect(config.weight).toBe(7);
    });
});

describe('reachability', () => {
    it('is accepted by the generic room PATCH and read back', async () => {
        const res = await api<{ isSpecialized: boolean }>(`/api/rooms/${f.roomPrivateA}`, {
            method: 'PATCH', cookie: adminCookie, body: JSON.stringify({ isSpecialized: true }),
        });

        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.isSpecialized).toBe(true);

        await ownerDb.room.update({ where: { id: f.roomPrivateA }, data: { isSpecialized: false } });
    });

    it('has a form field, or the column is unreachable from the UI', () => {
        const field = manageEntities(englishT)
            .find((entity) => entity.key === 'rooms')!
            .fields.find((field) => field.key === 'isSpecialized');

        expect(field).toBeDefined();
        expect(field!.type).toBe('boolean');
        // The help text must name the constraint that reads it and separate it
        // from ranking, since nothing else in the form can.
        expect(field!.help).toContain('ranking');
    });
});
