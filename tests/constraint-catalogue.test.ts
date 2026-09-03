import { describe, expect, it } from 'vitest';
import {
    CONSTRAINT_TYPES,
    PER_SESSION_CONSTRAINT_TYPES,
    RELATION_CONSTRAINT_TYPES,
    SOLVER_OWNED_CONSTRAINT_TYPES,
    STRUCTURAL_CONSTRAINT_TYPES,
    constraintCatalogueDrift,
    defaultConstraintRow,
    findConstraintType,
    severityMismatch,
} from '../shared/constraintTypes';
import type { ConstraintParamDef } from '../shared/constraintTypes';
import { toWireConstraint } from '../server/utils/solverInput';
import { CompactnessScope } from '@calendry-de/calendry-proto';

/**
 * Guards the one invariant `shared/constraintTypes.ts` exists to hold.
 *
 * The rule builder offers what the catalogue declares; `server/utils/violations.ts`
 * evaluates what the two type lists name. If those diverge, a tenant can
 * configure a constraint that is enabled, reports nothing, and means nothing:
 * a failure with no symptom, which is the kind this codebase keeps designing
 * against.
 *
 * A pure unit test: it needs no server and no database, unlike the four
 * integration suites alongside it.
 */
describe('constraint catalogue', () => {
    it('describes every type the evaluators know, and no others', () => {
        const drift = constraintCatalogueDrift();

        expect(drift.missingFromCatalogue).toEqual([]);
        expect(drift.missingFromEvaluators).toEqual([]);
    });

    it('marks structural, per-session and relation types as app-evaluated, the rest as solver-owned', () => {
        /*
         * FOUR LISTS NOW. `PER_SESSION_CONSTRAINT_TYPES` joined
         * `STRUCTURAL_CONSTRAINT_TYPES` as a second app-evaluated category with
         * `no_session_spanning_break`: also decided from placement data alone,
         * just not pairwise. `RELATION_CONSTRAINT_TYPES` joined for the same
         * reason `different_time` is 'app': a manual edit needs the same
         * warn-don't-block feedback the structural types give, even though its
         * data (explicit Offering membership) doesn't fit `describeCollision`'s
         * shared-entity context. All three are 'app'; only
         * `SOLVER_OWNED_CONSTRAINT_TYPES` is 'solver'.
         */
        const appEvaluated = new Set<string>([
            ...STRUCTURAL_CONSTRAINT_TYPES,
            ...PER_SESSION_CONSTRAINT_TYPES,
            ...RELATION_CONSTRAINT_TYPES,
        ]);

        for (const type of CONSTRAINT_TYPES) {
            const expected = appEvaluated.has(type.key) ? 'app' : 'solver';

            expect(type.evaluator, `${type.key} evaluator`).toBe(expected);
        }
    });

    it('covers exactly the four evaluator lists', () => {
        expect(CONSTRAINT_TYPES).toHaveLength(
            STRUCTURAL_CONSTRAINT_TYPES.length
            + PER_SESSION_CONSTRAINT_TYPES.length
            + RELATION_CONSTRAINT_TYPES.length
            + SOLVER_OWNED_CONSTRAINT_TYPES.length,
        );
    });

    it('gives every type a unique key and a description', () => {
        const keys = CONSTRAINT_TYPES.map((type) => type.key);

        expect(new Set(keys).size).toBe(keys.length);

        for (const type of CONSTRAINT_TYPES) {
            expect(type.label.length, `${type.key} label`).toBeGreaterThan(0);
            expect(type.description.length, `${type.key} description`).toBeGreaterThan(0);
        }
    });

    it('only allows a penalty weight where severity can be SOFT', () => {
        // The database CHECK enforces HARD ⇒ weight null, SOFT ⇒ weight set. A
        // type whose severity is pinned to HARD must never be offered a weight
        // control, so the catalogue must not describe one.
        for (const type of CONSTRAINT_TYPES.filter((t) => t.severity === 'HARD')) {
            expect(type.params.some((p) => p.key === 'weight'), `${type.key}`).toBe(false);
        }
    });
});

