import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput } from '../server/utils/solverInput';
import { approvedBlackoutsFor } from '../server/utils/availability';
import { blockedSlotSummary, resolveHolidayWeeks } from '#shared/availability';

/**
 * ONLY APPROVED unavailability reaches the solver.
 *
 * THIS IS THE SAFETY PROPERTY OF THE WHOLE FEATURE, which is why it is a test
 * rather than a comment next to a `where` clause. A veto is a HARD constraint:
 * a PENDING window on the wire would apply a rule nobody approved, and it would
 * announce itself only as unplaced Sessions in a timetable somebody then has to
 * debug backwards.
 *
 * The suite is written to FAIL if the `status` filter in `approvedBlackoutsFor`
 * is removed: that was checked by removing it, not assumed. A test that seeds
 * only approved rows would pass against a build with no filter at all.
 *
 * It also pins the thing that made this feature necessary: `blackouts` was `[]`
 * unconditionally, so `lecturer_veto` (a hard constraint enabled by default in
 * every tenant) ran against an empty set in every solve since it was
 * catalogued and could never once fire.
 */
let f: Fixtures;

/** Every Friday. */
const FRIDAY = { days: [5], blocks: [], weeks: [] };
/** First block, every day. */
const FIRST_BLOCK = { days: [], blocks: [0], weeks: [] };
/** Week-scoped: excluded from the blocked-slot summary, still sent. */
const WEEK_SEVEN = { days: [1], blocks: [2], weeks: [6] };

beforeAll(async () => {
    f = await seed();

    await ownerDb.personUnavailability.createMany({
        data: [
            {
                tenantId: f.tenantA, personId: f.personA, ...FRIDAY,
                status: 'APPROVED', createdByPersonId: f.personA,
                decidedByPersonId: f.personA, decidedAt: new Date(),
            },
            // The two that must NOT travel.
            { tenantId: f.tenantA, personId: f.personA, ...FIRST_BLOCK, status: 'PENDING', createdByPersonId: f.personA },
            {
                tenantId: f.tenantA, personId: f.personA, days: [3], blocks: [], weeks: [],
                status: 'REJECTED', createdByPersonId: f.personA,
                decidedByPersonId: f.personA, decidedAt: new Date(),
            },
            {
                tenantId: f.tenantA, personId: f.personA, ...WEEK_SEVEN,
                // A week index counts ONE term's calendar, so the column is not
                // optional here: the database CHECK refuses the pair otherwise.
                termId: f.termA,
                status: 'APPROVED', createdByPersonId: f.personA,
                decidedByPersonId: f.personA, decidedAt: new Date(),
            },
        ],
    });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('the single read path', () => {
    it('returns approved windows and nothing else', async () => {
        const byPerson = await ownerDb.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

            return approvedBlackoutsFor(tx as never, [f.personA], f.termA);
        });

        const windows = byPerson.get(f.personA) ?? [];

        // Two approved: the Friday and the week-scoped one. The PENDING and the
        // REJECTED must be absent: with the filter removed this is 4.
        expect(windows).toHaveLength(2);
        expect(windows.map((w) => w.days)).toEqual([[5], [1]]);
        expect(windows.some((w) => w.blocks.length === 1 && w.blocks[0] === 0 && w.days.length === 0)).toBe(false);
    });

    it('is empty for a person with no windows, not undefined', async () => {
        const byPerson = await ownerDb.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

            return approvedBlackoutsFor(tx as never, [f.personViewerA], f.termA);
        });

        // Callers use `?? []`; this pins that "no rows" is a missing key rather
        // than a key holding a null that would blow up a `.map`.
        expect(byPerson.get(f.personViewerA)).toBeUndefined();
    });
});

describe('assembleSolverInput carries them into Person.blackouts', () => {
    it('sends approved windows only', async () => {
        const out = await ownerDb.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

            return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
        });

        const person = out.input.persons.find((row) => row.id === f.personA);

        expect(person, 'the person must be in the snapshot at all').toBeDefined();
        expect(person!.blackouts).toHaveLength(2);
        expect(person!.blackouts.map((w) => w.days)).toEqual([[5], [1]]);

        // The wire field exists and the app deliberately does not populate it:
        // a veto's reason is often personal and changes no placement.
        expect(person!.blackouts.every((w) => w.reason === '')).toBe(true);
    });

    it('leaves a person with no approved windows empty', async () => {
        const out = await ownerDb.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

            return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
        });

        const viewer = out.input.persons.find((row) => row.id === f.personViewerA);

        expect(viewer!.blackouts).toEqual([]);
    });
});

