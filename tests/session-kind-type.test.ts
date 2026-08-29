import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { toWireConstraint } from '../server/utils/solverInput';
import { CONSTRAINT_TYPES, findConstraintType, validateConstraintShape } from '../shared/constraintTypes';
import { SESSION_KIND_TYPES } from '../shared/sessionKindType';
import type { SessionKindType } from '../shared/sessionKindType';

/**
 * `SessionKind.type` — the FIXED classification behind a tenant-named kind, and
 * the rules that derive their scope from it.
 *
 * WHAT THIS REPLACES. "Which sessions are exams" used to be said once per rule,
 * as `ConstraintScope` rows, and that had a specific bad failure: the wire reads
 * `applies_to_kinds` EMPTY as EVERY KIND. So forgetting to scope
 * `exam_spacing_same_day` did not switch it off — it silently promoted "no two
 * exams for a group in a day" to "no two SESSIONS of any kind in a day", live,
 * on the next solve.
 *
 * The classification now lives once per kind, and the derivation has one
 * property that everything else here protects:
 *
 *   AN EMPTY DERIVED SET IS A SKIP, NEVER AN EMPTY LIST.
 *
 * A tenant with nothing marked EXAM must have the rule WITHHELD and reported,
 * because the wire cannot say "no kinds" — sending `[]` would mean the exact
 * opposite of what the tenant configured. That inversion is the whole reason
 * this feature is not just a nicer scoping UI.
 */
let f: Fixtures;

