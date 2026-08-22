import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * Calendar periods over HTTP.
 *
 * The unit suite pins the classification rules; this pins the write boundary —
 * that a period which would classify NOTHING is refused, that one which
 * classifies something is accepted, and that overlaps are not treated as errors.
 *
 * Permission is `term.update`, not a permission of its own: a calendar period is
 * a child of Term with a mandatory `term_id`, exactly as `time_grid_break` is a
 * child of TimeGrid.
 */
const TENANT = 'test-tenant-a';
const TERM = 'test-term-a';

let cookie: string | null;
let termRange: { startDate: string; endDate: string };

const iso = (value: unknown) => String(value).slice(0, 10);

beforeAll(async () => {
    await seed();
    ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));

    const term = await ownerDb.term.findFirstOrThrow({
        where: { id: TERM }, select: { startDate: true, endDate: true },
    });

    termRange = { startDate: iso(term.startDate.toISOString()), endDate: iso(term.endDate.toISOString()) };
});

afterEach(async () => {
    await ownerDb.calendarPeriod.deleteMany({ where: { tenantId: TENANT } });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const create = (body: Record<string, unknown>) => api('/api/calendar-periods', {
    method: 'POST', cookie, body: JSON.stringify({ termId: TERM, kind: 'EXAM', name: 'P', ...body }),
});

describe('a period must be able to classify something', () => {
    it('accepts one inside the term', async () => {
        const res = await create({ startDate: termRange.startDate, endDate: termRange.endDate });

        expect(res.status).toBe(201);
    });

    it('REFUSES one entirely before the term', async () => {
        // Not a style rule: such a row reads back correctly, appears in the
        // list, and classifies no week at all. Silently inert is the failure
        // this whole feature exists to end.
        const res = await create({ startDate: '1990-01-01', endDate: '1990-01-31' });

        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain('outside');
    });

    it('REFUSES one entirely after the term', async () => {
        const res = await create({ startDate: '2099-01-01', endDate: '2099-01-31' });

        expect(res.status).toBe(400);
    });

    it('ACCEPTS one that only partially overlaps the term', async () => {
        // The counter-example. Without it, tightening the guard to "entirely
        // inside" would pass both refusal tests above while rejecting a
        // legitimate exam period that spills past the end of term.
        const res = await create({ startDate: termRange.endDate, endDate: '2099-01-31' });

        expect(res.status).toBe(201);
    });
});

describe('overlapping periods are allowed', () => {
    it('accepts a HOLIDAY inside an existing EXAM period', async () => {
        // Ordinary configuration, and the precedence rule already resolves it.
        // Refusing overlaps would contradict the resolver already shipped.
        expect((await create({
            kind: 'EXAM', name: 'Exams', startDate: termRange.startDate, endDate: termRange.endDate,
        })).status).toBe(201);

        expect((await create({
            kind: 'HOLIDAY', name: 'Bank holiday', startDate: termRange.startDate, endDate: termRange.startDate,
        })).status).toBe(201);
    });
});

describe('the database backs the API up', () => {
    it('refuses an inverted range even over raw SQL', async () => {
        // `calendar_period_dates_ordered` has existed since the initial RLS
        // migration. Asserted here because the API now has a route that could
        // otherwise be assumed to be the only guard.
        await expect(ownerDb.$executeRawUnsafe(
            `INSERT INTO calendar_period (id, tenant_id, term_id, kind, name, start_date, end_date, updated_at)
             VALUES ('cp-bad', $1, $2, 'EXAM', 'Inverted', DATE '2027-12-01', DATE '2027-11-01', now())`,
            TENANT, TERM,
        )).rejects.toThrow(/calendar_period_dates_ordered/);
    });
});

describe('listing and scoping', () => {
    it('filters by term', async () => {
        await create({ startDate: termRange.startDate, endDate: termRange.endDate });

        const res = await api<unknown[]>(`/api/calendar-periods?termId=${TERM}`, { cookie });

        expect(res.status).toBe(200);
        expect((res.body as unknown[]).length).toBe(1);
    });
});
