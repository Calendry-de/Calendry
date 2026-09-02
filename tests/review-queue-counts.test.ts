import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';
import { REVIEW_QUEUES, reviewQueues } from '../app/utils/reviewQueues';
import { PERMISSIONS } from '#shared/permissions';

/**
 * `/dashboard`'s review-queue tiles: the count routes behind them, and the
 * permission logic in front of them.
 *
 * WHY THIS FILE CALLS THE ROUTES rather than only unit-testing the selection.
 * CLAUDE.md is explicit that `request<T>()` is an unchecked assertion about
 * what a server sends, so a wrong `T` is a lie the compiler believes, and it
 * names `/api/[resource]`'s shape switch on `limit` as three bugs in one hour
 * that typecheck saw none of. `useReviewQueueCounts()` reads `{ total }` off
 * two brand-new routes; nothing but calling them can confirm that is what comes
 * back.
 *
 * There is a second thing only an HTTP call can confirm here, and it is the one
 * most likely to break silently: `count.get.ts` sits beside `[id].get.ts` in
 * both directories. If Nitro resolved the parameter route first,
 * `/api/generations/count` would be "the Generation whose id is 'count'", a
 * clean 404 that the dashboard would render as a permanently "Unavailable"
 * tile, which looks exactly like a broken server.
 */
const READY_GENERATION = 'test-generation-ready-a';
const PENDING_VETO_A = 'test-veto-pending-a';
const PENDING_VETO_B = 'test-veto-pending-b';
const PENDING_EXAM_A = 'test-exam-pending-a';
const PENDING_EXAM_B = 'test-exam-pending-b';
const DECIDED_EXAM_A = 'test-exam-decided-a';

let adminCookie = '';
let viewerCookie = '';
let adminBCookie = '';

beforeAll(async () => {
    const ids = await seed();

    /*
     * The fixture's own Generation is an APPLIED tenant-wide baseline, so the
     * READY queue is genuinely empty until this row exists. That is deliberate:
     * the assertions below check the empty case first, and a fixture that was
     * never empty could not tell a real zero from a filter that matches
     * nothing.
     */
    await ownerDb.generation.create({
        data: {
            id: READY_GENERATION,
            tenantId: ids.tenantA,
            termId: ids.termA,
            version: 1,
            source: 'SOLVER',
            status: 'READY',
            isCurrent: false,
        },
    });

    // One in EACH tenant, so a count that ignored `tenant_id` would read 2 and
    // be caught rather than looking plausible.
    await ownerDb.personUnavailability.createMany({
        data: [
            { id: PENDING_VETO_A, tenantId: ids.tenantA, personId: ids.personA, days: [3], blocks: [], weeks: [], status: 'PENDING' },
            { id: PENDING_VETO_B, tenantId: ids.tenantB, personId: ids.personB, days: [3], blocks: [], weeks: [], status: 'PENDING' },
        ],
    });

    /*
     * ONE PENDING IN EACH TENANT, plus a DECIDED one in tenant A. The decided
     * row is what makes `status=PENDING` a real filter rather than a
     * decoration: without it, a count that ignored the status would read the
     * same number and look correct.
     */
    await ownerDb.examRequest.createMany({
        data: [
            {
                id: PENDING_EXAM_A, tenantId: ids.tenantA, status: 'PENDING',
                offeringId: 'test-offering-a', termId: ids.termA, kindId: 'test-kind-a',
                termWeek: 1, dayOfWeek: 2, blockIndex: 0,
            },
            {
                id: DECIDED_EXAM_A, tenantId: ids.tenantA, status: 'REJECTED',
                offeringId: 'test-offering-a', termId: ids.termA, kindId: 'test-kind-a',
                termWeek: 2, dayOfWeek: 3, blockIndex: 1,
                /*
                 * REJECTED rather than APPROVED, and the schema is what picks:
                 * `exam_request_session_matches_status` requires a `session_id`
                 * on an APPROVED row (approval is what CREATES the exam, and
                 * that pointer is what stops a second approval creating a
                 * second one), so an approved fixture would need a whole
                 * Session to say "this row is not pending". A rejection is
                 * decided just as finally and needs none.
                 *
                 * `decidedAt` because `exam_request_decision_complete`
                 * requires one on any non-PENDING row: a decision without a
                 * moment is not a decision. Written against the timestamp
                 * rather than the decider, which may legitimately be detached.
                 */
                decidedAt: new Date('2026-09-01T10:00:00Z'),
            },
            {
                id: PENDING_EXAM_B, tenantId: ids.tenantB, status: 'PENDING',
                offeringId: 'test-offering-b', termId: ids.termB, kindId: 'test-kind-b',
                termWeek: 1, dayOfWeek: 2, blockIndex: 0,
            },
        ],
    });

    adminCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    adminBCookie = (await login(ACCOUNTS.adminB, TEST_PASSWORD)).cookie;
    // `session.read` and nothing else: holds no `generation.read`, neither
    // availability key and no `exam.review`, which is the ordinary case the
    // tiles must survive rather than an exotic one.
    viewerCookie = (await login(ACCOUNTS.viewerA, TEST_PASSWORD)).cookie;
});

