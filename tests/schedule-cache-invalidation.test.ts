import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * The four calendar-read endpoints cache their responses (issue #66,
 * `server/utils/scheduleCache.ts`) for up to `SCHEDULE_CACHE_TTL_SECONDS`
 * (180s), invalidated by `invalidateScheduleCache()`. That function had
 * exactly one caller, `appendEvent()` (Session mutations): a write to any
 * OTHER table one of these responses embeds BY VALUE — a TimeGrid's blocks
 * and breaks, a Room's name, a Person's name, a Group's name, an Offering's
 * title, a SessionKind's name — went through the generic `/api/[resource]`
 * scaffold instead and never invalidated anything, so the edit kept showing
 * its OLD value for up to the TTL. A TimeGrid edit is the one that was
 * reported as "it took a while to update"; this file covers every table in
 * that same class, fixed the same way (`ResourceConfig.afterWrite` calling
 * `invalidateScheduleCacheOnWrite`, `server/utils/resources.ts`).
 *
 * `terms`/`timeGrids` on `context.get.ts` ARE fetched fresh on every request
 * (see that route's own comment), but only to resolve `termId` for the cache
 * key: on a cache HIT the whole response, `timeGrids` included, comes back
 * from the STORED value, discarding that fresh fetch. So the fix has to be an
 * invalidation, not a "just always re-fetch it" tweak, for every entity here.
 */
const GRID = 'test-grid-a';
const TERM = 'test-term-a';
const ROOM = 'test-room-private-a';
const PERSON = 'test-person-a';
const GROUP = 'test-group-seminar-a';
const OFFERING = 'test-offering-a';
const KIND = 'test-kind-a';

let cookie: string | null;

function gridsOf(body: unknown) {
    return (body as { timeGrids: { id: string; blocksPerDay: number; breaks: { label: string }[] }[] }).timeGrids;
}

function contextOf(body: unknown) {
    return body as {
        rooms: { id: string; name: string }[];
        people: { id: string; givenName: string }[];
        groups: { id: string; name: string }[];
    };
}

function sessionsOf(body: unknown) {
    return body as {
        id: string;
        offering: { title: string } | null;
        kind: { name: string };
    }[];
}

beforeAll(async () => {
    await seed();
    ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));
});

beforeEach(async () => {
    await ownerDb.timeGridBreak.deleteMany({ where: { timeGridId: GRID } });
    await ownerDb.timeGrid.update({
        where: { id: GRID },
        data: { blocksPerDay: 8, activeDays: [1, 2, 3, 4, 5], blockLengthMinutes: 45, breakMinutes: 15 },
    });
    await ownerDb.room.update({ where: { id: ROOM }, data: { name: 'Private A' } });
    await ownerDb.person.update({ where: { id: PERSON }, data: { givenName: 'Ada' } });
    await ownerDb.group.update({ where: { id: GROUP }, data: { name: 'Seminar A1' } });
    await ownerDb.offering.update({ where: { id: OFFERING }, data: { title: 'Databases' } });
    await ownerDb.sessionKind.update({ where: { id: KIND }, data: { name: 'Lecture' } });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('a TimeGrid write invalidates the cached schedule context', () => {
    it('shows an added break immediately, not after the cache TTL', async () => {
        // Warms the cache exactly as opening the schedule page would.
        const before = await api(`/api/schedule/context?termId=${TERM}`, { cookie });

        expect(before.status).toBe(200);
        expect(gridsOf(before.body).find((g) => g.id === GRID)?.breaks).toEqual([]);

        const patch = await api(`/api/time-grids/${GRID}`, {
            method: 'PATCH',
            cookie,
            body: JSON.stringify({
                breaks: [{ afterBlockIndex: 3, durationMinutes: 45, label: 'Lunch', dayOfWeek: null }],
            }),
        });

        expect(patch.status).toBe(200);

        const after = await api(`/api/schedule/context?termId=${TERM}`, { cookie });

        expect(gridsOf(after.body).find((g) => g.id === GRID)?.breaks.map((b) => b.label)).toEqual(['Lunch']);
    });

    it('shows a widened grid immediately too', async () => {
        await api(`/api/schedule/context?termId=${TERM}`, { cookie }); // warm

        const patch = await api(`/api/time-grids/${GRID}`, {
            method: 'PATCH', cookie, body: JSON.stringify({ blocksPerDay: 10 }),
        });

        expect(patch.status).toBe(200);

        const after = await api(`/api/schedule/context?termId=${TERM}`, { cookie });

        expect(gridsOf(after.body).find((g) => g.id === GRID)?.blocksPerDay).toBe(10);
    });
});

describe('a Room/Person/Group write invalidates the cached schedule context', () => {
    it('shows a renamed Room immediately', async () => {
        await api(`/api/schedule/context?termId=${TERM}`, { cookie }); // warm

        const patch = await api(`/api/rooms/${ROOM}`, { method: 'PATCH', cookie, body: JSON.stringify({ name: 'Renamed Room' }) });

        expect(patch.status).toBe(200);

        const after = await api(`/api/schedule/context?termId=${TERM}`, { cookie });

        expect(contextOf(after.body).rooms.find((r) => r.id === ROOM)?.name).toBe('Renamed Room');
    });

    it('shows a renamed Person immediately', async () => {
        await api(`/api/schedule/context?termId=${TERM}`, { cookie }); // warm

        const patch = await api(`/api/persons/${PERSON}`, { method: 'PATCH', cookie, body: JSON.stringify({ givenName: 'Renamed' }) });

        expect(patch.status).toBe(200);

        const after = await api(`/api/schedule/context?termId=${TERM}`, { cookie });

        expect(contextOf(after.body).people.find((p) => p.id === PERSON)?.givenName).toBe('Renamed');
    });

    it('shows a renamed Group immediately', async () => {
        await api(`/api/schedule/context?termId=${TERM}`, { cookie }); // warm

        const patch = await api(`/api/groups/${GROUP}`, { method: 'PATCH', cookie, body: JSON.stringify({ name: 'Renamed Group' }) });

        expect(patch.status).toBe(200);

        const after = await api(`/api/schedule/context?termId=${TERM}`, { cookie });

        expect(contextOf(after.body).groups.find((g) => g.id === GROUP)?.name).toBe('Renamed Group');
    });
});

describe('an Offering/SessionKind write invalidates the cached session list', () => {
    it('shows a renamed Offering immediately', async () => {
        await api(`/api/sessions?termId=${TERM}`, { cookie }); // warm

        const patch = await api(`/api/offerings/${OFFERING}`, { method: 'PATCH', cookie, body: JSON.stringify({ title: 'Renamed Offering' }) });

        expect(patch.status).toBe(200);

        const after = await api(`/api/sessions?termId=${TERM}`, { cookie });

        expect(sessionsOf(after.body).find((s) => s.offering?.title)?.offering?.title).toBe('Renamed Offering');
    });

    it('shows a renamed SessionKind immediately', async () => {
        await api(`/api/sessions?termId=${TERM}`, { cookie }); // warm

        const patch = await api(`/api/session-kinds/${KIND}`, { method: 'PATCH', cookie, body: JSON.stringify({ name: 'Renamed Kind' }) });

        expect(patch.status).toBe(200);

        const after = await api(`/api/sessions?termId=${TERM}`, { cookie });

        expect(sessionsOf(after.body).find((s) => s.kind.name)?.kind.name).toBe('Renamed Kind');
    });
});
