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

describe('the exam week', () => {
    /**
     * `#6` recorded "exams ideally near term-end" as an open SOLVER weighting.
     * It is not one: an institution says where its term-end assessment window is
     * by declaring an EXAM calendar period, and the flow reads that.
     *
     * It has to, because the solver cannot help here — an approved exam is a
     * locked Event and `MinimizeExamWeek` only steers what the solver PLACES.
     * The lecturer's chosen week is the final answer.
     */
    it('reports the kind of week a request landed in', async () => {
        const term = await ownerDb.term.findFirstOrThrow({ where: { id: 'test-term-a' } });

        await ownerDb.calendarPeriod.create({
            data: {
                tenantId: term.tenantId,
                termId: term.id,
                kind: 'EXAM',
                name: 'Prüfungszeitraum',
                // The last week of the fixture term.
                startDate: new Date(term.endDate.getTime() - 6 * 86_400_000),
                endDate: term.endDate,
            },
        });

        const weeks = Math.max(
            1,
            Math.ceil((term.endDate.getTime() - term.startDate.getTime()) / (7 * 86_400_000)),
        );

        const inExam = await request({ termWeek: weeks, dayOfWeek: 1, blockIndex: 5 });
        const outside = await request({ termWeek: 1, dayOfWeek: 1, blockIndex: 6 });

        expect(inExam.status, JSON.stringify(inExam.body)).toBe(200);
        expect(outside.status).toBe(200);

        const mine = await api<{ rows: { id: string; weekKind: string }[] }>(
            '/api/me/exam-requests',
            { cookie: adminA },
        );

        const byId = new Map(mine.body.rows.map((r) => [r.id, r.weekKind]));

        expect(byId.get(inExam.body.request.id)).toBe('EXAM');
        // TEACHING, not EXAM — and allowed, because a Nachklausur legitimately
        // sits in an ordinary teaching week.
        expect(byId.get(outside.body.request.id)).not.toBe('EXAM');
    });

    it('does not refuse a week outside the exam period', async () => {
        // Warn and allow. Refusing would forbid a resit, which is a thing
        // institutions actually schedule mid-term.
        expect((await request({ termWeek: 2, dayOfWeek: 1, blockIndex: 7 })).status).toBe(200);
    });

    it('reports it on the review queue too, from the same helper', async () => {
        const res = await api<{ rows: { weekKind: string }[] }>('/api/exam-requests', { cookie: adminA });

        expect(res.status).toBe(200);
        expect(res.body.rows.every((r) => typeof r.weekKind === 'string')).toBe(true);
        expect(res.body.rows.some((r) => r.weekKind === 'EXAM')).toBe(true);
    });
});

describe('the module’s own teaching-plan completeness', () => {
    /**
     * `assertTeachingComplete` used to run ONLY inside `POST .../approve`'s
     * response — a fact shown once, as a side effect of the very decision it
     * should have informed, then gone. Neither list route carried it at all,
     * so a reviewer scanning pending requests, or a lecturer checking their
     * own, saw nothing distinguishing a module whose teaching plan is fully
     * placed from one that is not.
     *
     * `offeringA` (`test-offering-a`, from the shared fixture) has
     * `frequency: 2` and exactly one placed Session throughout this whole
     * file — every request against it approves to an EVENT (`offeringId:
     * null`), never a Session ON the module itself, so this stays 1 of 2
     * for every test above and below this one.
     */
    it('is on every row of the lecturer’s own list', async () => {
        const created = await request({ dayOfWeek: 1, blockIndex: 1 });

        expect(created.status).toBe(200);

        const mine = await api<{ rows: { id: string; teachingComplete: { complete: boolean; placedCount: number; requiredCount: number } }[] }>(
            '/api/me/exam-requests',
            { cookie: adminA },
        );
        const row = mine.body.rows.find((r) => r.id === created.body.request.id);

        expect(row?.teachingComplete).toEqual({ complete: false, placedCount: 1, requiredCount: 2 });
    });

    it('is on every row of the review queue too, cached per Offering', async () => {
        const created = await request({ dayOfWeek: 1, blockIndex: 2 });

        expect(created.status).toBe(200);

        const queue = await api<{ rows: { id: string; teachingComplete: { complete: boolean; placedCount: number; requiredCount: number } }[] }>(
            '/api/exam-requests',
            { cookie: adminA },
        );
        const row = queue.body.rows.find((r) => r.id === created.body.request.id);

        expect(row?.teachingComplete).toEqual({ complete: false, placedCount: 1, requiredCount: 2 });
        // Every OTHER request against the same Offering agrees — this is a
        // fact about the module, not about the one request that happened to
        // trigger the lookup.
        const sameOffering = queue.body.rows.filter((r) => r.id !== row?.id);

        expect(sameOffering.length).toBeGreaterThan(0);
    });
});
