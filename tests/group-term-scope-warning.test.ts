import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * Warn-and-allow on `group_term` scope.
 *
 * Scoping a Group OUT of a Term whose Offerings or Sessions still reference it
 * is legal and harmless — `group_term` is a VISIBILITY scope, and the solver
 * never reads it (`assembleSolverInput` derives the Groups it needs from actual
 * references, precisely so tenant configuration cannot make an input
 * inconsistent). What changes is that the Group stops appearing in that Term's
 * pickers, so a link removed later cannot be re-added without restoring scope.
 *
 * Worth saying, not worth blocking — TAXONOMY.md §3's rule for manual edits,
 * applied to configuration.
 *
 * THE FOURTH SUITE HERE IS THE IMPORTANT ONE. The PUT's response shape is now
 * conditional on the relation declaring `warnAfterWrite`, and the proof that
 * conditionality did not leak is that every OTHER relation still returns a bare
 * array.
 */
const TENANT = 'test-tenant-a';
const TERM = 'test-term-a';
const GROUP_WITH_USAGE = 'test-group-seminar-a';   // carries session_group -> test-session-a
const GROUP_NO_USAGE = 'test-group-cohort-a';
const OFFERING = 'test-offering-a';

let cookie: string | null;
let otherTerm: string;

/** PUT the whole scope set, returning the `{ rows, warnings }` shape. */
const setScope = (groupId: string, termIds: string[]) => api<{ rows: unknown[]; warnings: string[] }>(
    `/api/groups/${groupId}/terms`,
    { method: 'PUT', cookie, body: JSON.stringify(termIds.map((termId) => ({ termId }))) },
);

beforeAll(async () => {
    await seed();
    ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));

    // A second Term to scope groups INTO, so the first is genuinely scoped out.
    const created = await ownerDb.term.create({
        data: {
            tenantId: TENANT,
            name: 'Scope-warning probe term',
            startDate: new Date('2030-01-07'),
            endDate: new Date('2030-03-29'),
        },
        select: { id: true },
    });

    otherTerm = created.id;
});

afterEach(async () => {
    await ownerDb.groupTerm.deleteMany({ where: { tenantId: TENANT } });
});

afterAll(async () => {
    await ownerDb.term.deleteMany({ where: { id: otherTerm } });
    await teardown();
    await ownerDb.$disconnect();
});

describe('scoping a Group out of a Term that still uses it', () => {
    it('warns, naming the term and counting the usage', async () => {
        const res = await setScope(GROUP_WITH_USAGE, [otherTerm]);

        expect(res.status).toBe(200);
        expect(res.body.warnings).toHaveLength(1);
        expect(res.body.warnings[0]).toContain('Session');
        expect(res.body.warnings[0]).toContain('still use this group');
    });

    it('SAVES anyway — the warning is advisory, not a refusal', async () => {
        // The whole point. A guard that warned and then refused would be a
        // block wearing a warning's clothes.
        await setScope(GROUP_WITH_USAGE, [otherTerm]);

        const read = await api<{ termId: string }[]>(`/api/groups/${GROUP_WITH_USAGE}/terms`, { cookie });

        expect((read.body as { termId: string }[]).map((r) => r.termId)).toEqual([otherTerm]);
    });

    it('counts Offerings as well as Sessions', async () => {
        await ownerDb.offeringGroup.create({
            data: { tenantId: TENANT, offeringId: OFFERING, groupId: GROUP_WITH_USAGE },
        });

        try {
            const res = await setScope(GROUP_WITH_USAGE, [otherTerm]);

            expect(res.body.warnings[0]).toContain('Offering');
            expect(res.body.warnings[0]).toContain('Session');
        } finally {
            await ownerDb.offeringGroup.deleteMany({
                where: { offeringId: OFFERING, groupId: GROUP_WITH_USAGE },
            });
        }
    });
});

describe('silence when there is nothing to warn about', () => {
    it('says nothing when the scoped-out Term does not use the Group', async () => {
        // The counter-example that stops the warning being unconditional noise.
        const res = await setScope(GROUP_NO_USAGE, [otherTerm]);

        expect(res.status).toBe(200);
        expect(res.body.warnings).toEqual([]);
    });

    it('says nothing when clearing every Term, because that WIDENS the group', async () => {
        // No rows means "available in every Term" (fail-open), so an empty set
        // scopes the Group out of nothing and cannot orphan anything. Asserted
        // rather than left to fall out of the query, because the `<> ALL('{}')`
        // edge case would otherwise match every Term and warn about all of them.
        await setScope(GROUP_WITH_USAGE, [otherTerm]);

        const res = await setScope(GROUP_WITH_USAGE, []);

        expect(res.status).toBe(200);
        expect(res.body.warnings).toEqual([]);
    });

    it('says nothing when the Term that uses the Group is still in scope', async () => {
        const res = await setScope(GROUP_WITH_USAGE, [TERM, otherTerm]);

        expect(res.status).toBe(200);
        expect(res.body.warnings).toEqual([]);
    });
});

describe('the conditional response shape did not leak', () => {
    it('keeps a BARE ARRAY for every relation without warnAfterWrite', async () => {
        // THE regression this suite exists for. Only `groups/terms` declares the
        // hook; if the shape change reached the shared route unconditionally,
        // these callers would silently receive an object where they read an
        // array — and `Array.isArray` on an object is false, so the picker would
        // render an empty set rather than erroring.
        const bare: [string, unknown[]][] = [
            [`/api/offerings/${OFFERING}/groups`, [{ groupId: GROUP_NO_USAGE }]],
            [`/api/offerings/${OFFERING}/lecturers`, []],
            [`/api/offerings/${OFFERING}/equipment`, []],
            [`/api/persons/test-person-a/roles`, []],
            [`/api/persons/test-person-a/groups`, []],
        ];

        for (const [path, body] of bare) {
            const res = await api<unknown>(path, {
                method: 'PUT', cookie, body: JSON.stringify(body),
            });

            expect(res.status, path).toBe(200);
            expect(Array.isArray(res.body), `${path} must still return a bare array`).toBe(true);
        }
    });

    it('returns the object shape ONLY for groups/terms', async () => {
        const res = await api<unknown>(`/api/groups/${GROUP_NO_USAGE}/terms`, {
            method: 'PUT', cookie, body: JSON.stringify([]),
        });

        expect(Array.isArray(res.body)).toBe(false);
        expect(res.body).toHaveProperty('rows');
        expect(res.body).toHaveProperty('warnings');
    });
});