afterAll(teardown);

describe('the response shape the dashboard reads', () => {
    it('serves /api/generations/count as { total: number }, not a row array', async () => {
        const res = await api<{ total: number }>('/api/generations/count', { cookie: adminCookie });

        expect(res.status, 'a 404 here means [id].get.ts won the route, not count.get.ts').toBe(200);
        expect(Array.isArray(res.body), 'the count route must never answer with the list shape').toBe(false);
        expect(typeof res.body.total).toBe('number');
    });

    it('serves /api/availability/vetoes/count as { total: number }, without the list route’s reference wave', async () => {
        const res = await api<{ total: number } & Record<string, unknown>>(
            '/api/availability/vetoes/count',
            { cookie: adminCookie },
        );

        expect(res.status).toBe(200);
        expect(typeof res.body.total).toBe('number');
        // The whole point of the separate route: none of the list route's
        // `{ rows, people, grid, terms }` payload travels with a count.
        expect(Object.keys(res.body)).toEqual(['total']);
    });

    it('serves /api/exam-requests/count as { total: number }, without the queue’s per-row references', async () => {
        const res = await api<{ total: number } & Record<string, unknown>>(
            '/api/exam-requests/count',
            { cookie: adminCookie },
        );

        expect(res.status, 'a 404 here means [id].get.ts won the route, not count.get.ts').toBe(200);
        expect(typeof res.body.total).toBe('number');
        // The list route carries each row's Offering, kind, room, term and both
        // people, and re-classifies its week per Term. None of that travels
        // with a number.
        expect(Object.keys(res.body)).toEqual(['total']);
    });
});

