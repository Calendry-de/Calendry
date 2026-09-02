import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday, localNow, mondayOf, weekIndexOf } from '../shared/academicCalendar';
import { ACCOUNTS, TEST_PASSWORD, type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * The substitution plan on a lobby display (issue #31).
 *
 * WHAT THIS FILE GUARDS, THAT A CRUD TEST WOULD NOT:
 *
 *   1. THE EMPTY DAY IS NAMED. A day with no substitutions is the COMMON case,
 *      and the whole ticket turns on it not being drawn as emptiness. So the
 *      assertions here are on `state`, never on `entries.length` alone: an
 *      empty array is exactly what a broken fetch also produces, which is how
 *      the room board looked dead for two months of the year.
 *   2. THE SECOND SCOPE AXIS IS FAIL-OPEN AND NESTED. No `screen_group` rows
 *      means every group; a screen scoped to a YEAR group sees the classes
 *      beneath it, because the scope is expanded down the closure.
 *   3. THE THREE SOURCES ARE ALL READ. Covered comes from
 *      `session_substitution`, cancelled and moved come from the event log and
 *      from nowhere else: a banked Session has no placement left to query.
 *   4. THE MODE IS ENFORCED, not merely stored: each board refuses the other's
 *      key by name rather than drawing something the screen was not set up for.
 *
 * EVERY WRITE GOES THROUGH THE REAL ROUTE, never straight into the table. That
 * is deliberate: the board is cached, and the only thing that drops the cache
 * is `appendEvent()` firing from the write. A fixture inserted behind the API
 * would test the query and silently skip the invalidation, which is the half
 * that makes a stale substitution board worse than a slow one.
 */
let f: Fixtures;
let cookie = '';
let adminBCookie = '';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

/** Tenant A's zone, as the fixture seeds it. "Today" is always this one. */
const TENANT_TZ = 'Europe/Berlin';

interface Created { id: string; key: string; mode: string; groupIds: string[] }

interface SlotSpan { isoWeekday: number; blockIndex: number; startMinute: number; endMinute: number }

interface Entry {
    sessionId: string;
    change: 'covered' | 'cancelled' | 'moved-in' | 'moved-away';
    title: string;
    groups: string[];
    originalLecturers: string[];
    coveringLecturer: string | null;
    slot: SlotSpan | null;
    movedFrom: SlotSpan | null;
    movedTo: SlotSpan | null;
    isNow: boolean;
}

interface Day {
    date: string;
    isoWeekday: number;
    offset: number;
    state: 'ok' | 'no-substitutions' | 'no-term' | 'not-a-teaching-day';
    termName: string | null;
    entries: Entry[];
}

interface Plan { screenName: string | null; mode: string; days: Day[] }

const TERM_ID = 'sub-term-a';
const GRID_ID = 'sub-grid-a';
const KIND_ID = 'sub-kind-a';
const OFFERING_ID = 'sub-offering-a';
const YEAR_GROUP = 'sub-group-year';
const CLASS_GROUP = 'sub-group-class';
const OTHER_GROUP = 'sub-group-other';
/**
 * A group that NEVER acquires a change, so the named-empty-state assertions
 * stay true whatever else this file has done by then. `OTHER_GROUP` is the
 * cache test's subject and stops being empty the moment that test runs, which
 * is exactly the ordering coupling a shared fixture invites.
 */
const EMPTY_GROUP = 'sub-group-empty';

const local = localNow(new Date(), TENANT_TZ);
const today = local.date;
const tomorrow = addDays(today, 1);
const todayWeekday = isoWeekday(today);
const tomorrowWeekday = isoWeekday(tomorrow);

/**
 * The grid teaches every weekday EXCEPT tomorrow's, which is what makes
 * `not-a-teaching-day` reachable on a fixed schedule whatever day the suite
 * runs on. Anything keyed to a literal weekday would pass six days a week.
 */
const ACTIVE_DAYS = [1, 2, 3, 4, 5, 6, 7].filter((day) => day !== tomorrowWeekday);

/** The term starts a Monday four weeks back, so today is comfortably inside it. */
const TERM_START = addDays(mondayOf(today), -28);
const TERM_END = addDays(today, 60);
const TODAY_WEEK = weekIndexOf(TERM_START, today) + 1;

async function screenFor(body: Record<string, unknown>, as = cookie): Promise<Created> {
    const res = await api<Created>('/api/screens', {
        method: 'POST',
        cookie: as,
        body: JSON.stringify({ mode: 'SUBSTITUTION_PLAN', ...body }),
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);

    return res.body;
}

async function plan(key: string): Promise<Plan> {
    const res = await fetch(`${BASE}/api/screens/substitutions?key=${encodeURIComponent(key)}`);

    expect(res.status).toBe(200);

    return await res.json() as Plan;
}

const dayOf = (payload: Plan, offset: number): Day => {
    const day = payload.days.find((row) => row.offset === offset);

    expect(day, `the payload must always carry day ${offset}`).toBeDefined();

    return day!;
};

async function makeSession(id: string, blockIndex: number, groupId: string): Promise<void> {
    await ownerDb.session.create({
        data: {
            id,
            tenantId: f.tenantA,
            offeringId: OFFERING_ID,
            termId: TERM_ID,
            kindId: KIND_ID,
            timeGridId: GRID_ID,
            generationId: 'test-generation-a',
            termWeek: TODAY_WEEK,
            dayOfWeek: todayWeekday,
            blockIndex,
            durationBlocks: 1,
        },
    });

    await ownerDb.sessionGroup.create({ data: { tenantId: f.tenantA, sessionId: id, groupId } });
}

beforeAll(async () => {
    f = await seed();

    cookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    adminBCookie = (await login(ACCOUNTS.adminB, TEST_PASSWORD)).cookie;

    // The fixture provisions no domain Role at all; `provision:tenant` creates
    // `lecturer` for a real tenant, so the precondition every substitution
    // route depends on has to be built explicitly here.
    const lecturerRole = await ownerDb.role.create({
        data: { tenantId: f.tenantA, key: 'lecturer', name: 'Lecturer', isSystem: true },
    });

    async function makeLecturer(given: string, email: string): Promise<string> {
        const person = await ownerDb.person.create({
            data: { tenantId: f.tenantA, givenName: given, familyName: 'Lehrer', email },
        });

        await ownerDb.personRole.create({
            data: { tenantId: f.tenantA, personId: person.id, roleId: lecturerRole.id },
        });

        return person.id;
    }

    const original = await makeLecturer('Anna', 'anna-sub@a.test');
    const cover = await makeLecturer('Bernd', 'bernd-sub@a.test');

    // A Group tree, so the closure expansion has something to expand: the
    // Sessions hang off the CLASS, and a screen scoped to the YEAR must see
    // them anyway.
    await ownerDb.group.create({ data: { id: YEAR_GROUP, tenantId: f.tenantA, name: 'Jahrgang 7' } });
    await ownerDb.group.create({
        data: { id: CLASS_GROUP, tenantId: f.tenantA, parentGroupId: YEAR_GROUP, name: 'Klasse 7a' },
    });
    await ownerDb.group.create({ data: { id: OTHER_GROUP, tenantId: f.tenantA, name: 'Jahrgang 9' } });
    await ownerDb.group.create({ data: { id: EMPTY_GROUP, tenantId: f.tenantA, name: 'Jahrgang 11' } });

    await ownerDb.timeGrid.create({
        data: {
            id: GRID_ID, tenantId: f.tenantA, name: 'Vertretung grid',
            blockLengthMinutes: 45, blocksPerDay: 8, activeDays: ACTIVE_DAYS,
        },
    });
    await ownerDb.term.create({
        data: {
            id: TERM_ID, tenantId: f.tenantA, name: 'Laufendes Halbjahr',
            startDate: TERM_START, endDate: TERM_END, timeGridId: GRID_ID,
        },
    });
    await ownerDb.sessionKind.create({
        data: { id: KIND_ID, tenantId: f.tenantA, key: 'lesson', name: 'Lesson' },
    });
    await ownerDb.offering.create({
        data: {
            id: OFFERING_ID, tenantId: f.tenantA, termId: TERM_ID, kindId: KIND_ID,
            title: 'Mathematik', frequency: 5,
        },
    });

    await makeSession('sub-session-covered', 0, CLASS_GROUP);
    await makeSession('sub-session-cancelled', 2, CLASS_GROUP);
    await makeSession('sub-session-moved', 4, CLASS_GROUP);

    // The original lecturer, whose assignment a substitution must NOT touch.
    await ownerDb.sessionPerson.create({
        data: {
            tenantId: f.tenantA, sessionId: 'sub-session-covered',
            personId: original, roleId: lecturerRole.id,
        },
    });

    // --- the three writes, each through its real route ---------------------
    const covered = await api('/api/sessions/sub-session-covered/substitute', {
        method: 'POST',
        cookie,
        body: JSON.stringify({ personId: cover, reason: 'krank' }),
    });

    expect(covered.status, JSON.stringify(covered.body)).toBe(200);

    const banked = await api('/api/sessions/sub-session-cancelled/bank', {
        method: 'POST', cookie, body: JSON.stringify({ reason: 'Ausfall' }),
    });

    expect(banked.status, JSON.stringify(banked.body)).toBe(200);

    const moved = await api('/api/sessions/sub-session-moved/move', {
        method: 'POST',
        cookie,
        body: JSON.stringify({ termWeek: TODAY_WEEK, dayOfWeek: todayWeekday, blockIndex: 6 }),
    });

    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('the window is today AND tomorrow, always both', () => {
    it('returns exactly two days, each carrying its own named state', async () => {
        const screen = await screenFor({ name: 'Foyer' });

        try {
            const payload = await plan(screen.key);

            expect(payload.mode).toBe('SUBSTITUTION_PLAN');
            expect(payload.days.map((day) => day.offset)).toEqual([0, 1]);

            for (const day of payload.days) {
                expect(
                    ['ok', 'no-substitutions', 'no-term', 'not-a-teaching-day'],
                    `day ${day.offset} must name its state`,
                ).toContain(day.state);
            }
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });

    it('dates both days in the TENANT\'s zone, not the server\'s', async () => {
        const screen = await screenFor({ name: 'Zone' });

        try {
            const payload = await plan(screen.key);

            // Recomputed here from the same tenant zone rather than from
            // `new Date()`: a container clock is UTC, and around local midnight
            // the two disagree, which is exactly the bug worth pinning.
            expect(dayOf(payload, 0).date).toBe(today.toISOString().slice(0, 10));
            expect(dayOf(payload, 1).date).toBe(tomorrow.toISOString().slice(0, 10));
            expect(dayOf(payload, 0).isoWeekday).toBe(todayWeekday);
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });
});

describe('the three kinds of change', () => {
    it('lists covered, cancelled and moved, from three different sources', async () => {
        const screen = await screenFor({ name: 'All changes' });

        try {
            const day = dayOf(await plan(screen.key), 0);

            expect(day.state).toBe('ok');

            const byId = new Map(day.entries.map((entry) => [entry.sessionId, entry]));

            const covered = byId.get('sub-session-covered');

            expect(covered?.change).toBe('covered');
            expect(covered?.coveringLecturer).toBe('Bernd Lehrer');
            // The ORIGINAL assignment survives: a substitution is an overlay,
            // and a board that showed only the substitute would hide exactly
            // the distinction issue #30 exists to preserve.
            expect(covered?.originalLecturers).toEqual(['Anna Lehrer']);

            // A banked Session has NO placement left, so this row can only have
            // come from the BANK event's payload.
            const cancelled = byId.get('sub-session-cancelled');

            expect(cancelled?.change).toBe('cancelled');
            expect(cancelled?.movedFrom?.blockIndex).toBe(2);

            const moved = byId.get('sub-session-moved');

            expect(moved?.change).toBe('moved-in');
            expect(moved?.slot?.blockIndex).toBe(6);
            expect(moved?.movedFrom?.blockIndex).toBe(4);
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });

    it('decides isNow SERVER-side, and never for tomorrow', async () => {
        const screen = await screenFor({ name: 'Now' });

        try {
            const payload = await plan(screen.key);

            for (const entry of dayOf(payload, 1).entries) {
                expect(entry.isNow, 'tomorrow can never be now').toBe(false);
            }

            // Today's entries carry a boolean the client never computes; which
            // way it points depends on the wall clock, so the assertion is that
            // the decision was MADE here rather than left to the device.
            for (const entry of dayOf(payload, 0).entries) {
                expect(typeof entry.isNow).toBe('boolean');
            }
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });
});

describe('the empty day is NAMED, never drawn as emptiness', () => {
    it('says "no substitutions" for a scope with none, rather than returning nothing', async () => {
        /*
         * THE ASSERTION THIS FILE EXISTS FOR. `entries: []` on its own is
         * indistinguishable from a failed fetch, so the state has to carry the
         * meaning. A screen scoped to a group with no changes is the common
         * real-world case, and it must still say what it is.
         */
        const screen = await screenFor({ name: 'Quiet year', groupIds: [EMPTY_GROUP] });

        try {
            const day = dayOf(await plan(screen.key), 0);

            expect(day.entries).toEqual([]);
            expect(day.state).toBe('no-substitutions');
            // A term IS running: "nothing changed" and "nothing is scheduled"
            // are different answers and must not collapse into one.
            expect(day.termName).toBe('Laufendes Halbjahr');
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });

    it('distinguishes a non-teaching day from a quiet one', async () => {
        const screen = await screenFor({ name: 'Weekend' });

        try {
            const day = dayOf(await plan(screen.key), 1);

            // The fixture grid deliberately excludes tomorrow's weekday.
            expect(day.state).toBe('not-a-teaching-day');
            expect(day.entries).toEqual([]);
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });

    it('distinguishes a term gap from both', async () => {
        // Tenant B's only Term starts in October 2026 and so covers neither
        // day, whatever the suite's own calendar says.
        const screen = await screenFor({ name: 'Between terms' }, adminBCookie);

        try {
            const payload = await plan(screen.key);

            expect(dayOf(payload, 0).state).toBe('no-term');
            expect(dayOf(payload, 0).termName).toBeNull();
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie: adminBCookie });
        }
    });
});

describe('the second scope axis', () => {
    it('treats an empty group scope as EVERY group, not none', async () => {
        /*
         * Fail-open, matching `screen_room` and `group_term`. The opposite
         * reading would blank the display for the most common configuration
         * there is, and a blank display is indistinguishable from a broken one.
         */
        const screen = await screenFor({ name: 'Whole school' });

        try {
            const day = dayOf(await plan(screen.key), 0);

            expect(day.state).toBe('ok');
            // Every change in the tenant, including the one hanging off a Group
            // this screen never names.
            expect(day.entries.map((entry) => entry.sessionId)).toEqual(
                expect.arrayContaining(['sub-session-cancelled', 'sub-session-covered', 'sub-session-moved']),
            );
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });

    it('expands a YEAR group DOWN the closure to its classes', async () => {
        /*
         * The Sessions hang off "Klasse 7a"; the screen names only "Jahrgang 7".
         * Attendance flows DOWN (TAXONOMY.md §6), so the year must see them.
         * Walking the other direction would put the whole school on this wall.
         */
        const screen = await screenFor({ name: 'Jahrgang 7', groupIds: [YEAR_GROUP] });

        try {
            const day = dayOf(await plan(screen.key), 0);

            expect(day.state).toBe('ok');
            expect(day.entries.map((entry) => entry.sessionId).sort()).toEqual([
                'sub-session-cancelled', 'sub-session-covered', 'sub-session-moved',
            ]);
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });

    it('keeps a screen\'s group scope readable and editable, both axes at once', async () => {
        const screen = await screenFor({ name: 'Both axes', groupIds: [YEAR_GROUP] });

        try {
            const after = await api<{ mode: string; groupIds: string[]; roomIds: string[] }>(
                `/api/screens/${screen.id}`,
                { cookie },
            );

            expect(after.body.mode).toBe('SUBSTITUTION_PLAN');
            expect(after.body.groupIds).toEqual([YEAR_GROUP]);
            // Untouched by a group-scoped save, so switching mode back finds
            // the room scope still there.
            expect(after.body.roomIds).toEqual([]);

            // The same three-state PUT-set reading the room axis already has:
            // an EMPTY array clears the scope, which means every group.
            await api(`/api/screens/${screen.id}`, {
                method: 'PATCH', cookie, body: JSON.stringify({ groupIds: [] }),
            });

            const cleared = await api<{ groupIds: string[] }>(`/api/screens/${screen.id}`, { cookie });

            expect(cleared.body.groupIds).toEqual([]);

            // ...and null means "leave it alone", not "clear it".
            await api(`/api/screens/${screen.id}`, {
                method: 'PATCH', cookie, body: JSON.stringify({ groupIds: [YEAR_GROUP] }),
            });
            await api(`/api/screens/${screen.id}`, {
                method: 'PATCH', cookie, body: JSON.stringify({ name: 'Renamed', groupIds: null }),
            });

            const kept = await api<{ groupIds: string[] }>(`/api/screens/${screen.id}`, { cookie });

            expect(kept.body.groupIds).toEqual([YEAR_GROUP]);
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });
});

describe('the mode is enforced, not merely stored', () => {
    it('refuses a room-board key by name, naming the address that works', async () => {
        const roomScreen = await api<Created>('/api/screens', {
            method: 'POST', cookie, body: JSON.stringify({ name: 'Corridor board' }),
        });

        expect(roomScreen.body.mode).toBe('ROOM_BOARD');

        try {
            const res = await fetch(
                `${BASE}/api/screens/substitutions?key=${encodeURIComponent(roomScreen.body.key)}`,
            );

            expect(res.status).toBe(409);

            const body = await res.json() as { message?: string };

            expect(body.message ?? '').toContain('/screen');
        } finally {
            await api(`/api/screens/${roomScreen.body.id}`, { method: 'DELETE', cookie });
        }
    });

    it('refuses a substitution key on the ROOM board, symmetrically', async () => {
        const screen = await screenFor({ name: 'Plan only' });

        try {
            const res = await fetch(`${BASE}/api/screens/board?key=${encodeURIComponent(screen.key)}`);

            expect(res.status).toBe(409);

            const body = await res.json() as { message?: string };

            expect(body.message ?? '').toContain('/screen/substitutions');
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });
});

describe('a plan key is authority for its own board and NOTHING else', () => {
    it('cannot read any other endpoint, while live', async () => {
        const screen = await screenFor({ name: 'Probe' });

        try {
            for (const path of ['/api/sessions', '/api/persons', '/api/groups', '/api/screens']) {
                const res = await fetch(`${BASE}${path}?key=${encodeURIComponent(screen.key)}`);

                expect(res.status, `${path} must refuse a screen key`).toBe(403);
            }
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });

    it('says WHY it is blank: unrecognised, absent and deactivated all differ', async () => {
        expect((await fetch(`${BASE}/api/screens/substitutions?key=nope`)).status).toBe(401);
        expect((await fetch(`${BASE}/api/screens/substitutions`)).status).toBe(401);

        const screen = await screenFor({ name: 'To be revoked' });

        try {
            await api(`/api/screens/${screen.id}`, {
                method: 'PATCH', cookie, body: JSON.stringify({ isActive: false }),
            });

            const res = await fetch(
                `${BASE}/api/screens/substitutions?key=${encodeURIComponent(screen.key)}`,
            );

            expect(res.status).toBe(403);
            expect(((await res.json()) as { message?: string }).message ?? '').toMatch(/deactivated/i);
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });

    it('stamps last_seen_at, which needs the tenant transaction to work at all', async () => {
        const screen = await screenFor({ name: 'Seen' });

        try {
            const before = await api<{ lastSeenAt: string | null }>(`/api/screens/${screen.id}`, { cookie });

            expect(before.body.lastSeenAt).toBeNull();

            await plan(screen.key);

            const after = await api<{ lastSeenAt: string | null }>(`/api/screens/${screen.id}`, { cookie });

            expect(after.body.lastSeenAt, 'a plan fetch must stamp the screen').not.toBeNull();
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });
});

describe('a substitution write reaches the board immediately', () => {
    it('drops the cache, rather than serving yesterday\'s plan for a TTL', async () => {
        /*
         * The board is cached per tenant + group scope + local date, and the
         * only thing that invalidates it is `appendEvent()`. This reads the
         * board FIRST, so the cache is warm, and then writes: a stale
         * substitution board is worse than a slow one.
         */
        const screen = await screenFor({ name: 'Cache', groupIds: [OTHER_GROUP] });

        await ownerDb.session.create({
            data: {
                id: 'sub-session-late', tenantId: f.tenantA, offeringId: OFFERING_ID,
                termId: TERM_ID, kindId: KIND_ID, timeGridId: GRID_ID,
                generationId: 'test-generation-a',
                termWeek: TODAY_WEEK, dayOfWeek: todayWeekday, blockIndex: 7, durationBlocks: 1,
            },
        });
        await ownerDb.sessionGroup.create({
            data: { tenantId: f.tenantA, sessionId: 'sub-session-late', groupId: OTHER_GROUP },
        });

        try {
            expect(dayOf(await plan(screen.key), 0).state).toBe('no-substitutions');

            const banked = await api('/api/sessions/sub-session-late/bank', {
                method: 'POST', cookie, body: JSON.stringify({ reason: 'kurzfristig' }),
            });

            expect(banked.status, JSON.stringify(banked.body)).toBe(200);

            const day = dayOf(await plan(screen.key), 0);

            expect(day.state, 'the warmed cache must have been dropped by the write').toBe('ok');
            expect(day.entries.map((entry) => entry.sessionId)).toEqual(['sub-session-late']);
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });
});

describe('the display page', () => {
    it('renders without a session, and draws the NAMED empty state as words', async () => {
        const screen = await screenFor({ name: 'Wall plan', groupIds: [EMPTY_GROUP] });

        try {
            const res = await fetch(`${BASE}/screen/substitutions?key=${encodeURIComponent(screen.key)}`);

            expect(res.status).toBe(200);

            const html = (await res.text()).replace(/<!--[\s\S]*?-->/g, '');

            expect(html).toContain('Wall plan');
            // The empty day is a SENTENCE on the wall, not an absence of rows.
            expect(html).toContain('No substitutions.');
            // The guard exempts this path too; a redirect would render a login
            // form on a wall for a device that has no way to sign in.
            expect(html).not.toMatch(/name="password"/);
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });

    it('draws a covered lesson with both names, original and substitute', async () => {
        const screen = await screenFor({ name: 'Wall full' });

        try {
            const res = await fetch(`${BASE}/screen/substitutions?key=${encodeURIComponent(screen.key)}`);
            const html = (await res.text()).replace(/<!--[\s\S]*?-->/g, '');

            expect(html).toContain('Mathematik');
            expect(html).toContain('Bernd Lehrer');
            expect(html).toContain('Anna Lehrer');
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });
});