describe('constraint → wire mapping (Stage 3d)', () => {
    const scopeless: { offeringId: string | null; kindId: string | null }[] = [];
    const noKinds = new Map<string, string>();

    const row = (over: Partial<Parameters<typeof toWireConstraint>[0]> = {}) => ({
        id: 'c-1',
        type: 'no_double_booking_room',
        severity: 'HARD',
        weight: null,
        params: {},
        scopes: scopeless,
        ...over,
    });

    it('maps every catalogue type to a distinct wire field', () => {
        // Types awaiting their proto field have no wireField yet; see below.
        const fields = CONSTRAINT_TYPES
            .map((type) => type.wireField)
            .filter((field): field is NonNullable<typeof field> => field !== undefined);

        expect(new Set(fields).size).toBe(fields.length);
    });

    it('describes person_preference_fit as a SOFT, solver-owned, parameterless rule', () => {
        const type = findConstraintType('person_preference_fit');

        expect(type).toBeTruthy();
        expect(type!.severity).toBe('SOFT');
        expect(type!.evaluator).toBe('solver');
        // Same architecture as lecturer_veto: the values live on the Person, so
        // there is nothing to configure on the row but the weight.
        expect(type!.params).toEqual([]);
        expect(type!.defaultWeight).toBeGreaterThan(0);
    });

    it('SENDS person_preference_fit, now that the solver evaluates it', () => {
        /*
         * INVERTED ON 2026-08-27, and the pair of assertions it replaced is
         * worth remembering rather than deleting. This test used to assert the
         * opposite, that the rule was SKIPPED, with a sibling asserting
         * `wireField` was undefined, precisely so that flipping one would fail
         * the other and force whoever did it to read why.
         *
         * Why it was skipped: until `calendry-solver` 41f6227 the solver
         * answered this variant with `Status::unimplemented`, which fails the
         * whole StartRun. Naming the field before the evaluator existed would
         * have turned "the rule quietly does nothing" into "every solve fails",
         * for any tenant who enabled it. The evaluator has landed, so the flip
         * is now the correct half of that pair.
         */
        const result = toWireConstraint(
            { ...row(), type: 'person_preference_fit', severity: 'SOFT', weight: 5 },
            noKinds,
        );

        expect('config' in result).toBe(true);

        const config = (result as { config: Record<string, unknown> }).config;

        expect(config.personPreferenceFit).toBeDefined();
        // SOFT, so the weight is what the tenant chose rather than 0.
        expect(config.weight).toBe(5);
    });

    it('sends an EMPTY variant, because a non-empty `roles` fails the run', () => {
        /*
         * The one cross-repo coupling that survived the flip, and it is not
         * cosmetic. `PersonPreferenceFit` carries a `roles` field, and the
         * solver REFUSES a non-empty one (`PreferenceRolesUnsupported`) rather
         * than approximating it: empty means "lecturers only", which is the
         * decided scope, and widening the counted set would let a 200-student
         * cohort's aggregate preference outweigh the person teaching.
         *
         * So an empty `roles` is the only ACCEPTED value, not an unfinished one:
         * a future `roles` param on this catalogue entry would fail every
         * solve until the solver decides that scope. Asserted exactly, so adding
         * a role in `buildVariant` fails here rather than at StartRun.
         *
         * EMPTY BUT PRESENT, and that distinction cost a real failure. This
         * originally asserted `{}`, matching every other parameterless variant,
         * and `{}` CRASHES for this message, because ts-proto iterates a
         * repeated field without a presence check and `hashInput` encodes the
         * input before anything is sent. The whole assembly threw
         * `message.roles is not iterable`. So `roles: []` is load-bearing in two
         * directions at once. See solver ADR-0026 and the note on `buildVariant`.
         */
        const result = toWireConstraint(
            { ...row(), type: 'person_preference_fit', severity: 'SOFT', weight: 5 },
            noKinds,
        );

        expect((result as { config: Record<string, unknown> }).config.personPreferenceFit).toEqual({ roles: [] });
    });

    /**
     * A TYPE WITH PARAMETERS MUST HAVE A `buildVariant` CASE.
     *
     * `buildVariant` ends in `default: return {}`, and the result becomes the
     * whole variant message. So a type that declares parameters and has no case
     * sends an EMPTY message (every field at its proto zero) while the tenant
     * sees their configured values saved, rendered and never applied. No error,
     * no report, and the numbers on screen are real; only the timetable
     * disagrees.
     *
     * Asserted structurally rather than per type, so the next parameterised type
     * is covered the day it is added rather than the day somebody remembers.
     */
    it('maps the parameters of every type that declares any', () => {
        const sample = (param: ConstraintParamDef): unknown => {
            if (param.default !== undefined) return param.default;

            switch (param.type) {
                case 'select': return param.options?.[0]?.value ?? '';
                case 'boolean': return true;
                case 'weekdays': return [1];
                case 'text': return '1';
                default: return param.min ?? 1;
            }
        };

        const classifiedKinds = new Map(
            CONSTRAINT_TYPES
                .map((type) => type.appliesToKindType)
                .filter((kindType): kindType is NonNullable<typeof kindType> => Boolean(kindType))
                .map((kindType) => [kindType, [`sample-${kindType.toLowerCase()}-kind`]]),
        );

        const unmapped = CONSTRAINT_TYPES
            .filter((type) => type.params.length > 0)
            .filter((type) => {
                const params = Object.fromEntries(type.params.map((p) => [p.key, sample(p)]));
                const result = toWireConstraint(
                    row({ type: type.key, severity: type.severity ?? 'HARD', weight: type.defaultWeight ?? null, params }),
                    noKinds,
                    /*
                     * A type declaring `appliesToKindType` derives its scope from
                     * the tenant's Session-kind classification and SKIPS when
                     * nothing is classified, deliberately, since an empty
                     * `applies_to_kinds` means every kind on the wire.
                     *
                     * Supplied here so the skip cannot happen: this test is about
                     * PARAMETERS reaching the wire, and a scope-driven skip would
                     * make it silently stop checking them. Derived from the
                     * catalogue rather than hardcoded, so a new kind type is
                     * covered without touching this.
                     */
                    classifiedKinds,
                ) as { config?: Record<string, unknown> };

                const variant = result.config?.[type.wireField!];

                return !variant || Object.keys(variant).length === 0;
            })
            .map((type) => type.key);

        expect(unmapped).toEqual([]);
    });

    it('has a wire field for every catalogue type', () => {
        /*
         * The replacement tripwire, pointing the other way. `person_preference_fit`
         * was the last type without a field, so the catalogue is complete, and
         * the skip-when-unmapped branch in `toWireConstraint` is currently
         * unreachable from it.
         *
         * That branch STAYS: the situation recurs whenever a catalogue entry
         * ships ahead of the schema, and dropping a rule silently is the failure
         * it exists to prevent. This assertion is what makes the next such entry
         * announce itself: it fails, and whoever added the type decides
         * deliberately whether the field exists yet, instead of discovering
         * months later that an enabled rule never crossed.
         *
         * TWO NAMED, PERMANENT EXEMPTIONS. `PER_SESSION_CONSTRAINT_TYPES` are
         * evaluator:'app' and never reach the solver AT ALL, unlike the
         * pairwise structural types (also 'app', but dual-enforced: sent to the
         * solver as a hard filter too, which is why THEY carry a wireField). A
         * per-session type's missing field is not "ahead of the schema", it is
         * "there is no schema to be ahead of"; see its catalogue comment.
         *
         * `RELATION_CONSTRAINT_TYPES` are also 'app' and ARE sent to the
         * solver, just never through `ConstraintConfig`/`wireField`: they are
         * `SolverInput.offeringRelations`, assembled separately in
         * `assembleSolverInput`, which skips them before `toWireConstraint`
         * ever sees them (see that function's relation carve-out).
         */
        const unmapped = CONSTRAINT_TYPES
            .filter((type) => !type.wireField)
            .filter((type) => !(PER_SESSION_CONSTRAINT_TYPES as readonly string[]).includes(type.key))
            .filter((type) => !(RELATION_CONSTRAINT_TYPES as readonly string[]).includes(type.key))
            .map((type) => type.key);

        expect(unmapped).toEqual([]);
    });

    it('sends a parameterless type as an empty variant', () => {
        const result = toWireConstraint(row(), noKinds);

        expect('config' in result).toBe(true);
        expect((result as { config: Record<string, unknown> }).config.roomDoubleBooking).toEqual({});
    });

    it('SKIPS rather than defaulting when a required parameter is missing', () => {
        // The whole point of skip-and-report: a rule the tenant never chose,
        // enforced by a solver and reported to nobody, is worse than one that
        // visibly did not run.
        const result = toWireConstraint(row({ type: 'minimize_specifc_day', severity: 'SOFT', weight: 5 }), noKinds);

        expect('skip' in result).toBe(true);
        expect((result as { skip: string }).skip).toContain('days');
    });

    it('treats an EMPTY weekday list as unset, not as "avoid no days"', () => {
        const result = toWireConstraint(
            row({ type: 'minimize_specifc_day', severity: 'SOFT', weight: 5, params: { days: [] } }),
            noKinds,
        );

        expect('skip' in result).toBe(true);
    });

    it('sends chosen weekdays, sorted', () => {
        const result = toWireConstraint(
            row({ type: 'minimize_specifc_day', severity: 'SOFT', weight: 5, params: { days: [7, 3] } }),
            noKinds,
        );

        expect((result as { config: Record<string, unknown> }).config.minimizeDayUsage).toEqual({ days: [3, 7] });
    });

    it('converts 1-based block positions to the wire\'s 0-based indices', () => {
        // The UI counts blocks from 1 because that is how a human reads a day;
        // the wire and the solver are 0-based. Converting at the boundary is the
        // same discipline as `percent`, and getting it wrong shifts every
        // penalised block by one, a rule that avoids the wrong lesson.
        const result = toWireConstraint(
            row({
                type: 'minimize_block_usage',
                severity: 'SOFT',
                weight: 3,
                params: { blocks: '4, 1', first: false, last: true },
            }),
            noKinds,
        );

        expect((result as { config: Record<string, unknown> }).config.minimizeBlockUsage)
            .toEqual({ blocks: [0, 3], first: false, last: true });
    });

    it('drops unparseable and out-of-range block positions rather than failing the run', () => {
        // Free text, so a stray character is expected input. A position below 1
        // cannot be converted to a 0-based index at all; a high one is already
        // inert solver-side. Neither should cost the tenant a whole solve.
        const result = toWireConstraint(
            row({
                type: 'minimize_block_usage',
                severity: 'SOFT',
                weight: 3,
                params: { blocks: '2, banana, 0, -1, 9', first: false, last: false },
            }),
            noKinds,
        );

        expect((result as { config: Record<string, unknown> }).config.minimizeBlockUsage)
            .toEqual({ blocks: [1, 8], first: false, last: false });
    });

    it('reproduces the two types it supersedes', () => {
        // The supersession claim, asserted on this side too. `first: true` with
        // no positions must be exactly what "avoid the first block" meant, or a
        // tenant migrating between them gets a different timetable for what they
        // were told is the same rule.
        const asFirst = toWireConstraint(
            row({ type: 'minimize_block_usage', severity: 'SOFT', weight: 1,
                params: { blocks: '', first: true, last: false } }),
            noKinds,
        );

        expect((asFirst as { config: Record<string, unknown> }).config.minimizeBlockUsage)
            .toEqual({ blocks: [], first: true, last: false });

        // And the deprecated types still convert, because rows configured before
        // the replacement existed must keep working: `type` is createOnly, so
        // they cannot be edited across.
        const legacy = toWireConstraint(
            row({ type: 'minimize_first_block', severity: 'SOFT', weight: 1, params: {} }),
            noKinds,
        );

        expect((legacy as { config: Record<string, unknown> }).config.minimizeFirstBlock).toEqual({});
    });

    it('converts a percent parameter to the wire ratio', () => {
        const result = toWireConstraint(
            row({
                type: 'max_online_ratio_per_group',
                params: { maxRatio: 30, window: 'SHARE_WINDOW_PER_WEEK' },
            }),
            noKinds,
        );

        // Tenants think 0–100, the wire wants 0.0–1.0. The STORED value stays
        // what was typed; conversion happens only here.
        expect((result as { config: Record<string, unknown> }).config.maxOnlineShare)
            .toEqual({ maxRatio: 0.3, window: 2 });
    });

    it('accepts 0 as a real threshold rather than reading it as unset', () => {
        // rankThreshold 0 means "penalize every room", a genuine policy.
        const result = toWireConstraint(
            row({ type: 'minimize_high_ranking_rooms', severity: 'SOFT', weight: 2, params: { rankThreshold: 0 } }),
            noKinds,
        );

        expect((result as { config: Record<string, unknown> }).config.minimizeRoomRank)
            .toEqual({ rankThreshold: 0, invert: false });
    });

    /*
     * The direction has to REACH the wire, and an absent one has to stay false.
     *
     * Both halves matter. Until calendry-proto 0.5.0 the field did not exist in
     * the generated encoder, so an `invert` key was silently dropped: a control
     * that would have saved, rendered and passed every test while changing
     * nothing about the solve. And a row written before the parameter existed
     * carries no key at all; reading that as anything but false would flip a
     * direction the tenant never chose.
     */
    it('carries the room-rank direction, and reads an absent one as false', () => {
        const configOf = (params: Record<string, unknown>) => (toWireConstraint(
            row({ type: 'minimize_high_ranking_rooms', severity: 'SOFT', weight: 2, params }),
            noKinds,
        ) as { config: Record<string, unknown> }).config.minimizeRoomRank;

        expect(configOf({ rankThreshold: 3, invert: true }))
            .toEqual({ rankThreshold: 3, invert: true });

        // A legacy row, stored before `invert` was a parameter.
        expect(configOf({ rankThreshold: 3 }))
            .toEqual({ rankThreshold: 3, invert: false });
    });

    /*
     * A PROTECTED BLOCK NAMING NOTHING RESERVES EVERYTHING.
     *
     * `BlockedWindow` follows `Unavailability`'s convention: an empty axis
     * means EVERY value on that axis, so a window with no days and no blocks
     * is the whole grid reserved as a HARD rule, not nothing reserved. The
     * solver accepts it without complaint and every session of the applying
     * kinds becomes unplaceable, surfacing as "no feasible placement" with
     * nothing pointing at the cause.
     *
     * The two axes cannot both be `required`, because "block 4 every day" and
     * "all of Wednesday" are each legitimate and each leaves one axis empty. So
     * the guard is a skip, and this is what pins it.
     */
    it('SKIPS a protected block that names neither a day nor a block', () => {
        const result = toWireConstraint(
            row({ type: 'protected_block', severity: 'HARD', weight: null, params: { days: [], blocks: '' } }),
            noKinds,
        ) as { skip?: string };

        expect(result.skip).toMatch(/ENTIRE timetable/);
    });

    it.each([
        ['a block on every day', { days: [], blocks: '4' }, { days: [], blocks: [3] }],
        ['a whole day', { days: [3], blocks: '' }, { days: [3], blocks: [] }],
    ])('sends %s as one recurring window', (_label, params, expected) => {
        // Each of these leaves ONE axis empty, which is the legitimate case the
        // skip above must not catch. `weeks` is empty either way: the proto
        // reads that as every week, which is what "recurring" means.
        const config = (toWireConstraint(
            row({ type: 'protected_block', severity: 'HARD', weight: null, params }),
            noKinds,
        ) as { config: Record<string, { windows: unknown[] }> }).config.protectedBlock!;

        expect(config.windows).toEqual([{ ...expected, weeks: [] }]);
    });

    /*
     * BOTH IS AN EMPTY SCOPE, for every rule that carries one, not just
     * `compactness`, which is why the mapping is one shared function.
     *
     * The proto defines empty as "both axes counted independently", so naming
     * both scopes explicitly is a second spelling of one state, and that is what
     * `inputHash` cannot see past: one configured rule would hash two ways and a
     * retry would launch a fresh run instead of replaying.
     */
    it.each([
        'compactness',
        'max_consecutive_blocks',
        'max_daily_span',
        'minimize_location_change',
    ])('sends %s BOTH as an empty scope, and each single axis as itself', (key) => {
        const type = findConstraintType(key)!;
        const others = Object.fromEntries(
            type.params.filter((p) => p.key !== 'scope').map((p) => [p.key, p.default ?? p.min ?? 1]),
        );
        const scopeOf = (scope: string) => ((toWireConstraint(
            row({ type: key, severity: 'SOFT', weight: 5, params: { ...others, scope } }),
            noKinds,
        ) as { config: Record<string, Record<string, unknown>> }).config[type.wireField!]!).scope;

        expect(scopeOf('BOTH')).toEqual([]);
        // 1 = COMPACTNESS_SCOPE_GROUP, 2 = COMPACTNESS_SCOPE_PERSON.
        expect(scopeOf('GROUP')).toEqual([1]);
        expect(scopeOf('PERSON')).toEqual([2]);
    });

    /*
     * The exam-period direction, which is what makes "push exams INTO the exam
     * weeks" expressible at all rather than only "keep them clear".
     *
     * The absent-reads-as-false half is sharper here than for room rank. This
     * type shipped with NO parameters, so every row any tenant already has
     * carries `params: {}`, and the wire field's own encoder writes the byte
     * whenever the value is not literally `false`, so a mapper returning `{}`
     * relies on `undefined` reaching the encoder and landing on zero. Pinning
     * the value means the direction is something this mapper decided.
     */
    it('carries the exam-period direction, and reads an absent one as false', () => {
        const configOf = (params: Record<string, unknown>) => (toWireConstraint(
            row({ type: 'minimize_exam_week_sessions', severity: 'SOFT', weight: 8, params }),
            noKinds,
        ) as { config: Record<string, unknown> }).config.minimizeExamWeek;

        expect(configOf({ invert: true })).toEqual({ invert: true });

        // Every row written before this parameter existed, which is all of them.
        expect(configOf({})).toEqual({ invert: false });
    });

    /*
     * UNLIKE room rank, this one seeds FALSE. The inverted direction exists for
     * exam-kind sessions specifically, so a rule created without a thought about
     * direction should keep exam weeks clear, which is what this type has
     * always done.
     */
    it('provisions the exam-period rule pointing away from exam weeks', () => {
        expect(defaultConstraintRow(findConstraintType('minimize_exam_week_sessions')!).params)
            .toEqual({ invert: false });
    });

    /*
     * A NEW tenant is provisioned preferring its best rooms, but NOT enabled:
     * `rankThreshold` is `required` with deliberately no default ("premium" is
     * per-institution), so `defaultEnabled: true` (2026-08-31, tuned to match
     * the `test` tenant's live settings) seeded every OTHER tenant a row that
     * was enabled and unsendable — `validateConstraint`/`toWireConstraint`
     * both refuse it, and the real solver rejected it with `INVALID_ARGUMENT`
     * on the very first run, the identical shape of bug this file's
     * `minimize_block_usage`/`minimize_specifc_day` cases document above.
     * `defaultConstraintRow` still seeds the DIRECTION (`invert: true`, the
     * product's stated preference) so enabling the rule needs only a
     * threshold, not a rebuild of the row from scratch.
     */
    it('provisions a new tenant with the room-rank direction set, but not enabled', () => {
        const type = findConstraintType('minimize_high_ranking_rooms')!;
        const seeded = defaultConstraintRow(type);

        expect(seeded.params).toEqual({ invert: true });
        expect(seeded.isEnabled).toBe(false);
    });

    it('carries weight for SOFT types and zeroes it for HARD ones', () => {
        const soft = toWireConstraint(
            row({ type: 'minimize_first_block', severity: 'SOFT', weight: 7 }),
            noKinds,
        ) as { config: { weight: number } };
        const hard = toWireConstraint(row({ weight: 99 }), noKinds) as { config: { weight: number } };

        expect(soft.config.weight).toBe(7);
        // The solver ignores weight on a HARD type; sending 99 would imply it
        // means something.
        expect(hard.config.weight).toBe(0);
    });

    it('resolves kind scopes to kind KEYS, which is what the wire carries', () => {
        const result = toWireConstraint(
            row({ scopes: [{ offeringId: null, kindId: 'kind-1' }] }),
            new Map([['kind-1', 'lecture']]),
        );

        expect((result as { config: { appliesToKinds: string[] } }).config.appliesToKinds).toEqual(['lecture']);
    });

    it('SKIPS an offering-scoped constraint rather than widening it', () => {
        // ConstraintConfig has applies_to_kinds only. Sending it unscoped would
        // apply the rule to EVERY offering, the opposite of what was configured.
        const result = toWireConstraint(
            row({ scopes: [{ offeringId: 'offering-1', kindId: null }] }),
            noKinds,
        );

        expect('skip' in result).toBe(true);
        expect((result as { skip: string }).skip).toContain('offerings');
    });

    it('skips a type that is not in the catalogue at all', () => {
        const result = toWireConstraint(row({ type: 'invented_by_hand' }), noKinds);

        expect('skip' in result).toBe(true);
    });
});

