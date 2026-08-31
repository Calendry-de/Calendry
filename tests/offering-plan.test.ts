import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * OfferingPlan: a reusable, ORDERED bundle of Offering templates, applied to
 * a Group to create its whole course load in one action.
 *
 * THE ASSERTIONS THAT MATTER: applying creates one Offering per item, each
 * attached to the target Group and carrying the right `createdFromTemplateId`
 * (`applies a plan`); a template missing `kindId`/`title` refuses the WHOLE
 * apply rather than a partial batch (`refuses an incomplete template`);
 * re-applying to the SAME group is a no-op, never a duplicate (`idempotent`);
 * and a SECOND group taking the same subject joins the first group's
 * Offering rather than getting its own (`joins... instead of duplicating`).
 * Ordinary CRUD + permission shape follows `tests/offering-template.test.ts`'s
 * lead.
 */
let adminCookie = '';
let viewerCookie = '';
let ids: Awaited<ReturnType<typeof seed>>;

interface TemplateRow { id: string }
interface PlanRow { id: string; name: string }

async function createTemplate(name: string, overrides: Record<string, unknown> = {}): Promise<TemplateRow> {
    const res = await api<TemplateRow>('/api/offering-templates', {
        method: 'POST',
        cookie: adminCookie,
        body: JSON.stringify({
            name,
            title: name,
            kindId: 'test-kind-a',
            frequency: 2,
            durationBlocks: 1,
            ...overrides,
        }),
    });

    return res.body;
}

async function createPlan(name: string, overrides: Record<string, unknown> = {}): Promise<PlanRow> {
    const res = await api<PlanRow>('/api/offering-plans', {
        method: 'POST',
        cookie: adminCookie,
        body: JSON.stringify({ name, ...overrides }),
    });

    return res.body;
}

async function addItems(planId: string, templateIds: string[]) {
    await api(`/api/offering-plan-items/${planId}`, {
        method: 'PUT',
        cookie: adminCookie,
        body: JSON.stringify(templateIds.map((templateId) => ({ templateId }))),
    });
}

beforeAll(async () => {
    ids = await seed();

    adminCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    viewerCookie = (await login(ACCOUNTS.viewerA, TEST_PASSWORD)).cookie;
});

afterAll(teardown);

describe('offering-plans: items are an ordered sequence, not a set', () => {
    it('adds, lists in order, and removes items via the bespoke sub-resource', async () => {
        const plan = await createPlan('Jahrgang 10 — Standard');
        const math = await createTemplate('Math');
        const german = await createTemplate('German');

        const put = await api<{ templateId: string }[]>(`/api/offering-plan-items/${plan.id}`, {
            method: 'PUT',
            cookie: adminCookie,
            body: JSON.stringify([{ templateId: math.id }, { templateId: german.id }]),
        });

        expect(put.status).toBe(200);
        expect(put.body.map((r) => r.templateId)).toEqual([math.id, german.id]);

        const get = await api<{ templateId: string }[]>(`/api/offering-plan-items/${plan.id}`, { cookie: adminCookie });

        expect(get.body.map((r) => r.templateId)).toEqual([math.id, german.id]);

        // Replace, not append — dropping german and reordering is one PUT.
        const replaced = await api<{ templateId: string }[]>(`/api/offering-plan-items/${plan.id}`, {
            method: 'PUT',
            cookie: adminCookie,
            body: JSON.stringify([{ templateId: math.id }]),
        });

        expect(replaced.body.map((r) => r.templateId)).toEqual([math.id]);
    });

    it('refuses a template from another tenant', async () => {
        const adminBCookie = (await login(ACCOUNTS.adminB, TEST_PASSWORD)).cookie;

        const foreignTemplate = await api<TemplateRow>('/api/offering-templates', {
            method: 'POST',
            cookie: adminBCookie,
            body: JSON.stringify({ name: 'Tenant B template', title: 'X', kindId: 'test-kind-b' }),
        });

        const plan = await createPlan('Cross-tenant probe');

        const res = await api(`/api/offering-plan-items/${plan.id}`, {
            method: 'PUT',
            cookie: adminCookie,
            body: JSON.stringify([{ templateId: foreignTemplate.body.id }]),
        });

        expect(res.status).toBe(404);
    });
});

