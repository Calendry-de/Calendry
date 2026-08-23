import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * Kind-scoped constraint variants, and the rule that stops them being
 * duplicates.
 *
 * WHY THE GUARD EXISTS. Every live catalogue type now has a DEFAULT row per
 * tenant, so a second unscoped row of the same type is not an "additional rule"
 * — it is a second tenant-wide rule with its own weight, and both are sent to
 * the solver. That is the duplicate-constraint defect this project already
 * fixed once, and the "Add scoped variant" button reintroduced it by creating
 * rows it had no way to scope.
 *
 * WHY IT IS NOT A DATABASE CONSTRAINT. "has at least one row in another table"
 * is not expressible as a CHECK, and the partial unique index governs only how
 * many DEFAULTS exist. The rule lives in `beforeCreate`, and these tests are
 * what pin it.
 */
const TENANT = 'test-tenant-a';

let cookie: string | null;
let kindId: string;

beforeAll(async () => {
    await seed();
    ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));

    kindId = (await ownerDb.sessionKind.findFirstOrThrow({
        where: { tenantId: TENANT }, select: { id: true },
    })).id;

    // The seed creates no constraints, so the "already has a default" condition
    // has to be built rather than assumed.
    await ownerDb.constraint.create({
        data: {
            tenantId: TENANT,
            type: 'minimize_exam_week_sessions',
            name: 'Keep exam weeks clear',
            severity: 'SOFT',
            weight: 50,
            isDefault: true,
            isEnabled: true,
        },
    });
});

afterEach(async () => {
    await ownerDb.constraint.deleteMany({ where: { tenantId: TENANT, isDefault: false } });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const create = (body: Record<string, unknown>) => api('/api/constraints', {
    method: 'POST',
    cookie,
    body: JSON.stringify({
        type: 'minimize_exam_week_sessions', name: 'Variant', severity: 'SOFT', weight: 40, ...body,
    }),
});

describe('a variant of a type that already has a default', () => {
    it('is REFUSED when it names no scope', async () => {
        const res = await create({});

        expect(res.status).toBe(422);
        expect(String(res.body.statusMessage)).toContain('at least one session kind');
    });

    it('writes nothing when refused', async () => {
        await create({});

        const count = await ownerDb.constraint.count({
            where: { tenantId: TENANT, type: 'minimize_exam_week_sessions' },
        });

        // Still just the default. A refusal that left a row behind would be
        // worse than no guard, because the duplicate would be invisible.
        expect(count).toBe(1);
    });

    it('is ACCEPTED when it names a kind, and stores the scope in the same request', async () => {
        const res = await create({ name: 'Exam weeks — seminars', scopes: [{ kindId }] });

        expect(res.status).toBe(201);
        expect(res.body.isDefault).toBe(false);

        const scopes = await ownerDb.constraintScope.findMany({
            where: { constraintId: res.body.id },
            select: { kindId: true, offeringId: true },
        });

        // One request, both rows — not "create then scope", which would leave a
        // window where the variant was an unscoped duplicate.
        expect(scopes).toEqual([{ kindId, offeringId: null }]);
    });
});

describe('a type with no default row', () => {
    it('accepts an unscoped row, because there is nothing to duplicate', async () => {
        const res = await create({ type: 'minimize_online_sessions', name: 'Prefer on-site', weight: 5 });

        expect(res.status).toBe(201);
    });
});

describe('scopes are editable after creation', () => {
    it('REFUSES an edit that would empty the scopes into a duplicate', async () => {
        const created = await create({ name: 'Scoped', scopes: [{ kindId }] });

        const res = await api(`/api/constraints/${created.body.id}`, {
            method: 'PATCH', cookie, body: JSON.stringify({ scopes: [] }),
        });

        // Guarding create alone would let the same illegal state be reached in
        // two requests instead of one.
        expect(res.status).toBe(422);
        expect(String(res.body.statusMessage)).toContain('second tenant-wide');

        const scopes = await ownerDb.constraintScope.count({ where: { constraintId: created.body.id } });

        expect(scopes).toBe(1);
    });

    it('allows changing WHICH kinds, replacing the set wholesale', async () => {
        const other = await ownerDb.sessionKind.create({
            data: { tenantId: TENANT, key: 'scope-probe', name: 'Scope Probe' },
        });
        const created = await create({ name: 'Scoped', scopes: [{ kindId }] });

        const res = await api(`/api/constraints/${created.body.id}`, {
            method: 'PATCH', cookie, body: JSON.stringify({ scopes: [{ kindId: other.id }] }),
        });

        expect(res.status).toBe(200);

        const scopes = await ownerDb.constraintScope.findMany({
            where: { constraintId: created.body.id }, select: { kindId: true },
        });

        expect(scopes).toEqual([{ kindId: other.id }]);

        await ownerDb.constraintScope.deleteMany({ where: { kindId: other.id } });
        await ownerDb.sessionKind.delete({ where: { id: other.id } });
    });
});