beforeAll(async () => {
    f = await seed();
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const DERIVED = CONSTRAINT_TYPES.filter((type) => type.appliesToKindType);

/** A stored row shaped as `toWireConstraint` takes it. */
const row = (type: string, scopes: { offeringId: string | null; kindId: string | null }[] = []) => ({
    id: 'c1',
    type,
    severity: 'SOFT',
    weight: 5,
    // Enough to satisfy every required parameter of the types used here, so a
    // `skip` in these tests is always about SCOPE and never about params.
    params: { minDaysBetween: 2, scope: 'group' },
    scopes,
});

const byType = (entries: [SessionKindType, string[]][]) => new Map(entries);

describe('deriving the scope from the classification', () => {
    it('has derived types at all, so nothing below is vacuous', () => {
        expect(DERIVED.map((type) => type.key)).toEqual(
            expect.arrayContaining(['exam_spacing_same_day', 'exam_spacing_window']),
        );
    });

    it('sends every EXAM-typed kind, whatever the tenant named them', () => {
        for (const type of DERIVED) {
            // `Klausur`, not `exam`: the point of the column is that the KEY is
            // still the tenant's and nothing reads it.
            const mapped = toWireConstraint(row(type.key), new Map(), byType([['EXAM', ['Klausur', 'Nachklausur']]]));

            expect('config' in mapped, type.key).toBe(true);
            expect((mapped as { config: { appliesToKinds: string[] } }).config.appliesToKinds)
                .toEqual(['Klausur', 'Nachklausur']);
        }
    });

    it('IGNORES a hand-written scope rather than letting two sources disagree', () => {
        const mapped = toWireConstraint(
            row('exam_spacing_same_day', [{ offeringId: null, kindId: 'kind-lecture' }]),
            new Map([['kind-lecture', 'lecture']]),
            byType([['EXAM', ['Klausur']]]),
        );

        // The stored scope names `lecture`; the classification names `Klausur`.
        // The classification wins, and the write boundary refuses to create this
        // state in the first place (see below).
        expect((mapped as { config: { appliesToKinds: string[] } }).config.appliesToKinds).toEqual(['Klausur']);
    });

    it('SKIPS, rather than sending an empty list, when nothing is classified', () => {
        for (const type of DERIVED) {
            const mapped = toWireConstraint(row(type.key), new Map(), byType([['TEACHING', ['lecture']]]));

            // The single most important assertion in this file. `[]` on the wire
            // means EVERY kind, so an empty derived set sent as-is would apply
            // an exam rule to every lecture in the institution.
            expect('skip' in mapped, type.key).toBe(true);
            expect((mapped as { skip: string }).skip, type.key).toContain('EXAM');
        }
    });

    it('SKIPS when the caller supplies no classification map at all', () => {
        // Absent must read as "nothing is classified", not as "scope unknown, send
        // it anyway" — the unsafe default is the one that widens the rule.
        const mapped = toWireConstraint(row('exam_spacing_same_day'), new Map());

        expect('skip' in mapped).toBe(true);
    });

    it('leaves an ordinary rule reading its own scopes, unchanged', () => {
        const mapped = toWireConstraint(
            row('compactness', [{ offeringId: null, kindId: 'kind-lecture' }]),
            new Map([['kind-lecture', 'lecture']]),
            byType([['EXAM', ['Klausur']]]),
        );

        expect((mapped as { config: { appliesToKinds: string[] } }).config.appliesToKinds).toEqual(['lecture']);
    });

    it('still lets an ordinary rule be deliberately unscoped', () => {
        // Empty means "every kind" here and the tenant chose it. Only a DERIVED
        // type turns an empty set into a skip.
        const mapped = toWireConstraint(row('compactness'), new Map(), byType([['EXAM', ['Klausur']]]));

        expect((mapped as { config: { appliesToKinds: string[] } }).config.appliesToKinds).toEqual([]);
    });
});

describe('the write boundary', () => {
    it('refuses a hand-written scope on a derived type', () => {
        for (const type of DERIVED) {
            const problems = validateConstraintShape({ type: type.key, scopeCount: 1 });

            // Refused, not dropped on save: dropping is the same silence one
            // step earlier, with the tenant's choice vanishing unexplained.
            expect(problems.map((p) => p.field), type.key).toContain('scopes');
        }
    });

    it('accepts a derived type with no scopes', () => {
        for (const type of DERIVED) {
            expect(validateConstraintShape({ type: type.key, scopeCount: 0 }), type.key).toEqual([]);
        }
    });

    it('leaves scopes alone on an ordinary type', () => {
        expect(validateConstraintShape({ type: 'compactness', scopeCount: 2 })).toEqual([]);
    });

    it('treats an untouched scope list as untouched, not as cleared', () => {
        expect(validateConstraintShape({ type: 'exam_spacing_same_day' })).toEqual([]);
    });
});

describe('the column', () => {
    it('defaults to TEACHING, so an unclassified kind reaches no exam rule', async () => {
        const kind = await ownerDb.sessionKind.findUnique({ where: { id: 'test-kind-a' } });

        expect(kind?.type).toBe('TEACHING');
    });

    it('accepts every value the shared vocabulary declares', async () => {
        for (const value of SESSION_KIND_TYPES) {
            await ownerDb.sessionKind.update({ where: { id: 'test-kind-a' }, data: { type: value } });

            const kind = await ownerDb.sessionKind.findUnique({ where: { id: 'test-kind-a' } });

            expect(kind?.type).toBe(value);
        }

        await ownerDb.sessionKind.update({ where: { id: 'test-kind-a' }, data: { type: 'TEACHING' } });
    });

    it('refuses a value outside the enum', async () => {
        await expect(ownerDb.$executeRawUnsafe(
            `UPDATE session_kind SET type = 'QUIZ' WHERE id = '${f.tenantA ? 'test-kind-a' : ''}'`,
        )).rejects.toThrow();
    });
});

describe('the migration backfill', () => {
    /**
     * The half that cannot be skipped. A tenant who had hand-scoped
     * `exam_spacing_*` to their exam kind, and is not migrated, gets an empty
     * derived set — which this feature correctly refuses to send. The rule goes
     * quiet with nothing on screen having changed.
     *
     * It is avoidable because the answer was already written down: scoping an
     * exam rule to a kind IS the statement "this kind is an exam", made in the
     * only place that could hold it before the column existed.
     */
    /**
     * COMMENTS STRIPPED, and that is not fussiness. This migration explains
     * itself at length and names both derived types, `is_enabled` and
     * `constraint_scope` in its prose — so every assertion below passes against
     * the comments alone. Removing a type from the actual `IN (...)` list left
     * this whole block green until the strip was added, which is the failure it
     * exists to catch.
     */
    const statements = readFileSync(
        'prisma/migrations/20260829180000_session_kind_type/migration.sql',
        'utf8',
    ).replace(/^\s*--.*$/gm, '');

    it('infers EXAM from the scopes those rules already had', () => {
        expect(statements).toContain("SET \"type\" = 'EXAM'");
        expect(statements).toContain('constraint_scope');
    });

    it('names every derived type, so adding one cannot leave its tenants behind', () => {
        for (const type of DERIVED) {
            expect(statements, type.key).toContain(`'${type.key}'`);
        }
    });

    it('does not filter on is_enabled — a disabled rule still records the classification', () => {
        expect(statements).not.toContain('is_enabled');
    });
});

describe('the catalogue', () => {
    it('never declares a kind type outside the shared vocabulary', () => {
        for (const type of CONSTRAINT_TYPES) {
            if (type.appliesToKindType) {
                expect(SESSION_KIND_TYPES, type.key).toContain(type.appliesToKindType);
            }
        }
    });

    it('leaves minimize_exam_week_sessions manually scoped, on purpose', () => {
        /*
         * It is named for an AXIS, not a direction: with `invert` off — the
         * default — it keeps exam weeks CLEAR, which a tenant wants applied to
         * teaching kinds. Deriving it to EXAM would invert its ordinary meaning
         * while looking like a tidy-up.
         */
        expect(findConstraintType('minimize_exam_week_sessions')?.appliesToKindType).toBeUndefined();
    });
});