describe('offering-plans: applying creates a group’s whole course load', () => {
    it('creates one offering per item, each attached to the group', async () => {
        const plan = await createPlan('Jahrgang 11 — Standard');
        const math = await createTemplate('Math 11');
        const german = await createTemplate('German 11');

        await api(`/api/offering-plan-items/${plan.id}`, {
            method: 'PUT',
            cookie: adminCookie,
            body: JSON.stringify([{ templateId: math.id }, { templateId: german.id }]),
        });

        const applied = await api<{ offerings: { id: string; title: string; action: string }[] }>(`/api/offering-plan-apply/${plan.id}`, {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({ termId: ids.termA, groupId: ids.groupCohortA }),
        });

        expect(applied.status).toBe(200);
        expect(applied.body.offerings).toHaveLength(2);
        expect(applied.body.offerings.map((o) => o.action)).toEqual(['created', 'created']);
        expect(applied.body.offerings.map((o) => o.title).sort())
            .toEqual(['German 11', 'Math 11'].sort());

        const groups = await api<{ groupId: string }[]>(
            `/api/offerings/${applied.body.offerings[0]!.id}/groups`,
            { cookie: adminCookie },
        );

        expect(groups.body.map((g) => g.groupId)).toContain(ids.groupCohortA);
    });

    it('refuses the whole apply when a template is missing a kind or a title', async () => {
        const plan = await createPlan('Incomplete plan');
        // No `title`, no `kindId` — a shape nobody finished fixing yet.
        const bare = await createTemplate('Bare shape', { title: null, kindId: null });

        await api(`/api/offering-plan-items/${plan.id}`, {
            method: 'PUT',
            cookie: adminCookie,
            body: JSON.stringify([{ templateId: bare.id }]),
        });

        const res = await api(`/api/offering-plan-apply/${plan.id}`, {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({ termId: ids.termA, groupId: ids.groupCohortA }),
        });

        expect(res.status).toBe(422);
    });

    it('re-applying to the same group in the same term changes nothing (idempotent)', async () => {
        const plan = await createPlan('Jahrgang 12 — Standard');
        const math = await createTemplate('Math 12');

        await api(`/api/offering-plan-items/${plan.id}`, {
            method: 'PUT',
            cookie: adminCookie,
            body: JSON.stringify([{ templateId: math.id }]),
        });

        const first = await api<{ offerings: { id: string; action: string }[] }>(`/api/offering-plan-apply/${plan.id}`, {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({ termId: ids.termA, groupId: ids.groupCohortA }),
        });

        expect(first.status).toBe(200);
        expect(first.body.offerings.map((o) => o.action)).toEqual(['created']);

        const repeat = await api<{ offerings: { id: string; action: string }[] }>(`/api/offering-plan-apply/${plan.id}`, {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({ termId: ids.termA, groupId: ids.groupCohortA }),
        });

        // Same offering, not a second one, and it says so rather than pretending to create again.
        expect(repeat.status).toBe(200);
        expect(repeat.body.offerings).toEqual(first.body.offerings.map((o) => ({ ...o, action: 'already-attached' })));

        const rows = await ownerDb.offering.findMany({
            where: { tenantId: ids.tenantA, termId: ids.termA, createdFromTemplateId: math.id },
        });

        expect(rows).toHaveLength(1);
    });

    it('a second group taking the same subject joins the first group’s offering instead of duplicating it', async () => {
        const plan = await createPlan('Shared Math — two cohorts');
        const math = await createTemplate('Shared Math');

        await api(`/api/offering-plan-items/${plan.id}`, {
            method: 'PUT',
            cookie: adminCookie,
            body: JSON.stringify([{ templateId: math.id }]),
        });

        const forCohort = await api<{ offerings: { id: string; action: string }[] }>(`/api/offering-plan-apply/${plan.id}`, {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({ termId: ids.termA, groupId: ids.groupCohortA }),
        });

        expect(forCohort.body.offerings.map((o) => o.action)).toEqual(['created']);

        const forSeminar = await api<{ offerings: { id: string; action: string }[] }>(`/api/offering-plan-apply/${plan.id}`, {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({ termId: ids.termA, groupId: ids.groupSeminarA }),
        });

        // SAME offering id, joined rather than duplicated.
        expect(forSeminar.body.offerings).toEqual([{ ...forCohort.body.offerings[0], action: 'attached' }]);

        const groups = await api<{ groupId: string }[]>(
            `/api/offerings/${forCohort.body.offerings[0]!.id}/groups`,
            { cookie: adminCookie },
        );

        expect(groups.body.map((g) => g.groupId).sort()).toEqual([ids.groupCohortA, ids.groupSeminarA].sort());
    });

    it('refuses a caller without offering_plan.apply', async () => {
        const plan = await createPlan('Permission probe');
        const math = await createTemplate('Math probe');

        await api(`/api/offering-plan-items/${plan.id}`, {
            method: 'PUT',
            cookie: adminCookie,
            body: JSON.stringify([{ templateId: math.id }]),
        });

        const res = await api(`/api/offering-plan-apply/${plan.id}`, {
            method: 'POST',
            cookie: viewerCookie,
            body: JSON.stringify({ termId: ids.termA, groupId: ids.groupCohortA }),
        });

        expect(res.status).toBe(403);
    });
});