describe('the number agrees with the list it counts', () => {
    it('counts the same READY proposals the list route returns', async () => {
        const count = await api<{ total: number }>('/api/generations/count?status=READY', { cookie: adminCookie });
        const list = await api<{ id: string }[]>('/api/generations?status=READY&limit=100', { cookie: adminCookie });

        expect(count.status).toBe(200);
        expect(list.status).toBe(200);
        expect(count.body.total).toBe(1);
        expect(list.body.map((row) => row.id)).toEqual([READY_GENERATION]);
    });

    it('reports a real zero for a status with nothing in it', async () => {
        // Zero is an ANSWER, not an absence: the tile draws it as the numeral
        // and reserves the word "Unavailable" for a failed request. A route
        // that 404'd or errored on an empty match would collapse the two.
        const res = await api<{ total: number }>('/api/generations/count?status=INFEASIBLE', { cookie: adminCookie });

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(0);
    });

    it('counts the same PENDING vetoes the list route returns', async () => {
        const count = await api<{ total: number }>(
            '/api/availability/vetoes/count?status=PENDING',
            { cookie: adminCookie },
        );
        const list = await api<{ rows: { id: string }[] }>(
            '/api/availability/vetoes?status=PENDING',
            { cookie: adminCookie },
        );

        expect(count.status).toBe(200);
        expect(count.body.total).toBe(1);
        expect(list.body.rows.map((row) => row.id)).toEqual([PENDING_VETO_A]);
    });

    it('counts the same PENDING exam requests the list route returns', async () => {
        const count = await api<{ total: number }>('/api/exam-requests/count?status=PENDING', { cookie: adminCookie });
        /*
         * `{ rows }`, NOT a bare array, unlike `/api/generations`. Read from
         * the route rather than assumed: CLAUDE.md names guessing an envelope
         * as three bugs in one hour that typecheck saw none of, and this file
         * exists precisely to check claims about wire shapes.
         */
        const list = await api<{ rows: { id: string }[] }>('/api/exam-requests?status=PENDING', { cookie: adminCookie });

        expect(count.status).toBe(200);
        expect(list.status).toBe(200);
        expect(count.body.total).toBe(1);
        expect(list.body.rows.map((row) => row.id)).toEqual([PENDING_EXAM_A]);
    });

    it('does not count an exam request that has already been decided', async () => {
        // The REJECTED fixture row: `status=PENDING` has to be the filter the
        // review page's queue is, or the tile states a number the page it
        // links to does not show.
        const all = await api<{ total: number }>('/api/exam-requests/count', { cookie: adminCookie });

        expect(all.body.total).toBe(2);
    });

    it('honours the term filter the list route honours', async () => {
        const res = await api<{ total: number }>(
            '/api/generations/count?status=READY&termId=test-term-b',
            { cookie: adminCookie },
        );

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(0);
    });
});

describe('tenant isolation', () => {
    it('counts only this tenant’s proposals', async () => {
        const res = await api<{ total: number }>('/api/generations/count?status=READY', { cookie: adminBCookie });

        // Tenant B has no READY proposal of its own, and tenant A's must not
        // leak into its number. A count is a small enough answer that a broken
        // scope looks like a plausible one, which is why this is asserted
        // rather than assumed from `withRequestTenant`.
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(0);
    });

    it('counts only this tenant’s vetoes', async () => {
        const res = await api<{ total: number }>(
            '/api/availability/vetoes/count?status=PENDING',
            { cookie: adminBCookie },
        );

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
    });

    it('counts only this tenant’s exam requests', async () => {
        const res = await api<{ total: number }>('/api/exam-requests/count?status=PENDING', { cookie: adminBCookie });

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
    });
});

describe('the gate is the list route’s gate', () => {
    it('refuses a proposal count to a caller without generation.read', async () => {
        const res = await api('/api/generations/count', { cookie: viewerCookie });

        expect(res.status).toBe(403);
    });

    it('refuses a veto count to a caller with neither availability key', async () => {
        const res = await api('/api/availability/vetoes/count', { cookie: viewerCookie });

        expect(res.status).toBe(403);
    });

    it('refuses an exam count to a caller without exam.review', async () => {
        // `exam.request_own` would not be enough either: this counts
        // everybody's requests, so the key that lets a lecturer ask for their
        // own exam must not reveal the size of the institution's queue.
        const res = await api('/api/exam-requests/count', { cookie: viewerCookie });

        expect(res.status).toBe(403);
    });

    it('refuses all three to a caller with no session at all', async () => {
        expect((await api('/api/generations/count')).status).toBe(401);
        expect((await api('/api/availability/vetoes/count')).status).toBe(401);
        expect((await api('/api/exam-requests/count')).status).toBe(401);
    });
});

/**
 * The selection in front of the fetch.
 *
 * A queue the caller cannot read must be DROPPED before any request is made,
 * not fetched and rendered as "Unavailable": that word means "I asked and could
 * not get an answer", and showing it to somebody who was never allowed to ask
 * makes a permission boundary look like a broken server. The 403s asserted
 * above are what that filter exists to prevent ever happening in the browser.
 */
