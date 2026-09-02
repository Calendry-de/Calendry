import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput, toWireConstraint } from '../server/utils/solverInput';
import { CONSTRAINT_TYPES } from '../shared/constraintTypes';
import { RESOURCES } from '../server/utils/resources';
import { UNBOUNDED_ROOM_CAPACITY } from '../shared/rooms';

/**
 * Two narrowings that both happen on the way to the wire, because the wire
 * cannot express either of them.
 *
 * A CONSTRAINT'S TIMEGRID. `SolverInput.time_grid` is SINGULAR: a run is
 * per-Term and a Term has exactly one grid, so the solver never sees two grids
 * and a `time_grid_id` on `ConstraintConfig` would have nothing to
 * disambiguate. An institution with a 45-minute academic grid and a 60-minute
 * evening one still means different numbers by "three consecutive blocks", so
 * the filter has to be applied while assembling.
 *
 * A ROOM'S UNLIMITED CAPACITY. `Room.capacity` is a `uint32` compared with
 * `room.capacity >= min_capacity`, and there is no value meaning "no limit". 0
 * fails that comparison against any real demand, so the column's own DEFAULT
 * made every unmeasured room ineligible for everything.
 */
let f: Fixtures;

beforeAll(async () => {
    f = await seed();
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const row = (timeGridId: string | null) => ({
    id: 'c1',
    type: 'compactness',
    severity: 'SOFT',
    weight: 5,
    params: { scope: 'group' },
    scopes: [],
    timeGridId,
});

describe('a constraint scoped to a TimeGrid', () => {
    it('is sent when it names the grid this run uses', () => {
        const mapped = toWireConstraint(row('grid-a'), new Map(), undefined, 'grid-a');

        expect('config' in mapped).toBe(true);
    });

    it('is WITHHELD when it names a different grid', () => {
        const mapped = toWireConstraint(row('grid-b'), new Map(), undefined, 'grid-a');

        expect('skip' in mapped).toBe(true);
        expect((mapped as { skip: string }).skip).toContain('TimeGrid');
    });

    it('is sent on every grid when it names none', () => {
        // NULL means every grid, matching every other optional scope here, and
        // it is what every row meant before the column existed.
        expect('config' in toWireConstraint(row(null), new Map(), undefined, 'grid-a')).toBe(true);
        expect('config' in toWireConstraint(row(null), new Map(), undefined, 'grid-b')).toBe(true);
    });

    it('is sent when the caller names no grid, rather than being dropped', () => {
        // `violations.ts` and the tests call `toWireConstraint` without a run
        // grid. Treating that as "matches nothing" would silently drop every
        // grid-scoped rule from those paths.
        expect('config' in toWireConstraint(row('grid-b'), new Map())).toBe(true);
    });

    it('is accepted at the write boundary, and nullable', () => {
        expect(() => RESOURCES.constraints!.update!.parse({ timeGridId: 'grid-a' })).not.toThrow();
        expect(() => RESOURCES.constraints!.update!.parse({ timeGridId: null })).not.toThrow();
    });

    it('narrows the real assembly, end to end', async () => {
        const other = await ownerDb.timeGrid.create({
            data: {
                tenantId: f.tenantA, name: 'Evening grid', blockLengthMinutes: 60,
                blocksPerDay: 4, activeDays: [1, 2, 3], startHour: 18, startMinute: 0,
            },
        });

        // Created, not found: the fixture tenant carries no enabled rule, and a
        // `findFirst` here would make the whole test silently vacuous the day
        // one is added or removed.
        const constraint = await ownerDb.constraint.create({
            data: {
                tenantId: f.tenantA, type: 'compactness', name: 'Compact days',
                severity: 'SOFT', weight: 5, params: { scope: 'group' }, isEnabled: true,
            },
        });

        const sentNow = async () => {
            const { input } = await ownerDb.$transaction(async (tx) => {
                await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

                return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
            });

            return input.constraints.some((c) => c.id === constraint.id);
        };

        expect(await sentNow(), 'unscoped').toBe(true);

        await ownerDb.constraint.update({ where: { id: constraint.id }, data: { timeGridId: other.id } });
        expect(await sentNow(), 'scoped to the other grid').toBe(false);

        await ownerDb.constraint.update({ where: { id: constraint.id }, data: { timeGridId: null } });
        expect(await sentNow(), 'unscoped again').toBe(true);

        await ownerDb.timeGrid.delete({ where: { id: other.id } });
        await ownerDb.constraint.delete({ where: { id: constraint.id } });
    });

    it('is deleted with its grid, never silently widened to all of them', async () => {
        const doomed = await ownerDb.timeGrid.create({
            data: {
                tenantId: f.tenantA, name: 'Doomed grid', blockLengthMinutes: 30,
                blocksPerDay: 2, activeDays: [1], startHour: 20, startMinute: 0,
            },
        });
        const scoped = await ownerDb.constraint.create({
            data: {
                tenantId: f.tenantA, type: 'compactness', name: 'Evening compactness',
                severity: 'SOFT', weight: 5, params: { scope: 'group' }, timeGridId: doomed.id,
            },
        });

        /*
         * DELETED IN SQL, NOT THROUGH PRISMA, and that is the whole point of
         * this test. `prisma.timeGrid.delete()` performs its OWN cascade from
         * `schema.prisma` whatever the database says, so it passes against a
         * `SET NULL` foreign key, verified by mutating the migration to
         * `SET NULL` and watching this test stay green. What protects a writer
         * that is not Prisma (a script, psql, a later migration) is the
         * constraint itself, so the constraint is what gets exercised.
         */
        await ownerDb.$executeRawUnsafe(`DELETE FROM time_grid WHERE id = '${doomed.id}'`);

        // CASCADE, not SET NULL. Nulling would promote a rule about one grid to
        // a rule about every grid, the opposite of what its author asked for,
        // and invisible until a timetable came back wrong.
        expect(await ownerDb.constraint.findUnique({ where: { id: scoped.id } })).toBeNull();
    });
});

describe('the gridRelative hint', () => {
    it('marks the types stated in blocks or the gaps between them', () => {
        const marked = CONSTRAINT_TYPES.filter((t) => t.gridRelative).map((t) => t.key);

        expect(marked).toEqual(expect.arrayContaining([
            'compactness', 'max_consecutive_blocks', 'max_daily_span',
        ]));
    });

    it('does NOT mark a rule that means the same thing on any grid', () => {
        // A double-booking is a double-booking whatever a block is worth. If
        // this ever marks everything, the hint has stopped distinguishing
        // anything and the warning it drives becomes noise.
        const marked = CONSTRAINT_TYPES.filter((t) => t.gridRelative);

        expect(marked.length).toBeLessThan(CONSTRAINT_TYPES.length);
        expect(marked.map((t) => t.key)).not.toContain('no_double_booking_room');
    });
});

describe('a room with no capacity', () => {
    const capacityOf = async (code: string) => {
        const { input } = await ownerDb.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

            return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
        });

        return input.rooms.find((r) => r.name.includes(code))?.capacity;
    };

    it('is sent as unlimited, not as fitting nobody', async () => {
        await ownerDb.room.update({ where: { id: f.roomPrivateA }, data: { capacity: 0 } });

        // The column DEFAULTS to 0, so this is the state of every room saved
        // without a capacity, and `room.capacity >= min_capacity` would make
        // all of them ineligible for every offering that asked for any.
        expect(await capacityOf('Private A')).toBe(UNBOUNDED_ROOM_CAPACITY);
    });

    it('leaves a real capacity exactly as stored', async () => {
        await ownerDb.room.update({ where: { id: f.roomPrivateA }, data: { capacity: 30 } });

        expect(await capacityOf('Private A')).toBe(30);
    });

    it('survives being summed across a multi-room offering', () => {
        // Capacities are ADDED for an Offering needing several Rooms at once,
        // inside a u32. `u32::MAX` would wrap on the second room.
        expect(UNBOUNDED_ROOM_CAPACITY * 4).toBeLessThan(2 ** 32);
    });

    it('is larger than any capacity an institution could state', () => {
        expect(UNBOUNDED_ROOM_CAPACITY).toBeGreaterThan(100_000);
    });
});
