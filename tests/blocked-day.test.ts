import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';
import { isoWeekday } from '../shared/academicCalendar';

/**
 * "I cannot teach this day": issue #2, filed from `/schedule` rather than
 * `/my/availability`.
 *
 * ONE ROUTE, TWO ENTRY SHAPES, not a new endpoint: `POST /api/me/availability/
 * vetoes` already writes the recurring-pattern shape this file must leave
 * unchanged, and gains a second, mutually exclusive `date` input that resolves
 * to exactly one Term.
 *
 * WHY A TERM AT ALL. `PersonUnavailability.termId IS NULL` means "every
 * term": correct for a recurring pattern ("every Friday"), and wrong for a
 * single date: `weeks:[2]` with no term reached both of this fixture's terms
 * at once before `termId` existed, months apart on the calendar. A
 * date-derived row is unambiguously one term's week, so this is the one
 * thing that MUST differ from the existing path, not an incidental one.
 */
let f: Fixtures;
let cookie = '';

beforeAll(async () => {
    f = await seed();
    cookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const DATE = '2026-10-06'; // inside test-term-a (2026-10-01 – 2027-02-28)

describe('a single date', () => {
    it('resolves to exactly one day of one term, not a recurring pattern', async () => {
        const res = await api<{ id: string }>('/api/me/availability/vetoes', {
            method: 'POST', cookie, body: JSON.stringify({ date: DATE }),
        });

        expect(res.status).toBe(201);

        const row = await ownerDb.personUnavailability.findUniqueOrThrow({ where: { id: res.body.id } });

        // The whole point: a term IS recorded, unlike the recurring path.
        expect(row.termId).toBe(f.termA);
        // ONE weekday (the one the date falls on), not every day of the week.
        expect(row.days).toEqual([isoWeekday(new Date(DATE))]);
        // Every block that day, not a narrower slice: "I can't teach THIS DAY".
        expect(row.blocks).toEqual([]);
        expect(row.weeks).toHaveLength(1);
        expect(row.status).toBe('PENDING');
    });

    it('refuses a date outside every term', async () => {
        const res = await api('/api/me/availability/vetoes', {
            method: 'POST', cookie, body: JSON.stringify({ date: '2099-01-01' }),
        });

        expect(res.status).toBe(422);
    });

    it('refuses date combined with a recurring-pattern axis, rather than guessing which wins', async () => {
        const res = await api('/api/me/availability/vetoes', {
            method: 'POST', cookie,
            body: JSON.stringify({ date: DATE, days: [3] }),
        });

        expect(res.status).toBe(400);
    });

    it('refuses date combined with weeks the same way', async () => {
        const res = await api('/api/me/availability/vetoes', {
            method: 'POST', cookie,
            body: JSON.stringify({ date: DATE, weeks: [2] }),
        });

        expect(res.status).toBe(400);
    });
});

describe('the recurring pattern, unchanged', () => {
    it('still writes no Term, "every Friday, every term", exactly as before', async () => {
        const res = await api<{ id: string }>('/api/me/availability/vetoes', {
            method: 'POST', cookie, body: JSON.stringify({ days: [5], blocks: [], weeks: [] }),
        });

        expect(res.status).toBe(201);

        const row = await ownerDb.personUnavailability.findUniqueOrThrow({ where: { id: res.body.id } });

        expect(row.termId).toBeNull();
        expect(row.days).toEqual([5]);
    });
});