describe('offering-plan-apply: bulk (groupIds)', () => {
    it('applies to several groups in one call, sharing one offering across them', async () => {
        const plan = await createPlan('Bulk — shared subject');
        const shared = await createTemplate('Bulk Shared Subject');

        await addItems(plan.id, [shared.id]);

        const res = await api<{ results: { groupId: string; offerings: { id: string; action: string }[] }[] }>(
            `/api/offering-plan-apply/${plan.id}`,
            {
                method: 'POST',
                cookie: adminCookie,
                body: JSON.stringify({ termId: ids.termA, groupIds: [ids.groupCohortA, ids.groupSeminarA] }),
            },
        );

        expect(res.status).toBe(200);
        expect(res.body.results).toHaveLength(2);
        expect(res.body.results[0]!.groupId).toBe(ids.groupCohortA);
        expect(res.body.results[1]!.groupId).toBe(ids.groupSeminarA);
        expect(res.body.results[0]!.offerings[0]!.action).toBe('created');
        // Second group in the SAME call joins the first's offering rather
        // than getting its own — the whole point of a bulk apply.
        expect(res.body.results[1]!.offerings[0]!.action).toBe('attached');
        expect(res.body.results[1]!.offerings[0]!.id).toBe(res.body.results[0]!.offerings[0]!.id);
    });

    it('refuses the whole call, writing nothing, when one group id in the batch is unknown', async () => {
        const plan = await createPlan('Bulk — bad group');
        const t = await createTemplate('Bulk Bad Group Subject');

        await addItems(plan.id, [t.id]);

        const res = await api(`/api/offering-plan-apply/${plan.id}`, {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({ termId: ids.termA, groupIds: [ids.groupCohortA, 'does-not-exist'] }),
        });

        expect(res.status).toBe(404);

        const rows = await ownerDb.offering.findMany({
            where: { tenantId: ids.tenantA, createdFromTemplateId: t.id },
        });

        expect(rows).toHaveLength(0);
    });

    it('refuses a body naming both groupId and groupIds, or neither', async () => {
        const plan = await createPlan('Bulk — malformed body');

        const both = await api(`/api/offering-plan-apply/${plan.id}`, {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({ termId: ids.termA, groupId: ids.groupCohortA, groupIds: [ids.groupCohortA] }),
        });

        expect(both.status).toBe(400);

        const neither = await api(`/api/offering-plan-apply/${plan.id}`, {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({ termId: ids.termA }),
        });

        expect(neither.status).toBe(400);
    });
});

describe('curriculum plan succession — group-plan-applications and "advance"', () => {
    it('lists a group’s existing applications and names the successor plan and term', async () => {
        const nextTerm = await api<{ id: string; name: string }>('/api/terms', {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({
                name: 'Successor Term', timeGridId: 'test-grid-a',
                startDate: '2027-10-01', endDate: '2028-02-28',
            }),
        });

        expect(nextTerm.status).toBe(201);

        const nextPlan = await createPlan('Semester N+1');
        const nextTemplate = await createTemplate('Semester N+1 Subject');

        await addItems(nextPlan.id, [nextTemplate.id]);

        const plan = await createPlan('Semester N', { nextPlanId: nextPlan.id });
        const template = await createTemplate('Semester N Subject');

        await addItems(plan.id, [template.id]);

        await api(`/api/offering-plan-apply/${plan.id}`, {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({ termId: ids.termA, groupId: ids.groupCohortA }),
        });

        const history = await api<{
            planId: string; planName: string; termId: string; termName: string;
            advance: { planId: string; planName: string; termId: string; termName: string } | null;
        }[]>(`/api/group-plan-applications/${ids.groupCohortA}`, { cookie: adminCookie });

        expect(history.status).toBe(200);

        const entry = history.body.find((row) => row.planId === plan.id);

        expect(entry).toBeTruthy();
        expect(entry!.termId).toBe(ids.termA);
        expect(entry!.advance).toEqual({
            planId: nextPlan.id, planName: nextPlan.name,
            termId: nextTerm.body.id, termName: nextTerm.body.name,
        });

        // Following the suggestion actually applies the right plan into the right term.
        const advanced = await api<{ offerings: { id: string; action: string }[] }>(
            `/api/offering-plan-apply/${entry!.advance!.planId}`,
            {
                method: 'POST',
                cookie: adminCookie,
                body: JSON.stringify({ termId: entry!.advance!.termId, groupId: ids.groupCohortA }),
            },
        );

        expect(advanced.status).toBe(200);
        expect(advanced.body.offerings[0]!.action).toBe('created');

        const rows = await ownerDb.offering.findMany({
            where: { tenantId: ids.tenantA, createdFromTemplateId: nextTemplate.id, termId: nextTerm.body.id },
        });

        expect(rows).toHaveLength(1);
    });

    it('reports no advance target when the plan has no successor', async () => {
        const plan = await createPlan('Terminal plan');
        const template = await createTemplate('Terminal Subject');

        await addItems(plan.id, [template.id]);

        await api(`/api/offering-plan-apply/${plan.id}`, {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({ termId: ids.termA, groupId: ids.groupSeminarA }),
        });

        const history = await api<{ planId: string; advance: unknown }[]>(
            `/api/group-plan-applications/${ids.groupSeminarA}`,
            { cookie: adminCookie },
        );

        const entry = history.body.find((row) => row.planId === plan.id);

        expect(entry?.advance).toBeNull();
    });
});
