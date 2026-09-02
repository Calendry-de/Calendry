import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';
import type { CurrentTermResponse } from '../app/utils/currentTerm';

/**
 * `GET /api/term-current`: the dashboard's calendar line, over HTTP.
 *
 * WHY THIS FILE CALLS THE ROUTE rather than only unit-testing the arithmetic
 * (`tests/current-term-context.test.ts` does that, with no database).
 *
 * TWO THINGS ONLY A REAL REQUEST CAN CONFIRM, and both fail SILENTLY:
 *
 * 1. THAT IT DOES NOT SHADOW THE GENERIC CRUD FAMILY. This route lived at
 *    `server/api/terms/current.get.ts` first, which is the obvious place and
 *    the wrong one: `terms` is in `CRUD_RESOURCES`, and a LITERAL
 *    `server/api/terms/` directory wins over the `[resource]` parameter for
 *    every path under it, INCLUDING ones it has no handler for. `POST
 *    /api/terms` 404'd as a result, silently, with nothing in the diff naming
 *    `terms`. It now sits at its own top-level `/api/term-current`, the same
 *    remedy `offering-plan-items`/`offering-plan-apply` use and for the same
 *    reason (`server/utils/resources.ts`), and this file pins all three verbs
 *    on `/api/terms` so the mistake cannot come back quietly.
 *
 * 2. THE RESPONSE SHAPE. CLAUDE.md is explicit that `request<T>()` is an
 *    unchecked assertion about what the server sends, so a wrong `T` is a lie
 *    the compiler believes. `CurrentTermResponse` is that `T`, imported here so
 *    the claim is checked against the live route.
 *
 * And one thing that is a DESIGN decision rather than an implementation detail:
 * "current" must mean the same term `/api/schedule/context` opens on. Two
 * surfaces naming different terms current is the drift this repo keeps paying
 * for, so the agreement is asserted directly, against a tenant that has more
 * than one term to choose between.
 */

/**
 * A SECOND term in tenant A, starting LATER than the fixture's own WS2026.
 *
 * The fixture has exactly one term per tenant, which would make "the most
 * recent by startDate" trivially true and the agreement below unfalsifiable.
 * With two, a route that picked the oldest, or the first by id, or by name,
 * answers differently from the schedule and this file says so.
 */
const LATER_TERM = 'test-term-a-later';

let adminCookie = '';
let adminBCookie = '';
let viewerCookie = '';

beforeAll(async () => {
    const ids = await seed();

    await ownerDb.term.create({
        data: {
            id: LATER_TERM,
            tenantId: ids.tenantA,
            name: 'SS2027',
            startDate: new Date('2027-04-01'),
            endDate: new Date('2027-07-31'),
            timeGridId: 'test-grid-a',
        },
    });

    adminCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    adminBCookie = (await login(ACCOUNTS.adminB, TEST_PASSWORD)).cookie;
    // `session.read` and nothing else: no `term.read`, which is the ordinary
    // case the header line has to be absent for rather than fail in.
    viewerCookie = (await login(ACCOUNTS.viewerA, TEST_PASSWORD)).cookie;
});

afterAll(teardown);

/**
 * ITS OWN TOP-LEVEL PATH, AND WHY THE OBVIOUS ONE IS WRONG.
 *
 * This route first lived at `server/api/terms/current.get.ts`, which reads as
 * the natural place for it and is a trap: `terms` is in `CRUD_RESOURCES`, so a
 * LITERAL `server/api/terms/` directory wins over the `[resource]` parameter
 * for every path beneath it, including ones the literal branch has no handler
 * for. `POST /api/terms` stopped reaching `server/api/[resource]/index.post.ts`
 * and 404'd, with nothing in the diff naming `terms` as broken;
 * `tests/offering-plan.test.ts` is what caught it.
 *
 * `server/utils/resources.ts` already records the same hazard for
 * `offering-plans`. These four assertions are the standing guard for it: the
 * route answers, and all three generic verbs on `/api/terms` still reach the
 * generic family.
 */
