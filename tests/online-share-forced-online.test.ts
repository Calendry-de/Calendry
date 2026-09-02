import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput } from '../server/utils/solverInput';
import { forcedOnlineAboveShareCap } from '../server/utils/onlineShareFloor';
import type { ShareCapGroup, ShareCapOffering, ShareCapRule } from '../server/utils/onlineShareFloor';

/**
 * `max_online_ratio_per_group` against Offerings that MUST be online.
 *
 * WHAT IS ACTUALLY AT RISK, and it is not "the report has a new field".
 *
 * The cap is HARD, so a group over it comes back as a residual
 * `MaxOnlineShare` violation. That violation names no Session and no Offering
 * (`constraints::aggregates` in calendry-solver builds it with empty id lists),
 * so `materializeViolations` writes NO row for it: it reaches a reviewer only
 * as a number in the review screen's type breakdown, and reads identically to
 * a breach somebody could fix by moving a Session on site. For a group whose
 * teaching is forced online there is no such move — the cap is arithmetically
 * unreachable, and the same violation will come back on every run forever.
 *
 * These assertions are therefore about the ARITHMETIC AGREEING WITH THE
 * SOLVER'S as much as about the entry existing. A warning that fires where the
 * solver is content, or stays silent where it is not, is worse than no
 * warning: it is a second opinion on a question that has one answer.
 */

const rule = (over: Partial<ShareCapRule> = {}): ShareCapRule => ({
    constraintId: 'c1',
    maxRatio: 0.3,
    perWeek: false,
    appliesToKinds: [],
    ...over,
});

const offering = (over: Partial<ShareCapOffering> = {}): ShareCapOffering => ({
    id: 'o1',
    title: 'Offering',
    kind: 'lecture',
    groupIds: ['g1'],
    requiredSessionCount: 1,
    forcedOnline: false,
    ...over,
});

const flat: ShareCapGroup[] = [{ id: 'g1', name: 'Class A', parentId: '' }];

