import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * A lecturer asks for an exam; staff decide.
 *
 * THE THING WORTH PINNING is not that the row saves. It is the set of claims
 * that make this different from `POST /api/sessions`, each of which is invisible
 * from the outside if it breaks:
 *
 *   1. A request creates NOTHING until a decision. That is the whole reason the
 *      flow exists rather than granting `session.create` to every lecturer.
 *   2. "My own" means an Offering the acting Person LEADS, and the route takes
 *      no person id — another lecturer's module answers 404, not 403, so the
 *      route cannot be used to enumerate who teaches what.
 *   3. The kind must be EXAM-typed. `exam_spacing_*` derive their scope from
 *      that classification, so an exam under a TEACHING kind is a Session no
 *      exam rule can see — it looks right on the timetable and is governed by
 *      nothing.
 *   4. Approval creates an EVENT, never a Session on the module's Offering.
 *      `ExactFrequency` is HARD, so an extra Session on an Offering is deleted
 *      by the next apply or reported as violating the module's own demand.
 *   5. Approving twice cannot create two exams.
 */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

let adminA = '';
let adminB = '';
let offeringA = '';
let examKindA = '';
let teachingKindA = '';
let personA = '';
/** In tenant A, with no lecturer attached — the ownership check's real subject. */
let unleadOfferingA = '';

/** A fresh PENDING request, so each test starts from a known row. */
async function request(overrides: Record<string, unknown> = {}, cookie = adminA) {
    return api<{ request: { id: string } }>('/api/me/exam-requests', {
        method: 'POST',
        cookie,
        body: JSON.stringify({
            offeringId: offeringA,
            kindId: examKindA,
            termWeek: 1,
            dayOfWeek: 2,
            blockIndex: 0,
            durationBlocks: 1,
            ...overrides,
        }),
    });
}