describe('the veto-load report', () => {
    it('counts blanket windows against the grid and sets week-scoped ones aside', () => {
        // Mon–Fri, 8 blocks. Every Friday is 8 of 40; the week-scoped window is
        // not a standing block and must not inflate that.
        const summary = blockedSlotSummary([FRIDAY, WEEK_SEVEN], [1, 2, 3, 4, 5], 8);

        expect(summary).toEqual({ blocked: 8, total: 40, weekScopedWindows: 1 });
    });

    it('counts overlapping windows as SLOTS, not as claims', () => {
        // Friday (8 slots) plus first-block-every-day (5 slots) overlap at
        // Friday's first block, so the answer is 12 rather than 13.
        const summary = blockedSlotSummary([FRIDAY, FIRST_BLOCK], [1, 2, 3, 4, 5], 8);

        expect(summary.blocked).toBe(12);
    });

    it('ignores a day the grid does not have', () => {
        // "Never available on Saturdays" is storable in a Mon–Fri tenant and
        // blocks nothing that exists. Counted as zero rather than rejected.
        const summary = blockedSlotSummary([{ days: [6], blocks: [], weeks: [] }], [1, 2, 3, 4, 5], 8);

        expect(summary.blocked).toBe(0);
    });

    it('reports a person whose approved windows clear the threshold', async () => {
        // Three whole days of a five-day week is 24 of 40, past HEAVY_VETO_RATIO.
        await ownerDb.personUnavailability.create({
            data: {
                tenantId: f.tenantA, personId: f.personViewerA, days: [1, 2, 3], blocks: [], weeks: [],
                status: 'APPROVED', createdByPersonId: f.personViewerA,
                decidedByPersonId: f.personA, decidedAt: new Date(),
            },
        });

        const out = await ownerDb.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

            return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
        });

        const flagged = out.report.personsWithHeavyVetoLoad.find((row) => row.id === f.personViewerA);

        expect(flagged, 'a mostly-unavailable person must be reported').toBeDefined();
        // BOTH numbers travel, so the threshold decides only whether to mention
        // it, never how bad it is.
        expect(flagged!.blocked).toBeGreaterThan(0);
        expect(flagged!.total).toBeGreaterThan(flagged!.blocked);

        // ...and the person with one Friday is NOT reported, or the threshold
        // would be doing nothing.
        expect(out.report.personsWithHeavyVetoLoad.some((row) => row.id === f.personA)).toBe(false);
    });
});

/**
 * A week index counts ONE term's calendar, and the row now says which.
 *
 * WHY THIS EXISTS. `Unavailability.weeks` is "index into
 * AcademicCalendar.weeks", and that calendar is built per solve for the term
 * being solved. Before `term_id`, one stored `weeks:[2]` was sent to every
 * term, measured against the demo tenant, where week 2 begins 2026-09-07 in one
 * term and 2027-10-11 in the other. Harmless for a recurring Friday; a
 * correctness hole the moment a date-range absence exists, which is what the
 * previous slice's UI narrowing had kept out of reach.
 */
describe('week-scoped windows are anchored to their term', () => {
    it('sends a term-scoped window only to that term', async () => {
        const other = await ownerDb.term.create({
            data: {
                id: 'test-term-a-second', tenantId: f.tenantA, name: 'Second',
                startDate: new Date('2027-02-01'), endDate: new Date('2027-05-01'),
            },
        });

        const read = (termId: string) => ownerDb.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

            return approvedBlackoutsFor(tx as never, [f.personA], termId);
        });

        const inOwnTerm = (await read(f.termA)).get(f.personA) ?? [];
        const inOtherTerm = (await read(other.id)).get(f.personA) ?? [];

        // Own term: the blanket Friday AND the week-scoped one.
        expect(inOwnTerm).toHaveLength(2);
        // Other term: the Friday only. The week-scoped row would name a
        // different fortnight there and is correctly absent.
        expect(inOtherTerm).toHaveLength(1);
        expect(inOtherTerm[0]?.weeks).toEqual([]);

        await ownerDb.term.delete({ where: { id: other.id } });
    });

    it('refuses a week index with no term, at the database', async () => {
        // The ambiguous state is unrepresentable rather than discouraged: a
        // future write path that forgets the term fails loudly instead of
        // storing a row that means something different in every solve.
        await expect(ownerDb.personUnavailability.create({
            data: {
                tenantId: f.tenantA, personId: f.personA, days: [], blocks: [], weeks: [1],
                status: 'PENDING', createdByPersonId: f.personA,
            },
        })).rejects.toThrow();
    });
});

/**
 * A date range is spelled EXACTLY (issue #118).
 *
 * Every touched week is still listed (`weeks`, what the stored row carries and
 * the review queue counts), but the WIRE windows name only the days the
 * absence covers: a Wednesday-to-Friday absence no longer blocks Monday and
 * Tuesday. The axes intersect (calendry-solver `0a16574` pins it), so
 * `{days:[3,4,5], weeks:[1]}` is Wed–Fri of week 1 and of no other week.
 */
