import { describe, expect, it } from 'vitest';
import {
    CONSTRAINT_TYPES,
    SOLVER_OWNED_CONSTRAINT_TYPES,
    STRUCTURAL_CONSTRAINT_TYPES,
    constraintCatalogueDrift,
    defaultConstraintRow,
    findConstraintType,
    severityMismatch,
} from '../shared/constraintTypes';
import { toWireConstraint } from '../server/utils/solverInput';

/**
 * Guards the one invariant `shared/constraintTypes.ts` exists to hold.
 *
 * The rule builder offers what the catalogue declares; `server/utils/violations.ts`
 * evaluates what the two type lists name. If those diverge, a tenant can
 * configure a constraint that is enabled, reports nothing, and means nothing —
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

    it('marks structural types as app-evaluated and the rest as solver-owned', () => {
        for (const type of CONSTRAINT_TYPES) {
            const expected = (STRUCTURAL_CONSTRAINT_TYPES as readonly string[]).includes(type.key)
                ? 'app'
                : 'solver';

            expect(type.evaluator, `${type.key} evaluator`).toBe(expected);
        }
    });

    it('covers exactly the two evaluator lists', () => {
        expect(CONSTRAINT_TYPES).toHaveLength(
            STRUCTURAL_CONSTRAINT_TYPES.length + SOLVER_OWNED_CONSTRAINT_TYPES.length,
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
        // Types awaiting their proto field have no wireField yet — see below.
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
         * opposite — that the rule was SKIPPED — with a sibling asserting
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
         * So an empty `roles` is the only ACCEPTED value, not an unfinished one
         * — a future `roles` param on this catalogue entry would fail every
         * solve until the solver decides that scope. Asserted exactly, so adding
         * a role in `buildVariant` fails here rather than at StartRun.
         *
         * EMPTY BUT PRESENT, and that distinction cost a real failure. This
         * originally asserted `{}`, matching every other parameterless variant —
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

    it('has a wire field for every catalogue type', () => {
        /*
         * The replacement tripwire, pointing the other way. `person_preference_fit`
         * was the last type without a field, so the catalogue is complete — and
         * the skip-when-unmapped branch in `toWireConstraint` is currently
         * unreachable from it.
         *
         * That branch STAYS: the situation recurs whenever a catalogue entry
         * ships ahead of the schema, and dropping a rule silently is the failure
         * it exists to prevent. This assertion is what makes the next such entry
         * announce itself — it fails, and whoever added the type decides
         * deliberately whether the field exists yet, instead of discovering
         * months later that an enabled rule never crossed.
         */
        const unmapped = CONSTRAINT_TYPES.filter((type) => !type.wireField).map((type) => type.key);

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
        // penalised block by one — a rule that avoids the wrong lesson.
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
        // the replacement existed must keep working — `type` is createOnly, so
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
        // rankThreshold 0 means "penalize every room" — a genuine policy.
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
     * the generated encoder, so an `invert` key was silently dropped — a control
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
     * A NEW tenant is provisioned preferring its best rooms; an existing row is
     * never rewritten. `defaultConstraintRow` seeds params from the catalogue
     * defaults, so this pins the product's opinion in the one place it lives.
     */
    it('provisions a new tenant with the room-rank direction set, but still disabled', () => {
        const type = findConstraintType('minimize_high_ranking_rooms')!;
        const seeded = defaultConstraintRow(type);

        expect(seeded.params).toEqual({ invert: true });

        // Unchanged convention: only the structural rules start enabled, because
        // switching a solver-steering rule on would silently change every
        // existing tenant's next timetable.
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
        // apply the rule to EVERY offering — the opposite of what was configured.
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

describe('severityMismatch', () => {
    it('reports a stored severity that contradicts the catalogue', () => {
        const type = findConstraintType('no_double_booking_room')!;

        expect(severityMismatch(type, 'SOFT')).toEqual({ expected: 'HARD', stored: 'SOFT' });
        expect(severityMismatch(type, 'HARD')).toBeNull();
    });
});