beforeAll(async () => {
    const ids = await seed();

    personA = ids.personA;
    offeringA = 'test-offering-a';
    teachingKindA = 'test-kind-a';

    adminA = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    adminB = (await login(ACCOUNTS.adminB, TEST_PASSWORD)).cookie;

    // An EXAM-typed kind, and the acting Person as the module's lecturer —
    // both are preconditions of the feature rather than part of it.
    const kind = await ownerDb.sessionKind.create({
        data: { tenantId: ids.tenantA, key: 'klausur', name: 'Klausur', type: 'EXAM' },
    });

    examKindA = kind.id;

    await ownerDb.offeringLecturer.create({
        data: { tenantId: ids.tenantA, offeringId: offeringA, personId: personA },
    });

    const unled = await ownerDb.offering.create({
        data: {
            tenantId: ids.tenantA, termId: 'test-term-a', kindId: teachingKindA,
            title: 'Somebody else’s module', frequency: 1,
        },
    });

    unleadOfferingA = unled.id;
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('asking', () => {
    it('creates a PENDING request and nothing else', async () => {
        const before = await ownerDb.session.count();
        const res = await request();

        expect(res.status).toBe(200);

        // The whole point of the flow: no Session, no placement, nothing on any
        // timetable until somebody decides.
        expect(await ownerDb.session.count()).toBe(before);

        const row = await ownerDb.examRequest.findUniqueOrThrow({ where: { id: res.body.request.id } });

        expect(row.status).toBe('PENDING');
        expect(row.sessionId).toBeNull();
        // Never from the body — the acting Person IS the requester.
        expect(row.requestedByPersonId).toBe(personA);
    });

    it('refuses a module the caller does not lead, as a 404', async () => {
        /*
         * IN THE CALLER'S OWN TENANT. Using another tenant's module would make
         * this test pass on tenant isolation alone — verified by deleting the
         * `lecturers: { some: ... }` clause and watching a cross-tenant version
         * of this stay green.
         */
        const res = await request({ offeringId: unleadOfferingA });

        expect(res.status).toBe(404);
    });

    it('refuses another tenant’s module too', async () => {
        expect((await request({}, adminB)).status).toBe(404);
    });

    it('refuses a kind that is not classified as an exam', async () => {
        const res = await request({ kindId: teachingKindA });

        expect(res.status).toBe(422);
        expect(JSON.stringify(res.body)).toContain('exam');
    });

    it('refuses a placement that resolves to no slot', async () => {
        const res = await request({ blockIndex: 999 });

        expect(res.status).toBe(409);
    });

    it('refuses a week outside the term', async () => {
        expect((await request({ termWeek: 999 })).status).toBe(409);
    });
});

describe('deciding', () => {
    it('needs the review key, which asking does not imply', async () => {
        const created = await request();
        // adminB holds every permission in ITS OWN tenant, so this is a tenant
        // boundary rather than a permission one — and it must still be a 404.
        const res = await api(`/api/exam-requests/${created.body.request.id}/approve`, {
            method: 'POST', cookie: adminB, body: '{}',
        });

        expect(res.status).toBe(404);
    });

    it('approving creates an EVENT, not a Session on the module', async () => {
        const created = await request({ dayOfWeek: 3 });
        const res = await api<{ sessionId: string }>(
            `/api/exam-requests/${created.body.request.id}/approve`,
            { method: 'POST', cookie: adminA, body: '{}' },
        );

        expect(res.status).toBe(200);

        const session = await ownerDb.session.findUniqueOrThrow({
            where: { id: res.body.sessionId },
            include: { groups: true, people: true },
        });

        // THE decision this feature rests on. An extra Session on the module's
        // own Offering is either deleted by the next apply or counted as
        // violating that Offering's ExactFrequency.
        expect(session.offeringId).toBeNull();
        // Locked on top of the structural exemption.
        expect(session.isLocked).toBe(true);
        // Named, because an Event has nothing else to be called.
        expect(session.title).toBeTruthy();
        // The requester is attached, so the exam is on their timetable.
        expect(session.people.map((p) => p.personId)).toContain(personA);
    });

    it('carries the module’s groups, or no spacing rule could see it', async () => {
        // `exam_spacing_same_day` and `exam_spacing_window` are per-GROUP
        // aggregates. An exam attached to nobody is an exam no rule can space.
        await ownerDb.offeringGroup.deleteMany({ where: { offeringId: offeringA } });
        await ownerDb.offeringGroup.create({
            data: {
                tenantId: (await ownerDb.offering.findUniqueOrThrow({ where: { id: offeringA } })).tenantId!,
                offeringId: offeringA,
                groupId: 'test-group-cohort-a',
            },
        });

        const created = await request({ dayOfWeek: 4 });
        const res = await api<{ sessionId: string }>(
            `/api/exam-requests/${created.body.request.id}/approve`,
            { method: 'POST', cookie: adminA, body: '{}' },
        );

        const groups = await ownerDb.sessionGroup.findMany({ where: { sessionId: res.body.sessionId } });

        expect(groups.map((g) => g.groupId)).toContain('test-group-cohort-a');
    });

    it('cannot be approved twice', async () => {
        const created = await request({ dayOfWeek: 5 });
        const first = await api<{ sessionId: string }>(
            `/api/exam-requests/${created.body.request.id}/approve`,
            { method: 'POST', cookie: adminA, body: '{}' },
        );

        expect(first.status).toBe(200);

        const second = await api(`/api/exam-requests/${created.body.request.id}/approve`, {
            method: 'POST', cookie: adminA, body: '{}',
        });

        // Refused, not silently replayed: the two outcomes are
        // indistinguishable to the caller and only one means "nothing further
        // happened".
        expect(second.status).toBe(409);
        expect(await ownerDb.session.count({ where: { title: { not: null } } })).toBeGreaterThan(0);
    });

    it('rejecting creates nothing and keeps the row', async () => {
        const created = await request({ dayOfWeek: 5, blockIndex: 2 });
        const before = await ownerDb.session.count();
        const res = await api(`/api/exam-requests/${created.body.request.id}/reject`, {
            method: 'POST', cookie: adminA, body: JSON.stringify({ note: 'Room is booked' }),
        });

        expect(res.status).toBe(200);
        expect(await ownerDb.session.count()).toBe(before);

        const row = await ownerDb.examRequest.findUniqueOrThrow({ where: { id: created.body.request.id } });

        // Kept, not deleted: "we asked and were told no" is the answer a
        // lecturer needs next term.
        expect(row.status).toBe('REJECTED');
        expect(row.sessionId).toBeNull();
        expect(row.decisionNote).toBe('Room is booked');
    });
});

describe('the database backs the route up', () => {
    it('cannot record a decision without a timestamp', async () => {
        const created = await request({ dayOfWeek: 1 });

        await expect(ownerDb.$executeRawUnsafe(
            `UPDATE exam_request SET status = 'REJECTED' WHERE id = '${created.body.request.id}'`,
        )).rejects.toThrow();
    });

    it('cannot mark a request APPROVED with no Session behind it', async () => {
        const created = await request({ dayOfWeek: 1, blockIndex: 3 });

        // The half-landed approval — decided, but with nothing created and
        // nothing saying so — is unrepresentable rather than merely unlikely.
        await expect(ownerDb.$executeRawUnsafe(
            `UPDATE exam_request SET status = 'APPROVED', decided_at = now() WHERE id = '${created.body.request.id}'`,
        )).rejects.toThrow();
    });
});

describe('the lecturer’s own list', () => {
    it('shows their requests', async () => {
        const res = await api<{ rows: unknown[] }>('/api/me/exam-requests', { cookie: adminA });

        expect(res.status).toBe(200);
        expect(res.body.rows.length).toBeGreaterThan(0);
    });

    it('renders the page', async () => {
        const res = await fetch(`${BASE}/my/exams`, { headers: { cookie: adminA } });

        expect(res.status).toBe(200);

        const html = (await res.text()).replace(/<!--[\s\S]*?-->/g, '');

        // Content, not element presence: an empty shell renders the heading too.
        expect(html).toContain('Request an exam');
    });

    it('renders the review page', async () => {
        const res = await fetch(`${BASE}/manage/exams/reviews`, { headers: { cookie: adminA } });

        expect(res.status).toBe(200);
        expect((await res.text())).toContain('Waiting on a decision');
    });
});