describe('review queue gating', () => {
    it('demands permissions that exist in the catalogue', () => {
        const catalogued = new Set(PERMISSIONS.map((permission) => permission.key));

        for (const queue of REVIEW_QUEUES) {
            for (const clause of queue.permission) {
                for (const key of typeof clause === 'string' ? [clause] : clause) {
                    // An uncatalogued key can never be held, so the tile would
                    // be invisible to everyone including a full administrator.
                    expect(catalogued.has(key), `${queue.key} counts behind uncatalogued permission "${key}"`)
                        .toBe(true);
                }
            }
        }
    });

    it('offers nothing to a caller holding nothing', () => {
        // `/dashboard` is gated on `dashboard.view` alone, so this caller is
        // real: somebody who may land here and review nothing.
        expect(reviewQueues(new Set())).toEqual([]);
    });

    it('offers the proposal tile to a caller holding only generation.read', () => {
        expect(reviewQueues(new Set(['generation.read'])).map((queue) => queue.key)).toEqual(['proposals']);
    });

    it('offers the veto tile for EITHER availability key, independently', () => {
        // The "any of" clause is the whole reason `PermissionRequirement` is
        // used here rather than a bare string: a scheduler holding only
        // `read_any` may see the queue is not empty.
        expect(reviewQueues(new Set(['availability.read_any'])).map((queue) => queue.key)).toEqual(['vetoes']);
        expect(reviewQueues(new Set(['availability.manage_any'])).map((queue) => queue.key)).toEqual(['vetoes']);
    });

    it('offers the exam tile to a caller holding only exam.review', () => {
        expect(reviewQueues(new Set(['exam.review'])).map((queue) => queue.key)).toEqual(['exams']);
    });

    it('does not offer the exam tile for exam.request_own', () => {
        /*
         * The two exam keys are NOT a hierarchy. `exam.request_own` is "I may
         * ask for an exam of my own", which every lecturer wants and which says
         * nothing about reading the institution's queue; a tile's gate is its
         * DESTINATION'S, and `/manage/exams/reviews` needs `exam.review`.
         */
        expect(reviewQueues(new Set(['exam.request_own']))).toEqual([]);
    });

    it('offers every tile to a caller holding every key', () => {
        const held = new Set(['generation.read', 'availability.manage_any', 'exam.review']);

        expect(reviewQueues(held).map((queue) => queue.key)).toEqual(['proposals', 'vetoes', 'exams']);
    });

    it('offers both to a caller holding both', () => {
        const held = new Set(['generation.read', 'availability.manage_any']);

        expect(reviewQueues(held).map((queue) => queue.key)).toEqual(['proposals', 'vetoes']);
    });

    it('points each tile at a count route filtered to what is WAITING', () => {
        /*
         * The tile's number and the page it links to must mean the same thing.
         * `/schedule/proposals` defaults its own scope to READY, and the
         * unavailability review page's queue is the PENDING rows, so a count
         * taken over any wider status would put a number on the dashboard that
         * the destination does not show. Pinned as a literal because that
         * agreement is a decision, not an implementation detail.
         */
        const byKey = new Map(REVIEW_QUEUES.map((queue) => [queue.key, queue.countPath]));

        expect(byKey.get('proposals')).toBe('/api/generations/count?status=READY');
        expect(byKey.get('vetoes')).toBe('/api/availability/vetoes/count?status=PENDING');
        expect(byKey.get('exams')).toBe('/api/exam-requests/count?status=PENDING');
    });

    it('gives every queue a status-filtered count route', () => {
        // BY KEY rather than as a whole array, so adding a fourth queue is a
        // one-line addition here rather than a failing assertion about a list
        // that grew. What must not drift is that EVERY entry names a count
        // route and pins a status: an unfiltered count would state the size of
        // a queue's whole history on a tile whose label says "waiting".
        for (const queue of REVIEW_QUEUES) {
            expect(queue.countPath, `${queue.key} must count through a /count route`).toMatch(/\/count\?/);
            expect(queue.countPath, `${queue.key} must pin a status`).toMatch(/[?&]status=/);
        }
    });
});
