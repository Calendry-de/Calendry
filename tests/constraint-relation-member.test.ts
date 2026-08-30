import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * `different_time` — the first RELATION-TYPE constraint (ADR-0028 in
 * calendry-solver): its operands are an ORDERED SET OF OFFERINGS
 * (`ConstraintRelationMember`), never `ConstraintScope` — a relation's
 * Offerings are what the rule is ABOUT, not a filter narrowing it.
 *
 * WHY AT LEAST TWO. `defaultConstraintTypes()` excludes every relation type —
 * there is no membership a seed could choose on the tenant's behalf — so
 * every row here is tenant-authored, and one naming fewer than two Offerings
 * relates nothing. `validateConstraintShape`'s `memberCount` check is what
 * these tests pin.
 */
const TENANT = 'test-tenant-a';

let cookie: string | null;
let offeringA: string;
let offeringB: string;
let offeringC: string;

beforeAll(async () => {
    await seed();
    ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));

    // The seed creates one Offering (`test-offering-a`); a relation needs a
    // second and third to exercise "add" and "replace the set wholesale".
    offeringA = 'test-offering-a';

    const term = await ownerDb.term.findFirstOrThrow({ where: { tenantId: TENANT }, select: { id: true } });
    const kind = await ownerDb.sessionKind.findFirstOrThrow({ where: { tenantId: TENANT }, select: { id: true } });

    offeringB = (await ownerDb.offering.create({
        data: { tenantId: TENANT, termId: term.id, kindId: kind.id, title: 'Networks', frequency: 1 },
    })).id;
    offeringC = (await ownerDb.offering.create({
        data: { tenantId: TENANT, termId: term.id, kindId: kind.id, title: 'Security', frequency: 1 },
    })).id;
});

afterEach(async () => {
    await ownerDb.constraint.deleteMany({ where: { tenantId: TENANT, type: 'different_time' } });
});

afterAll(async () => {
    await ownerDb.offering.deleteMany({ where: { id: { in: [offeringB, offeringC] } } });
    await teardown();
    await ownerDb.$disconnect();
});

const create = (body: Record<string, unknown>) => api('/api/constraints', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ type: 'different_time', name: 'No overlap', severity: 'HARD', weight: null, ...body }),
});

/**
 * The create path's refinement issues arrive as a ZodError whose `message` is
 * a JSON-encoded issue array (`data.name === 'ZodError'`), not the plain
 * `data.issues` the update path throws directly — same two-shape distinction
 * `constraint-write-guard-api.test.ts` normalises.
 */
function refinementMessages(body: unknown): string[] {
    const data = (body as { data?: { name?: string; message?: unknown } })?.data;

    if (data?.name !== 'ZodError' || typeof data.message !== 'string') {
        return [];
    }

    try {
        const issues = JSON.parse(data.message) as { message?: string }[];

        return issues.map((i) => i.message ?? '');
    } catch {
        return [];
    }
}

describe('different_time', () => {
    it('is REFUSED with no members', async () => {
        const res = await create({});

        expect(res.status).toBe(400);
        expect(refinementMessages(res.body).join(' ')).toContain('at least 2 offerings');
    });

    it('is REFUSED with only one member', async () => {
        const res = await create({ members: [{ offeringId: offeringA }] });

        expect(res.status).toBe(400);
        expect(refinementMessages(res.body).join(' ')).toContain('at least 2 offerings');
    });

    it('writes nothing when refused', async () => {
        await create({});

        const count = await ownerDb.constraint.count({ where: { tenantId: TENANT, type: 'different_time' } });

        expect(count).toBe(0);
    });

    it('is ACCEPTED with two members, stored in the same request with their position', async () => {
        const res = await create({ members: [{ offeringId: offeringA }, { offeringId: offeringB }] });

        expect(res.status).toBe(201);

        const members = await ownerDb.constraintRelationMember.findMany({
            where: { constraintId: res.body.id },
            orderBy: { position: 'asc' },
            select: { offeringId: true, position: true },
        });

        expect(members).toEqual([
            { offeringId: offeringA, position: 0 },
            { offeringId: offeringB, position: 1 },
        ]);
    });

    it('is never seeded as a default row', async () => {
        // The seed helper provisions no `different_time` row, and neither does
        // any other tenant bootstrap path — there is no membership a default
        // could name.
        const count = await ownerDb.constraint.count({
            where: { tenantId: TENANT, type: 'different_time', isDefault: true },
        });

        expect(count).toBe(0);
    });

    describe('members are editable after creation', () => {
        it('REFUSES an edit that would shrink the set below two', async () => {
            const created = await create({ members: [{ offeringId: offeringA }, { offeringId: offeringB }] });

            const res = await api(`/api/constraints/${created.body.id}`, {
                method: 'PATCH', cookie, body: JSON.stringify({ members: [{ offeringId: offeringA }] }),
            });

            expect(res.status).toBe(400);
            expect(String(res.body.statusMessage)).toContain('at least 2 offerings');

            const count = await ownerDb.constraintRelationMember.count({ where: { constraintId: created.body.id } });

            expect(count).toBe(2);
        });

        it('replaces the set wholesale, position following the new order', async () => {
            const created = await create({ members: [{ offeringId: offeringA }, { offeringId: offeringB }] });

            const res = await api(`/api/constraints/${created.body.id}`, {
                method: 'PATCH',
                cookie,
                body: JSON.stringify({ members: [{ offeringId: offeringC }, { offeringId: offeringA }] }),
            });

            expect(res.status).toBe(200);

            const members = await ownerDb.constraintRelationMember.findMany({
                where: { constraintId: created.body.id },
                orderBy: { position: 'asc' },
                select: { offeringId: true, position: true },
            });

            expect(members).toEqual([
                { offeringId: offeringC, position: 0 },
                { offeringId: offeringA, position: 1 },
            ]);
        });

        it('leaves members alone on an edit that does not touch them', async () => {
            const created = await create({ members: [{ offeringId: offeringA }, { offeringId: offeringB }] });

            const res = await api(`/api/constraints/${created.body.id}`, {
                method: 'PATCH', cookie, body: JSON.stringify({ name: 'Renamed' }),
            });

            expect(res.status).toBe(200);

            const count = await ownerDb.constraintRelationMember.count({ where: { constraintId: created.body.id } });

            expect(count).toBe(2);
        });
    });
});
