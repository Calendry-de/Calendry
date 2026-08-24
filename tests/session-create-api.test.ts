import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * `POST /api/sessions` — creating a Session directly, without a solver run.
 *
 * Two properties matter more than the CRUD surface, and both are asserted here
 * rather than reasoned about:
 *
 *  1. an EVENT (no Offering) is accepted and comes back with `offeringId` null,
 *     which is what makes it structurally invisible to a solve's delete
 *     partition — the partition itself is pinned in generation-materialize;
 *  2. a placement outside the grid's index space is REFUSED, not warned about.
 *     `fitsGrid()` is the same guard `move` uses, and this is the first route
 *     that could create such a row from nothing.
 */
const TENANT = 'test-tenant-a';
const TERM = 'test-term-a';
const KIND = 'test-kind-a';
const OFFERING = 'test-offering-a';
const ROOM = 'test-room-private-a';

let cookie: string | null;

beforeAll(async () => {
    await seed();
    ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));
});

afterEach(async () => {
    // Only the rows these tests made: the seed's own Sessions must survive.
    await ownerDb.$executeRawUnsafe('ALTER TABLE session_event DISABLE TRIGGER session_event_append_only');
    await ownerDb.$executeRawUnsafe(
        `DELETE FROM session_event WHERE tenant_id = '${TENANT}' AND type = 'CREATE'`,
    );
    await ownerDb.$executeRawUnsafe('ALTER TABLE session_event ENABLE TRIGGER session_event_append_only');
    await ownerDb.session.deleteMany({
        where: { tenantId: TENANT, id: { notIn: ['test-session-a', 'test-session-b'] } },
    });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

/**
 * A title is REQUIRED for an Event and REFUSED for an Offering-linked Session,
 * so the default depends on which is being made. Adding one unconditionally
 * would turn the "Offering from another term" case into a title error and stop
 * it testing what it names.
 */
const create = (body: Record<string, unknown>) => api('/api/sessions', {
    method: 'POST',
    cookie,
    body: JSON.stringify({
        termId: TERM,
        kindId: KIND,
        termWeek: 1,
        dayOfWeek: 1,
        blockIndex: 0,
        ...(body.offeringId ? {} : { title: 'Test event' }),
        ...body,
    }),
});

describe('creating an Event (no Offering)', () => {
    it('accepts it and stores offeringId as NULL', async () => {
        const res = await create({ roomIds: [ROOM] });

        expect(res.status).toBe(201);
        expect(res.body.session.offeringId).toBeNull();

        const row = await ownerDb.session.findUniqueOrThrow({
            where: { id: res.body.session.id },
            select: { offeringId: true, isLocked: true, generationId: true },
        });

        expect(row.offeringId).toBeNull();
    });

    it('locks it by default', async () => {
        const res = await create({});

        expect(res.body.session.isLocked).toBe(true);
    });

    it('allows an explicitly unlocked Event', async () => {
        const res = await create({ isLocked: false });

        expect(res.status).toBe(201);
        expect(res.body.session.isLocked).toBe(false);
    });

    it('leaves generationId NULL — a human placed it, no Generation did', async () => {
        const res = await create({});

        expect(res.body.session.generationId).toBeNull();
    });

    it('emits a CREATE event carrying the placement and the isEvent flag', async () => {
        const res = await create({ dayOfWeek: 2, blockIndex: 3, roomIds: [ROOM] });

        const events = await ownerDb.sessionEvent.findMany({
            where: { tenantId: TENANT, sessionId: res.body.session.id, type: 'CREATE' },
        });

        expect(events).toHaveLength(1);

        const payload = events[0].payload as Record<string, unknown>;

        expect(payload.isEvent).toBe(true);
        expect(payload.offeringId).toBeNull();
        expect(payload.to).toMatchObject({ dayOfWeek: 2, blockIndex: 3, roomIds: [ROOM] });
    });
});

describe('creating a Session WITH an Offering', () => {
    it('accepts it and links the Offering', async () => {
        const res = await create({ offeringId: OFFERING });

        expect(res.status).toBe(201);
        expect(res.body.session.offeringId).toBe(OFFERING);
    });

    it('refuses an Offering from another term', async () => {
        const res = await create({ offeringId: 'test-offering-b' });

        expect(res.status).toBe(404);
    });
});

describe('the grid guard', () => {
    it('refuses a blockIndex past the end of the day', async () => {
        // The seeded grid is 8 blocks; block 8 is one past the last valid index.
        const res = await create({ blockIndex: 8 });

        expect(res.status).toBe(409);
        expect(res.body.data).toMatchObject({ blocksPerDay: 8 });
    });

    it('refuses a duration that runs off the end of the day', async () => {
        const res = await create({ blockIndex: 7, durationBlocks: 2 });

        expect(res.status).toBe(409);
    });

    it('refuses a day the tenant does not teach', async () => {
        // activeDays is [1..5]; Sunday is a valid ISO weekday and an invalid slot,
        // which is exactly the case zod cannot catch.
        const res = await create({ dayOfWeek: 7 });

        expect(res.status).toBe(409);
        expect(res.body.data).toMatchObject({ dayOfWeek: 7 });
    });

    it('accepts the last valid block of the last active day', async () => {
        const res = await create({ dayOfWeek: 5, blockIndex: 7, durationBlocks: 1 });

        expect(res.status).toBe(201);
    });

    it('refuses a week past the end of the term', async () => {
        const res = await create({ termWeek: 999 });

        expect(res.status).toBe(409);
    });
});

describe('permission and tenant scoping', () => {
    it('refuses a viewer, who has no session.create', async () => {
        const { cookie: viewerCookie } = await login(ACCOUNTS.viewerA, TEST_PASSWORD);
        const res = await api('/api/sessions', {
            method: 'POST',
            cookie: viewerCookie,
            body: JSON.stringify({ termId: TERM, kindId: KIND, termWeek: 1, dayOfWeek: 1, blockIndex: 0 }),
        });

        expect(res.status).toBe(403);
    });

    it("refuses another tenant's term", async () => {
        const res = await create({ termId: 'test-term-b' });

        expect(res.status).toBe(404);
    });

    it("refuses another tenant's kind", async () => {
        const res = await create({ kindId: 'test-kind-b' });

        expect(res.status).toBe(404);
    });
});


describe('an Event needs a name', () => {
    it('refuses one with no title — there is no Offering to borrow from', async () => {
        const res = await api('/api/sessions', {
            method: 'POST',
            cookie,
            body: JSON.stringify({ termId: TERM, kindId: KIND, termWeek: 1, dayOfWeek: 1, blockIndex: 0 }),
        });

        expect(res.status).toBe(400);
        expect(String(res.body.statusMessage)).toContain('needs a name');
    });

    it('stores the title and returns it', async () => {
        const res = await create({ title: 'Open Day Briefing' });

        expect(res.status).toBe(201);
        expect(res.body.session.title).toBe('Open Day Briefing');
    });

    it('REFUSES a title on an Offering-linked Session', async () => {
        // Stored-and-ignored was the alternative: `sessionLabel()` reads this
        // column only for Events, so a title here would be a value no screen
        // ever renders. Dead data reads as a bug the first time someone finds
        // it, so the write is refused instead.
        const res = await create({ offeringId: 'test-offering-a', title: 'nope' });

        expect(res.status).toBe(400);
        expect(String(res.body.statusMessage)).toContain('takes its name from that Offering');
    });

    it('still accepts an Offering-linked Session with NO title', async () => {
        const res = await create({ offeringId: 'test-offering-a' });

        expect(res.status).toBe(201);
        expect(res.body.session.title).toBeNull();
    });
});