describe('forcedOnlineAboveShareCap: the arithmetic the solver will use', () => {
    it('says nothing when no offering is forced online', () => {
        // An `ALLOWED` Offering may end up over the cap and that is exactly the
        // breach the solver exists to price. Reporting it here would be a false
        // alarm on the commonest configuration there is.
        const out = forcedOnlineAboveShareCap(
            [rule()],
            [offering({ requiredSessionCount: 10 })],
            flat,
        );

        expect(out).toEqual([]);
    });

    it('says nothing while the forced-online demand fits under the cap', () => {
        const out = forcedOnlineAboveShareCap(
            [rule()],
            [
                offering({ id: 'online', requiredSessionCount: 3, forcedOnline: true }),
                offering({ id: 'onsite', requiredSessionCount: 7 }),
            ],
            flat,
        );

        // 3 of 10 at 30%: allowance(10) = 3, and the solver's test is strict
        // (`online > allowance`), so this cell is SATISFIED, not marginal.
        expect(out).toEqual([]);
    });

    it('reports the cell the moment the forced demand passes the allowance', () => {
        const out = forcedOnlineAboveShareCap(
            [rule()],
            [
                offering({ id: 'online', title: 'Remote lab', requiredSessionCount: 4, forcedOnline: true }),
                offering({ id: 'onsite', requiredSessionCount: 6 }),
            ],
            flat,
        );

        expect(out).toEqual([{
            constraintId: 'c1',
            groupId: 'g1',
            groupName: 'Class A',
            window: 'PER_TERM',
            maxRatio: 0.3,
            forcedOnline: 4,
            total: 10,
            allowance: 3,
            // Named, because "which lessons" is the only part of this anybody
            // can go and change.
            offerings: [{ id: 'online', title: 'Remote lab', sessions: 4 }],
        }]);
    });

    it('floors the allowance rather than rounding it', () => {
        // The solver's own `allowance_floors_rather_than_rounds`: 0.3 of 3
        // permits ZERO, so a single forced-online session already breaches.
        const out = forcedOnlineAboveShareCap(
            [rule()],
            [
                offering({ id: 'online', requiredSessionCount: 1, forcedOnline: true }),
                offering({ id: 'onsite', requiredSessionCount: 2 }),
            ],
            flat,
        );

        expect(out).toHaveLength(1);
        expect(out[0]!.allowance).toBe(0);
    });

    it('agrees with the solver at 0.3 x 10, where the float could have gone either way', () => {
        // `max_ratio` is a proto `double`, and 0.3 * 10 rounds to exactly 3 in
        // IEEE754 — the Rust side asserts `allowance(10) == 3`. Were this a
        // float32 hop, or were the ratio recomputed from the stored percent
        // some other way, the two sides would disagree by one session on the
        // commonest cap there is.
        expect(Math.floor(0.3 * 10)).toBe(3);

        const satisfied = forcedOnlineAboveShareCap(
            [rule()],
            [offering({ requiredSessionCount: 3, forcedOnline: true }), offering({ id: 'x', requiredSessionCount: 7 })],
            flat,
        );

        expect(satisfied).toEqual([]);
    });

    it('reports a per-week cap by pigeonhole, and says which window it was', () => {
        // Demand carries no week until it is placed, so the per-week cell is
        // unknowable here. What is provable: over the term the forced share
        // exceeds the ratio, so SOME week must exceed it however the sessions
        // are spread. The window travels with the entry because the sentence
        // differs even where the arithmetic does not.
        const out = forcedOnlineAboveShareCap(
            [rule({ perWeek: true })],
            [
                offering({ id: 'online', requiredSessionCount: 4, forcedOnline: true }),
                offering({ id: 'onsite', requiredSessionCount: 6 }),
            ],
            flat,
        );

        expect(out).toHaveLength(1);
        expect(out[0]!.window).toBe('PER_WEEK');
    });

    it('counts a cohort session against its classes, never a class session against the cohort', () => {
        /*
         * `expand_subtree`, downward only: membership flows DOWN. A cohort's
         * online lecture is attended by every class beneath it, so it belongs
         * in each of their cells; a class's own online session does not
         * implicate its siblings or its parent.
         *
         * Getting this backwards is the bug that looks correct on any flat
         * fixture, which is exactly why the fixture here is not flat.
         */
        const tree: ShareCapGroup[] = [
            { id: 'cohort', name: 'Year 1', parentId: '' },
            { id: 'a', name: 'Class A', parentId: 'cohort' },
            { id: 'b', name: 'Class B', parentId: 'cohort' },
        ];

        const out = forcedOnlineAboveShareCap(
            [rule()],
            [
                offering({ id: 'lecture', groupIds: ['cohort'], requiredSessionCount: 4, forcedOnline: true }),
                offering({ id: 'seminar-a', groupIds: ['a'], requiredSessionCount: 6 }),
            ],
            tree,
        );

        const byGroup = new Map(out.map((entry) => [entry.groupId, entry]));

        // Class A: 4 forced of 10 — over the cap.
        expect(byGroup.get('a')).toMatchObject({ forcedOnline: 4, total: 10 });
        // Class B holds only the cohort's lecture: 4 of 4, entirely online.
        expect(byGroup.get('b')).toMatchObject({ forcedOnline: 4, total: 4 });
        // The cohort itself holds only its own lecture. Class A's seminar does
        // NOT count up into it.
        expect(byGroup.get('cohort')).toMatchObject({ forcedOnline: 4, total: 4 });
    });

    it('reads an empty applies_to_kinds as EVERY kind, and a set one as a narrowing', () => {
        const offerings = [
            offering({ id: 'online', kind: 'lab', requiredSessionCount: 4, forcedOnline: true }),
            offering({ id: 'onsite', kind: 'lecture', requiredSessionCount: 6 }),
        ];

        // Empty = all kinds, the wire's own convention: both offerings count.
        expect(forcedOnlineAboveShareCap([rule()], offerings, flat)).toHaveLength(1);

        // Scoped to `lab` alone, the on-site lecture leaves the denominator:
        // 4 of 4 online, still a breach, but of a different cell.
        const scoped = forcedOnlineAboveShareCap([rule({ appliesToKinds: ['lab'] })], offerings, flat);

        expect(scoped).toHaveLength(1);
        expect(scoped[0]).toMatchObject({ forcedOnline: 4, total: 4 });

        // Scoped to a kind nothing forced online carries: nothing to say.
        expect(forcedOnlineAboveShareCap([rule({ appliesToKinds: ['lecture'] })], offerings, flat)).toEqual([]);
    });

    it('ignores a group the run never sent', () => {
        // The solver has no cell for a Group it did not receive, so neither
        // does this: inventing one would report a breach against a cell that
        // does not exist in the answer being explained.
        const out = forcedOnlineAboveShareCap(
            [rule({ maxRatio: 0 })],
            [offering({ groupIds: ['not-sent'], forcedOnline: true })],
            flat,
        );

        expect(out).toEqual([]);
    });
});

/**
 * The same check through `assembleSolverInput`, where "forced online" stops
 * being a boolean somebody passed in and becomes the composed answer of a room
 * pin and an online mode.
 */
let f: Fixtures;
let virtualRoom: string;
let hall: string;

const OFFERING = 'test-offering-a';

