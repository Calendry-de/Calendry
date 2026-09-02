import { describe, expect, it } from 'vitest';
import { CONSTRAINT_TYPES, findConstraintType, validateConstraint } from '../shared/constraintTypes';

/**
 * `validateConstraint`: the pre-flight check that runs BEFORE a `solver_run`
 * row is created (`server/utils/solverPreflight.ts`,
 * `POST /api/solver/runs`), so a constraint that cannot be sent to the solver
 * is caught at the click instead of 68ms into a run nobody can see the reason
 * for.
 *
 * WHY THE DEFAULT MATTERS. ~24 of 32 currently-enabled catalogue types take no
 * params at all (`no_double_booking_room`, `group_veto`,
 * `exact_frequency_per_offering`, …) and must produce ZERO issues no matter
 * what: this is checked once, over the whole catalogue, so a future type
 * cannot reintroduce a false-positive machine by accident.
 */
const row = (over: Partial<Parameters<typeof validateConstraint>[0]> = {}) => ({
    id: 'c1',
    name: 'My rule',
    type: 'no_double_booking_room',
    severity: 'HARD',
    params: {},
    ...over,
});

describe('validateConstraint: the parameterless majority', () => {
    it('raises nothing for every catalogue type that declares no params and no unsendableWhen', () => {
        for (const type of CONSTRAINT_TYPES) {
            if (type.params.length > 0 || type.unsendableWhen || type.relation) {
                continue;
            }

            const issues = validateConstraint(row({ type: type.key, severity: type.severity ?? 'HARD', params: {} }));

            expect(issues, type.key).toEqual([]);
        }
    });
});

describe('validateConstraint: unknown type', () => {
    it('flags a type not in the catalogue, rather than throwing', () => {
        const issues = validateConstraint(row({ type: 'not_a_real_type' }));

        expect(issues).toHaveLength(1);
        expect(issues[0]?.code).toBe('UNKNOWN_TYPE');
        expect(issues[0]?.constraintName).toBe('My rule');
    });
});

describe('validateConstraint: missing required params', () => {
    it('names the missing param by its label, not its wire key', () => {
        const issues = validateConstraint(row({ type: 'max_online_ratio_per_group', params: {} }));

        expect(issues).toHaveLength(1);
        expect(issues[0]?.code).toBe('MISSING_REQUIRED_PARAM');
        expect(issues[0]?.message).toContain('Maximum online share');
        expect(issues[0]?.message).toContain('Measured over');
    });

    it('raises nothing once every required param is set', () => {
        const issues = validateConstraint(row({
            type: 'max_online_ratio_per_group',
            severity: 'HARD',
            params: { maxRatio: 30, window: 'SHARE_WINDOW_PER_TERM' },
        }));

        expect(issues).toEqual([]);
    });
});

describe('validateConstraint: minimize_block_usage (the production bug)', () => {
    const type = findConstraintType('minimize_block_usage')!;

    it('flags the exact configuration that reached the solver as INVALID_ARGUMENT', () => {
        // The real row from the bug report: seeded enabled, params: {}.
        const issues = validateConstraint(row({
            id: '01a06251-77b2-701c-873e-53d6e65ec21e',
            name: 'Avoid particular blocks',
            type: 'minimize_block_usage',
            severity: 'SOFT',
            params: {},
        }));

        expect(issues).toHaveLength(1);
        expect(issues[0]?.code).toBe('EMPTY_BLOCK_SELECTION');
        expect(issues[0]?.constraintId).toBe('01a06251-77b2-701c-873e-53d6e65ec21e');
        expect(issues[0]?.severity).toBe('SOFT');
        expect(issues[0]?.fixHint).toMatch(/first|last|block/i);
    });

    it('is satisfied by block positions alone', () => {
        expect(validateConstraint(row({ type: type.key, severity: 'SOFT', params: { blocks: '1,4' } }))).toEqual([]);
    });

    it('is satisfied by "first" alone, with no block positions', () => {
        expect(validateConstraint(row({ type: type.key, severity: 'SOFT', params: { first: true } }))).toEqual([]);
    });

    it('is satisfied by "last" alone', () => {
        expect(validateConstraint(row({ type: type.key, severity: 'SOFT', params: { last: true } }))).toEqual([]);
    });

    it('is not satisfied by a blocks string that parses to nothing', () => {
        const issues = validateConstraint(row({ type: type.key, severity: 'SOFT', params: { blocks: 'not,numbers' } }));

        expect(issues.map((i) => i.code)).toEqual(['EMPTY_BLOCK_SELECTION']);
    });
});

describe('validateConstraint: protected_block', () => {
    it('flags no days and no blocks: that means the ENTIRE timetable, not nothing', () => {
        const issues = validateConstraint(row({ type: 'protected_block', severity: 'HARD', params: {} }));

        expect(issues).toHaveLength(1);
        expect(issues[0]?.code).toBe('EMPTY_PROTECTED_WINDOW');
    });

    it('is satisfied by days alone (an empty blocks axis legitimately means "all day")', () => {
        expect(validateConstraint(row({
            type: 'protected_block', severity: 'HARD', params: { days: [1, 3] },
        }))).toEqual([]);
    });

    it('is satisfied by blocks alone (an empty days axis legitimately means "every day")', () => {
        expect(validateConstraint(row({
            type: 'protected_block', severity: 'HARD', params: { blocks: '4' },
        }))).toEqual([]);
    });
});