describe('the hard day caps (issue #56)', () => {
    const scopeless: { offeringId: string | null; kindId: string | null }[] = [];
    const noKinds = new Map<string, string>();
    const row = (type: string, params: Record<string, unknown>) => ({
        id: 'c', type, severity: 'HARD', weight: null, params, scopes: scopeless,
    });

    it('sends max_days with its scope and cap, HARD so the weight is zero', () => {
        const result = toWireConstraint(row('max_days', { scope: 'PERSON', maxDays: 2 }), noKinds);
        const config = (result as { config: Record<string, unknown> }).config;

        expect(config.maxDays).toEqual({ scope: [CompactnessScope.COMPACTNESS_SCOPE_PERSON], maxDays: 2 });
        expect(config.weight).toBe(0);
    });

    it('sends max_consecutive_days with BOTH scopes as an empty list, the wire\'s own convention', () => {
        const result = toWireConstraint(
            row('max_consecutive_days', { scope: 'BOTH', maxConsecutiveDays: 4 }),
            noKinds,
        );
        const config = (result as { config: Record<string, unknown> }).config;

        expect(config.maxConsecutiveDays).toEqual({ scope: [], maxConsecutiveDays: 4 });
    });

    it('are HARD in the catalogue: a cap a weight could outvote would be the soft rule again', () => {
        for (const key of ['max_days', 'max_consecutive_days']) {
            expect(findConstraintType(key)?.severity, key).toBe('HARD');
            expect(findConstraintType(key)?.defaultEnabled, key).toBeUndefined();
        }
    });
});