beforeAll(async () => {
    f = await seed();

    virtualRoom = (await ownerDb.room.create({
        data: { tenantId: f.tenantA, code: 'ONLINE-S', name: 'Virtual', capacity: 0, isVirtual: true },
    })).id;
    hall = (await ownerDb.room.create({
        data: { tenantId: f.tenantA, code: 'H-S', name: 'Hall', capacity: 200 },
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
        data: { onlineMode: 'FORBIDDEN' },
    });
    await ownerDb.constraint.deleteMany({
        where: { tenantId: f.tenantA, type: 'max_online_ratio_per_group' },
    });

    /*
     * THE CAP IS A PER-GROUP AGGREGATE, so an Offering attached to no Group
     * counts against no cell — the solver's `subtree_groups` would be empty
     * too. The base fixture's Offering carries no Group, so the link is part of
     * the setup rather than an incidental: without it every assertion below
     * would pass by finding nothing, which is the shape of a test that checks
     * a typo.
     */
    await ownerDb.offeringGroup.deleteMany({ where: { offeringId: OFFERING } });
    await ownerDb.offeringGroup.create({
        data: { tenantId: f.tenantA, offeringId: OFFERING, groupId: 'test-group-cohort-a' },
    });
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
});

const enableCap = (maxRatio: number) => ownerDb.constraint.create({
    data: {
        tenantId: f.tenantA,
        type: 'max_online_ratio_per_group',
        name: 'Cap online share',
        severity: 'HARD',
        isEnabled: true,
        params: { maxRatio, window: 'SHARE_WINDOW_PER_TERM' },
    },
});

describe('assembleSolverInput: the cap against a required-online offering', () => {
    it('reports nothing while the cap is not enabled, whatever the online mode', async () => {
        await ownerDb.offering.update({ where: { id: OFFERING }, data: { onlineMode: 'REQUIRED' } });

        const { report } = await assemble();

        expect(report.groupsWithForcedOnlineAboveShareCap).toEqual([]);
    });

    it('reports nothing for an offering that merely MAY be online', async () => {
        await enableCap(0);
        await ownerDb.offering.update({ where: { id: OFFERING }, data: { onlineMode: 'ALLOWED' } });

        const { report } = await assemble();

        // A 0% cap and an `ALLOWED` offering: the solver can satisfy this by
        // placing every session on campus, so there is nothing to explain.
        expect(report.groupsWithForcedOnlineAboveShareCap).toEqual([]);
    });

    it('names the group and the offering when the mode leaves no on-site placement', async () => {
        await enableCap(0);
        await ownerDb.offering.update({ where: { id: OFFERING }, data: { onlineMode: 'REQUIRED' } });

        const { report } = await assemble();
        const entries = report.groupsWithForcedOnlineAboveShareCap;

        expect(entries.length).toBeGreaterThan(0);
        expect(entries.every((entry) => entry.forcedOnline > entry.allowance)).toBe(true);
        expect(entries.flatMap((entry) => entry.offerings.map((o) => o.id)))
            .toContain(OFFERING);

        // The rule is still SENT, exactly as configured: this is an
        // explanation, never a narrowing.
        const sent = report.skippedConstraints
            .filter((skipped) => skipped.type === 'max_online_ratio_per_group');

        expect(sent).toEqual([]);
    });

    it('treats a pin to virtual rooms alone as forced online, like REQUIRED', async () => {
        // Read off the COMPOSED restriction rather than off `onlineMode`: an
        // offering pinned to nothing but virtual rooms has no on-site
        // placement either, and asking the field instead of the composition is
        // how the pin and the mode come to disagree.
        await enableCap(0);
        await ownerDb.offering.update({ where: { id: OFFERING }, data: { onlineMode: 'ALLOWED' } });
        await ownerDb.offeringRoom.create({
            data: { tenantId: f.tenantA, offeringId: OFFERING, roomId: virtualRoom },
        });

        const { report } = await assemble();

        expect(report.groupsWithForcedOnlineAboveShareCap.flatMap((e) => e.offerings.map((o) => o.id)))
            .toContain(OFFERING);
    });

    it('says nothing for a pin that still leaves a physical room', async () => {
        await enableCap(0);
        await ownerDb.offering.update({ where: { id: OFFERING }, data: { onlineMode: 'ALLOWED' } });
        await ownerDb.offeringRoom.createMany({
            data: [
                { tenantId: f.tenantA, offeringId: OFFERING, roomId: virtualRoom },
                { tenantId: f.tenantA, offeringId: OFFERING, roomId: hall },
            ],
        });

        const { report } = await assemble();

        expect(report.groupsWithForcedOnlineAboveShareCap.flatMap((e) => e.offerings.map((o) => o.id)))
            .not.toContain(OFFERING);
    });

    it('says nothing for a restriction nothing can satisfy, which is a different report entry', async () => {
        /*
         * `REQUIRED` intersected with a physical-only pin resolves to NOTHING:
         * the offering ships `NO_ELIGIBLE_ROOM_ID` and comes back unplaced, so
         * it contributes no online session to any cell.
         * `offeringsWithUnsatisfiableRoomRestriction` already names it with the
         * fix it actually needs, and saying it twice under two different
         * diagnoses would send somebody to change the wrong thing.
         */
        await enableCap(0);
        await ownerDb.offering.update({ where: { id: OFFERING }, data: { onlineMode: 'REQUIRED' } });
        await ownerDb.offeringRoom.create({
            data: { tenantId: f.tenantA, offeringId: OFFERING, roomId: hall },
        });

        const { report } = await assemble();

        expect(report.offeringsWithUnsatisfiableRoomRestriction.map((e) => e.id)).toContain(OFFERING);
        expect(report.groupsWithForcedOnlineAboveShareCap.flatMap((e) => e.offerings.map((o) => o.id)))
            .not.toContain(OFFERING);
    });
});