describe('resolving a date range to weeks and days', () => {
    // A Monday-starting term, so week boundaries are easy to reason about.
    const START = new Date('2027-10-04');
    const END = new Date('2027-12-24');

    it('names the covered days of each partial end week, and spells them as two windows', () => {
        // Wednesday of week 1 to Friday of week 2.
        const out = resolveHolidayWeeks(START, END, new Date('2027-10-13'), new Date('2027-10-22'));

        expect(out.weeks).toEqual([1, 2]);
        expect(out.partial.map((week) => [week.index, week.days])).toEqual([[1, [3, 4, 5, 6, 7]], [2, [1, 2, 3, 4, 5]]]);
        expect(out.windows).toEqual([
            { days: [3, 4, 5, 6, 7], blocks: [], weeks: [1] },
            { days: [1, 2, 3, 4, 5], blocks: [], weeks: [2] },
        ]);
    });

    it('sends whole weeks as ONE window with empty days, and nothing partial', () => {
        // Monday of week 1 to Sunday of week 2.
        const out = resolveHolidayWeeks(START, END, new Date('2027-10-11'), new Date('2027-10-24'));

        expect(out.weeks).toEqual([1, 2]);
        expect(out.partial).toEqual([]);
        expect(out.windows).toEqual([{ days: [], blocks: [], weeks: [1, 2] }]);
    });

    it('a range across three weeks is head, whole middle, tail: three windows, one row', () => {
        // Thursday of week 1 through Tuesday of week 3.
        const out = resolveHolidayWeeks(START, END, new Date('2027-10-14'), new Date('2027-10-26'));

        expect(out.windows).toEqual([
            { days: [], blocks: [], weeks: [2] },
            { days: [4, 5, 6, 7], blocks: [], weeks: [1] },
            { days: [1, 2], blocks: [], weeks: [3] },
        ]);
    });

    it('a one-day absence is that weekday of that week and nothing else', () => {
        const out = resolveHolidayWeeks(START, END, new Date('2027-10-14'), new Date('2027-10-14'));

        expect(out.weeks).toEqual([1]);
        expect(out.windows).toEqual([{ days: [4], blocks: [], weeks: [1] }]);
    });

    it('clamps to the term rather than running past either end', () => {
        // Starts a fortnight before the term and ends after it.
        const out = resolveHolidayWeeks(START, END, new Date('2027-09-20'), new Date('2028-01-15'));

        expect(out.weeks[0]).toBe(0);
        // `weekCountOf` is the authority on how many weeks a term has; a range
        // running past the end must not invent one.
        expect(out.weeks[out.weeks.length - 1]).toBe(11);
        // The range covers every week Monday to Sunday, so one whole window.
        expect(out.windows).toEqual([{ days: [], blocks: [], weeks: out.weeks }]);
    });

    it('clamps the covered DAYS to the term too: the days before a mid-week term start are not "covered"', () => {
        // Term starts Thursday 2027-10-07; absence from the Monday before.
        const thursdayStart = new Date('2027-10-07');
        const out = resolveHolidayWeeks(thursdayStart, END, new Date('2027-10-04'), new Date('2027-10-08'));

        expect(out.weeks).toEqual([0]);
        expect(out.windows).toEqual([{ days: [4, 5], blocks: [], weeks: [0] }]);
    });
});

/**
 * The single read path expands a DATED row into those windows; a row without
 * dates (a recurring pattern, or an absence recorded before issue #118)
 * travels exactly as stored.
 */
describe('approvedBlackoutsFor expands a dated absence', () => {
    // Fixture term A runs 2026-10-01 (a Thursday) to 2027-02-28. Wednesday
    // 2026-11-04 to Friday 2026-11-13 is weeks 5 and 6.
    const FROM = new Date('2026-11-04');
    const TO = new Date('2026-11-13');

    it('sends the days actually away, not the whole weeks the row lists', async () => {
        await ownerDb.personUnavailability.create({
            data: {
                tenantId: f.tenantA, personId: f.personMultiA, days: [], blocks: [], weeks: [5, 6],
                absentFrom: FROM, absentTo: TO, termId: f.termA,
                status: 'APPROVED', createdByPersonId: f.personMultiA,
                decidedByPersonId: f.personMultiA, decidedAt: new Date(),
            },
        });

        const byPerson = await ownerDb.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

            return approvedBlackoutsFor(tx as never, [f.personMultiA], f.termA);
        });

        expect(byPerson.get(f.personMultiA)).toEqual([
            { days: [3, 4, 5, 6, 7], blocks: [], weeks: [5] },
            { days: [1, 2, 3, 4, 5], blocks: [], weeks: [6] },
        ]);
    });

    it('a pre-#118 absence without dates still travels as its whole weeks', async () => {
        // WEEK_SEVEN is such a row, seeded above with no dates: `[1]`, as stored.
        const byPerson = await ownerDb.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

            return approvedBlackoutsFor(tx as never, [f.personA], f.termA);
        });

        expect(byPerson.get(f.personA)).toContainEqual(WEEK_SEVEN);
    });

    it('the database refuses half a date pair, and a dated row with no term', async () => {
        const base = {
            tenantId: f.tenantA, personId: f.personMultiA, days: [], blocks: [], weeks: [],
            status: 'PENDING' as const, createdByPersonId: f.personMultiA,
        };

        await expect(ownerDb.personUnavailability.create({
            data: { ...base, absentFrom: FROM, termId: f.termA },
        })).rejects.toThrow();
        await expect(ownerDb.personUnavailability.create({
            data: { ...base, absentFrom: FROM, absentTo: TO },
        })).rejects.toThrow();
    });
});