describe('daybreak (issue #57)', () => {
    it('sends the scope and the wall-clock rest, HARD so the weight is zero', () => {
        const result = toWireConstraint(
            { id: 'c', type: 'daybreak', severity: 'HARD', weight: null, params: { scope: 'GROUP', minRestMinutes: 660 }, scopes: [] },
            new Map<string, string>(),
        );
        const config = (result as { config: Record<string, unknown> }).config;

        expect(config.daybreak).toEqual({ scope: [CompactnessScope.COMPACTNESS_SCOPE_GROUP], minRestMinutes: 660 });
        expect(config.weight).toBe(0);
    });

    it('accepts 0 minutes as a real value (ordering only), not as unset', () => {
        const result = toWireConstraint(
            { id: 'c', type: 'daybreak', severity: 'HARD', weight: null, params: { scope: 'BOTH', minRestMinutes: 0 }, scopes: [] },
            new Map<string, string>(),
        );

        expect('config' in result).toBe(true);
        expect((result as { config: Record<string, unknown> }).config.daybreak).toEqual({ scope: [], minRestMinutes: 0 });
    });
});

describe('severityMismatch', () => {
    it('reports a stored severity that contradicts the catalogue', () => {
        const type = findConstraintType('no_double_booking_room')!;

        expect(severityMismatch(type, 'SOFT')).toEqual({ expected: 'HARD', stored: 'SOFT' });
        expect(severityMismatch(type, 'HARD')).toBeNull();
    });
});
