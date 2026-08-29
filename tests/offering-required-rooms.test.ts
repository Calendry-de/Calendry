import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { migrationStatements } from './helpers/migrations';
import { assembleSolverInput } from '../server/utils/solverInput';
import { RESOURCES } from '../server/utils/resources';
import { MANAGE_ENTITIES } from '../app/utils/manageRegistry';
import { MAX_ROOMS_PER_SESSION } from '../shared/rooms';

/**
 * `Offering.requiredRoomCount` — a Session that needs two Rooms AT ONCE.
 *
 * The solver has been able to do this for a while: `convert.rs` builds Room
 * COMBINATIONS above one, sums their capacity, and checks the Offering's
 * features against the set. `assembleSolverInput` sent a hardcoded 0, so the
 * capability was live and unreachable.
 *
 * TWO PROPERTIES ARE WORTH PINNING, and neither is "the column saves".
 *
 *   1. THE CEILING IS ENFORCED THREE TIMES, and it has to be. Above
 *      `MAX_ROOMS_PER_SESSION` the solver REFUSES the entire input rather than
 *      truncating, so a 5 stored here is not a big number — it is every run
 *      failing for the whole tenant, reported later against an Offering
 *      somebody edited weeks ago. The write schema refuses it politely, the
 *      database CHECK refuses it absolutely, and the form states the limit
 *      instead of letting it be discovered.
 *
 *   2. CAPACITY IS SUMMED, AND THE UI SAYS SO. The opposite reading — each Room
 *      must independently hold the whole Group — is a coherent thing for a
 *      tenant to want and gives the opposite answer on identical input. The
 *      proto decides it (summed), so the only thing this app can get wrong is
 *      failing to say which. Copy is normally nobody's tripwire; here it is the
 *      entire difference between a stated assumption and a silent one.
 */
let f: Fixtures;

beforeAll(async () => {
    f = await seed();
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
});

const setCount = (value: number) => ownerDb.offering.update({
    where: { id: 'test-offering-a' },
    data: { requiredRoomCount: value },
});

const sentCount = async () => (await assemble()).input.offerings
    .find((offering) => offering.id === 'test-offering-a')!.requiredRoomCount;

describe('what reaches the wire', () => {
    it('defaults to one, not the proto’s zero', async () => {
        // 0 and 1 are identical to the solver, so this is not about behaviour —
        // it is that the app now has an opinion where it previously had a
        // placeholder, and 1 is the true statement about an unedited Offering.
        expect(await sentCount()).toBe(1);
    });

    it('sends the stored value rather than the pinned zero it used to', async () => {
        await setCount(2);
        expect(await sentCount()).toBe(2);

        await setCount(MAX_ROOMS_PER_SESSION);
        expect(await sentCount()).toBe(MAX_ROOMS_PER_SESSION);

        await setCount(1);
    });
});

describe('the ceiling', () => {
    /**
     * BOTH SCHEMAS, not just the one a test happened to reach for. `offerings`
     * declares `create` and `update` separately, so a bound present on one and
     * absent on the other is a hole nothing else would report — and a mutation
     * that loosened only `create` left an `update`-only version of this suite
     * entirely green.
     */
    const schemas: [string, { parse: (v: unknown) => unknown }][] = [
        ['create', RESOURCES.offerings!.create!],
        ['update', RESOURCES.offerings!.update!],
    ];

    // `create` requires the rest of an Offering, so the field under test is
    // added to a minimal valid body rather than parsed on its own.
    const body = (schema: string, value: number) => (schema === 'create'
        ? { termId: 'a', kindId: 'b', title: 'T', requiredRoomCount: value }
        : { requiredRoomCount: value });

    it('accepts one through the maximum', () => {
        for (const [name, schema] of schemas) {
            for (let n = 1; n <= MAX_ROOMS_PER_SESSION; n += 1) {
                expect(() => schema.parse(body(name, n)), `${name} ${n}`).not.toThrow();
            }
        }
    });

    it('refuses more than the solver can place', () => {
        // Not a preference. Past this the run FAILS — `TooManyRoomsRequired`,
        // refused rather than truncated — so accepting it would trade one
        // person's typo for the tenant's whole timetable.
        for (const [name, schema] of schemas) {
            expect(() => schema.parse(body(name, MAX_ROOMS_PER_SESSION + 1)), name).toThrow();
        }
    });

    it('refuses zero, which is not "unset" here', () => {
        // The proto conflates 0 and 1; the column does not, because every
        // Session occupies at least one Room and there is no third state to
        // encode. Accepting 0 would put an ambiguous value in the database to
        // mean something 1 already says.
        for (const [name, schema] of schemas) {
            expect(() => schema.parse(body(name, 0)), name).toThrow();
        }
    });

    it('is enforced by the database too, not only by the write schema', async () => {
        // The zod schema is the friendly refusal; this is the guarantee. Any
        // future writer that does not go through `/api/offerings` — a script, a
        // migration, an import — meets the same limit.
        await expect(setCount(MAX_ROOMS_PER_SESSION + 1)).rejects.toThrow();
        await expect(setCount(0)).rejects.toThrow();

        expect(await sentCount()).toBe(1);
    });

    it('is the same number in the migration, which cannot import it', () => {
        // SQL has no way to read `shared/rooms.ts`, so the one place the
        // constant is duplicated is checked rather than trusted.
        expect(migrationStatements()).toContain(`BETWEEN 1 AND ${MAX_ROOMS_PER_SESSION}`);
    });
});

describe('the form', () => {
    const field = MANAGE_ENTITIES
        .find((entity) => entity.key === 'offerings')!
        .fields.find((f) => f.key === 'requiredRoomCount');

    it('exists, or the column is unreachable again', () => {
        expect(field).toBeDefined();
    });

    it('states the ceiling instead of letting it be discovered', () => {
        expect(field!.max).toBe(MAX_ROOMS_PER_SESSION);
        expect(field!.min).toBe(1);
        expect(field!.help).toContain(String(MAX_ROOMS_PER_SESSION));
    });

    it('says capacities are ADDED, because the opposite reading is coherent', () => {
        // The one assertion here about wording, and it earns it: summing versus
        // "each room holds everyone" give opposite answers on the same input,
        // and nothing else in the UI would say which was assumed.
        expect(field!.help?.toUpperCase()).toContain('ADDED');
    });
});

describe('a demand no snapshot can meet', () => {
    it('is reported by name, with the numbers that explain it', async () => {
        const rooms = (await assemble()).input.rooms.length;

        await setCount(Math.min(rooms + 1, MAX_ROOMS_PER_SESSION));

        const { report, input } = await assemble();

        if (input.rooms.length >= MAX_ROOMS_PER_SESSION) {
            // The fixture grew past the point where this is expressible; the
            // check below would be vacuous rather than wrong.
            await setCount(1);

            return;
        }

        expect(report.offeringsNeedingMoreRoomsThanExist).toHaveLength(1);
        expect(report.offeringsNeedingMoreRoomsThanExist[0]).toMatchObject({
            id: 'test-offering-a',
            needs: rooms + 1,
            available: rooms,
        });

        await setCount(1);
    });

    it('is empty for an ordinary single-room term', async () => {
        const { report } = await assemble();

        expect(report.offeringsNeedingMoreRoomsThanExist).toEqual([]);
    });
});