describe('the route resolves, and the CRUD family is untouched', () => {
    it('answers /api/term-current with a term', async () => {
        const res = await api<CurrentTermResponse>('/api/term-current', { cookie: adminCookie });

        expect(res.status).toBe(200);
        expect(res.body.term).not.toBeNull();
    });

    it('leaves GET /api/terms answering with the list', async () => {
        const res = await api<{ id: string }[]>('/api/terms', { cookie: adminCookie });

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.map((row) => row.id)).toContain(LATER_TERM);
    });

    it('leaves GET /api/terms/{id} answering with that term', async () => {
        const res = await api<{ id: string; name: string }>(`/api/terms/${LATER_TERM}`, { cookie: adminCookie });

        expect(res.status).toBe(200);
        expect(res.body.name).toBe('SS2027');
    });

    it('leaves POST /api/terms reaching the generic create', async () => {
        /*
         * THE REGRESSION ITSELF. A shadowed `/api/terms` answers 404 here,
         * which is indistinguishable from a bad path and names nothing. The
         * created row is cleaned up by `teardown`, which deletes the tenant.
         */
        const res = await api<{ id: string; name: string }>('/api/terms', {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({
                name: 'Shadow check',
                /*
                 * EARLIER than every other fixture term, deliberately. This row
                 * outlives the test that creates it (teardown is per FILE), and
                 * "current" is the most recent by `startDate`: a shadow-check
                 * term dated later than the rest would quietly become the term
                 * the two assertions below are about, and they would fail
                 * naming a route that is behaving perfectly.
                 */
                startDate: '2024-10-02',
                endDate: '2025-02-23',
                timeGridId: 'test-grid-a',
            }),
        });

        expect(res.status, 'a 404 here means a literal server/api/terms/ directory shadowed the generic route').toBe(201);
        expect(res.body.name).toBe('Shadow check');
    });
});

describe('the shape the dashboard reads', () => {
    it('sends the term, the phase, the week and the total, and nothing else', async () => {
        const res = await api<CurrentTermResponse & Record<string, unknown>>(
            '/api/term-current',
            { cookie: adminCookie },
        );

        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(['phase', 'term', 'totalWeeks', 'week']);

        // `nonNullTerm` rather than an `as`: the union is the point of the
        // type, and asserting past it would drop exactly the check this file
        // exists to make.
        const term = res.body.term;

        expect(term).not.toBeNull();
        expect(Object.keys(term ?? {}).sort()).toEqual(['endDate', 'id', 'name', 'startDate']);
        // DATE ONLY. A term boundary is a calendar fact about the institution,
        // never an instant shifted by whoever is looking at it, so a timestamp
        // here would be the first step toward a term that starts on a different
        // day depending on the reader.
        expect(term?.startDate).toBe('2027-04-01');
        expect(term?.endDate).toBe('2027-07-31');
        expect(['BEFORE', 'DURING', 'AFTER']).toContain(res.body.phase);
        expect(res.body.week).toBeGreaterThanOrEqual(1);
        expect(res.body.totalWeeks).toBeGreaterThanOrEqual(res.body.week);
    });

    it('answers { term: null } for a tenant that has authored no Term', async () => {
        /*
         * The fresh-tenant case, and the reason it is not an error: "no term
         * configured yet" is the most useful thing a new institution's home
         * page can say, and rendering it the same way as a failed request is
         * the invisible-bug failure mode CLAUDE.md names.
         */
        await ownerDb.term.deleteMany({ where: { tenantId: 'test-tenant-b' } });

        const res = await api<CurrentTermResponse>('/api/term-current', { cookie: adminBCookie });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ term: null });
    });
});

describe('"current" means what the schedule means by it', () => {
    it('resolves the same term /api/schedule/context opens on', async () => {
        /*
         * THE ONE ASSERTION THIS FILE EXISTS FOR. Both routes default to the
         * most recent term by `startDate`, which is `RESOURCES['terms']`' own
         * ordering. Tenant A has two terms, so a route that picked the other
         * one fails here rather than in a support ticket about a dashboard and
         * a timetable disagreeing about what week it is.
         */
        const current = await api<CurrentTermResponse>('/api/term-current', { cookie: adminCookie });
        const context = await api<{ resolvedTermId: string }>('/api/schedule/context', { cookie: adminCookie });

        expect(current.status).toBe(200);
        expect(context.status).toBe(200);
        expect(current.body.term?.id).toBe(LATER_TERM);
        expect(current.body.term?.id).toBe(context.body.resolvedTermId);
    });
});

describe('the gate is GET /api/terms’ gate', () => {
    it('refuses a caller without term.read', async () => {
        // Not 200-with-nothing: the composable checks `term.read` before
        // fetching precisely so this 403 never reaches a browser, and if the
        // gate were missing here the check in front of it would be decoration.
        expect((await api('/api/term-current', { cookie: viewerCookie })).status).toBe(403);
    });

    it('refuses a caller with no session at all', async () => {
        expect((await api('/api/term-current')).status).toBe(401);
    });
});
