import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * Screens: a lobby display is a DEVICE credential.
 *
 * THE ASSERTION THAT MATTERS is `a screen key cannot read anything else`. A
 * screen resolves to a real identity, which is what lets it read a board without
 * an account, and the whole safety argument is that it holds no acting Person,
 * so `heldPermissions()` refuses it everywhere. That property is emergent rather
 * than written down at each route: nothing in `/api/persons` mentions screens,
 * and it stays safe only because the identity carries no Person.
 *
 * So it is tested against a LIVE key, over several unrelated endpoints, and it
 * needs to stay that way. The first version of this probe ran after revoking the
 * key and got 401 everywhere, which looks like a pass and proves nothing, since
 * a revoked key is refused before any permission is consulted.
 */
let cookie = '';
let roomId = '';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

interface Created { id: string; key: string; roomIds: string[]; planStartMinute: number | null; planEndMinute: number | null }

/** A rendered page, with Vue's dev-mode template comments stripped. */
async function page(path: string): Promise<string> {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie } });

    expect(res.status).toBe(200);

    return (await res.text()).replace(/<!--[\s\S]*?-->/g, '');
}

async function makeScreen(body: Record<string, unknown>): Promise<Created> {
    const res = await api<Created>('/api/screens', {
        method: 'POST',
        cookie,
        body: JSON.stringify(body),
    });

    expect(res.status).toBe(201);

    return res.body;
}

beforeAll(async () => {
    const ids = await seed();

    cookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    roomId = ids.roomPrivateA;
});

afterAll(teardown);

describe('the key is issued once and never again', () => {
    it('returns a key on create', async () => {
        const screen = await makeScreen({ name: 'Main entrance' });

        expect(screen.key).toBeTruthy();
        expect(screen.key.length).toBeGreaterThan(20);

        await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
    });

    it('never returns the key, or its hash, on any read', async () => {
        const screen = await makeScreen({ name: 'Corridor' });

        try {
            const one = await api<Record<string, unknown>>(`/api/screens/${screen.id}`, { cookie });
            const list = await api<Record<string, unknown>[]>('/api/screens', { cookie });

            for (const payload of [one.body, ...list.body]) {
                expect(Object.keys(payload)).not.toContain('key');
                expect(Object.keys(payload)).not.toContain('tokenHash');
                expect(Object.keys(payload)).not.toContain('token_hash');
            }
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });
});

describe('a screen key is authority for the board and NOTHING else', () => {
    it('cannot read any other endpoint, while live', async () => {
        const screen = await makeScreen({ name: 'Probe' });

        try {
            // Deliberately a spread of unrelated routes, including the screens
            // collection itself: a display must not be able to enumerate its
            // siblings or discover the rest of the institution.
            for (const path of ['/api/sessions', '/api/rooms', '/api/persons', '/api/screens', '/api/constraints']) {
                const res = await fetch(`${BASE}${path}?key=${encodeURIComponent(screen.key)}`);

                expect(res.status, `${path} must refuse a screen key`).toBe(403);
            }
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });

    it('reads its board with no cookie at all', async () => {
        const screen = await makeScreen({ name: 'Board reader' });

        try {
            const res = await fetch(`${BASE}/api/screens/board?key=${encodeURIComponent(screen.key)}`);

            expect(res.status).toBe(200);

            const body = await res.json() as { screenName: string; state: string };

            expect(body.screenName).toBe('Board reader');
            // Either state is correct here: the fixture may or may not have a
            // term running today. What matters is that it answered at all.
            expect(['ok', 'no-term']).toContain(body.state);
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });
});

describe('a display says WHY it is blank', () => {
    it('answers 401 for an unrecognised key', async () => {
        const res = await fetch(`${BASE}/api/screens/board?key=definitely-not-a-key`);

        expect(res.status).toBe(401);
    });

    it('answers 401 with no credential at all', async () => {
        const res = await fetch(`${BASE}/api/screens/board`);

        expect(res.status).toBe(401);
    });

    it('distinguishes DEACTIVATED from unrecognised', async () => {
        /*
         * The distinction is the point. Both are "no board", but only one is
         * fixable by whoever walks past, and the resolver treats an inactive
         * screen as no identity, which would otherwise reach the wall as a bare
         * 401 indistinguishable from a typo.
         */
        const screen = await makeScreen({ name: 'To be revoked' });

        try {
            await api(`/api/screens/${screen.id}`, {
                method: 'PATCH',
                cookie,
                body: JSON.stringify({ isActive: false }),
            });

            const res = await fetch(`${BASE}/api/screens/board?key=${encodeURIComponent(screen.key)}`);

            expect(res.status).toBe(403);

            const body = await res.json() as { message?: string };

            expect(body.message ?? '').toMatch(/deactivated/i);
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });
});

describe('the room scope', () => {
    it('treats an empty scope as EVERY room, not none', async () => {
        /*
         * Fail-open, matching `group_term`. The opposite reading would produce a
         * blank display for the most common configuration there is, and a blank
         * display is indistinguishable from a broken one.
         */
        const unscoped = await makeScreen({ name: 'Everything' });
        const scoped = await makeScreen({ name: 'One room', roomIds: [roomId] });

        try {
            const all = await fetch(`${BASE}/api/screens/board?key=${encodeURIComponent(unscoped.key)}`)
                .then((res) => res.json()) as { rooms: unknown[] };
            const one = await fetch(`${BASE}/api/screens/board?key=${encodeURIComponent(scoped.key)}`)
                .then((res) => res.json()) as { rooms: { id: string }[] };

            expect(one.rooms.length).toBe(1);
            expect(one.rooms[0]!.id).toBe(roomId);
            expect(all.rooms.length).toBeGreaterThan(one.rooms.length);
        } finally {
            await api(`/api/screens/${unscoped.id}`, { method: 'DELETE', cookie });
            await api(`/api/screens/${scoped.id}`, { method: 'DELETE', cookie });
        }
    });
});

describe('the payload the shared form actually sends', () => {
    /*
     * THE BUG THIS PINS was reported as a bare "VALIDATION ERROR" from the most
     * ordinary action there is: creating a screen without ticking a room, which
     * is the common case because empty means every room.
     *
     * `useEntityForm` serialises EVERY declared field on every save and returns
     * `value ?? null` for anything untouched, so the form sends `roomIds: null`
     * and `key: null`, not absent fields. `optional()` accepts `undefined` and
     * rejects `null`, so the schema refused its own form. Nothing in the
     * handler was wrong; the contract was written against an imagined caller
     * rather than the real one.
     *
     * These tests therefore send the literal shapes the form produces, rather
     * than tidy hand-written ones: a hand-written body is exactly what hid this.
     */
    it('accepts a create with roomIds null, no rooms ticked', async () => {
        const res = await api<Created>('/api/screens', {
            method: 'POST',
            cookie,
            body: JSON.stringify({ name: 'Front desk', isActive: true, roomIds: null, key: null }),
        });

        expect(res.status).toBe(201);
        // A null scope is the empty scope, which is every room.
        expect(res.body.roomIds).toEqual([]);

        await api(`/api/screens/${res.body.id}`, { method: 'DELETE', cookie });
    });

    it('accepts an edit with nulls, leaving the scope alone', async () => {
        const screen = await makeScreen({ name: 'Editable', roomIds: [roomId] });

        try {
            const res = await api(`/api/screens/${screen.id}`, {
                method: 'PATCH',
                cookie,
                body: JSON.stringify({ name: 'Renamed', roomIds: null, isActive: null }),
            });

            expect(res.status).toBe(200);

            const after = await api<{ name: string; roomIds: string[]; isActive: boolean }>(
                `/api/screens/${screen.id}`,
                { cookie },
            );

            expect(after.body.name).toBe('Renamed');
            // Null means "leave it alone", so the scope survives a rename.
            expect(after.body.roomIds).toEqual([roomId]);
            expect(after.body.isActive).toBe(true);
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });

    it('treats an EMPTY array as "clear the scope", not as "leave it alone"', async () => {
        // The distinction null/[] is real and both are reachable from the UI:
        // null when the field was never touched, [] when somebody unticked
        // everything. They must not mean the same thing.
        const screen = await makeScreen({ name: 'Narrowed', roomIds: [roomId] });

        try {
            await api(`/api/screens/${screen.id}`, {
                method: 'PATCH',
                cookie,
                body: JSON.stringify({ roomIds: [] }),
            });

            const after = await api<{ roomIds: string[] }>(`/api/screens/${screen.id}`, { cookie });

            expect(after.body.roomIds).toEqual([]);
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });
});

describe('liveness', () => {
    it('records last_seen_at, which needs the tenant transaction to work at all', async () => {
        /*
         * This shipped broken once and the test exists because of it. The write
         * was a fire-and-forget through `getPrisma()` OUTSIDE `withTenant()`,
         * where the app role's `FORCE ROW LEVEL SECURITY` has no
         * `current_tenant_id()` to compare against, so the UPDATE matched zero
         * rows, silently, forever. Nothing in the response changed, which is why
         * only reading the column afterwards caught it.
         */
        const screen = await makeScreen({ name: 'Seen' });

        try {
            const before = await api<{ lastSeenAt: string | null }>(`/api/screens/${screen.id}`, { cookie });

            expect(before.body.lastSeenAt).toBeNull();

            await fetch(`${BASE}/api/screens/board?key=${encodeURIComponent(screen.key)}`);

            const after = await api<{ lastSeenAt: string | null }>(`/api/screens/${screen.id}`, { cookie });

            expect(after.body.lastSeenAt, 'a board fetch must stamp the screen').not.toBeNull();
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });
});

describe('the management form', () => {
    it('offers the tenant\'s rooms, rather than claiming there are none', async () => {
        /*
         * SHIPPED BROKEN ONCE, and invisibly: the `roomIds` field was declared
         * `type: 'text'`, and `referencedResources()` builds the form's fetch
         * wave only from fields carrying a `reference`. So no rooms were ever
         * fetched and the picker rendered its empty state, "No rooms defined
         * yet.", in a tenant with four. Nothing errored; the form simply told a
         * confident lie, which is this codebase's recurring failure shape.
         *
         * Asserted against SSR output because the picker is server-rendered. The
         * KEY panel is not: the key is generated in the browser on purpose, so
         * it cannot appear here.
         */
        const html = await page('/manage/screens/new');

        expect(html).not.toContain('No rooms defined yet');
        // The fail-open reading, stated in words. "Every room" (capitalised) is
        // the READ-ONLY rendering; an editable form shows the help text instead,
        // and asserting the wrong one passes for a page with no picker at all.
        expect(html).toContain('Leave all unticked');

        const rooms = await api<{ name: string }[]>('/api/rooms', { cookie });

        for (const room of rooms.body) {
            expect(html, `the picker must offer ${room.name}`).toContain(room.name);
        }
    });
});

describe("the room plan's own hours", () => {
    /*
     * Issue #131. NULL IS A REAL VALUE on these two columns, and that is the
     * whole reason this is tested through the API rather than left to the form:
     * every other nullable field on this route reads null as "leave it alone",
     * these two read it as "hand the day back to the timetable", and the shared
     * form sends null for anything untouched. Get that backwards and a window
     * can be set once and never removed.
     */
    it('stores a window, returns it on both reads, and clears it with null', async () => {
        const screen = await makeScreen({
            name: 'Windowed board',
            planStartMinute: 8 * 60,
            planEndMinute: 16 * 60,
        });

        try {
            const one = await api<{ planStartMinute: number | null; planEndMinute: number | null }>(
                `/api/screens/${screen.id}`,
                { cookie },
            );

            expect(one.body.planStartMinute).toBe(8 * 60);
            expect(one.body.planEndMinute).toBe(16 * 60);

            // The list carries it too: the management table and form are both
            // fed from here, and a field missing from the list renders as an
            // empty control over a stored value, which then saves as a clear.
            const list = await api<{ id: string; planStartMinute: number | null }[]>('/api/screens', { cookie });

            expect(list.body.find((row) => row.id === screen.id)?.planStartMinute).toBe(8 * 60);

            const cleared = await api<{ planStartMinute: number | null; planEndMinute: number | null }>(
                `/api/screens/${screen.id}`,
                { method: 'PATCH', cookie, body: JSON.stringify({ planStartMinute: null, planEndMinute: null }) },
            );

            expect(cleared.status).toBe(200);
            expect(cleared.body.planStartMinute).toBeNull();
            expect(cleared.body.planEndMinute).toBeNull();
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });

    it('leaves the window alone when the field is absent, unlike null', async () => {
        const screen = await makeScreen({ name: 'Untouched window', planStartMinute: 9 * 60 });

        try {
            const renamed = await api<{ planStartMinute: number | null }>(`/api/screens/${screen.id}`, {
                method: 'PATCH',
                cookie,
                body: JSON.stringify({ name: 'Renamed' }),
            });

            expect(renamed.body.planStartMinute, 'a rename must not clear the window').toBe(9 * 60);
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });

    it('refuses a window whose ends are crossed, by name', async () => {
        // Refused loudly rather than clamped or swapped: a display drawing a
        // different day than the one it was told to is the invisible failure,
        // and the person who can fix it is the one submitting this form.
        const res = await api('/api/screens', {
            method: 'POST',
            cookie,
            body: JSON.stringify({ name: 'Backwards', planStartMinute: 16 * 60, planEndMinute: 8 * 60 }),
        });

        expect(res.status).toBe(400);
    });

    it('accepts one end on its own', async () => {
        const screen = await makeScreen({ name: 'Open ended', planStartMinute: 7 * 60 });

        try {
            expect(screen.planStartMinute).toBe(7 * 60);
            expect(screen.planEndMinute).toBeNull();
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });
});

describe('the display page', () => {
    it('renders without a session, and is not bounced to login', async () => {
        const screen = await makeScreen({ name: 'Wall display' });

        try {
            const res = await fetch(`${BASE}/screen?key=${encodeURIComponent(screen.key)}`);

            expect(res.status).toBe(200);

            const html = (await res.text()).replace(/<!--[\s\S]*?-->/g, '');

            expect(html).toContain('Wall display');
            // The guard exempts `/screen`; a redirect would render the login page
            // on a wall for a device that has no way to sign in.
            expect(html).not.toMatch(/name="password"/);

            /*
             * THE PLAN ITSELF IS SERVER-RENDERED, rooms and all. The paging
             * that hides rooms past the first page is a CLIENT measurement
             * (`roomPlanColumnsPerPage` reads an unmeasured viewport as "every
             * room"), so SSR carries the whole institution: asserting a room
             * name here is what would catch a plan that renders its frame and
             * no columns, which on a wall is indistinguishable from a building
             * with nothing booked in it.
             */
            expect(html, "the plan's time axis must render").toContain('Time');

            const rooms = await api<{ name: string }[]>('/api/rooms', { cookie });

            expect(rooms.body.length, 'the fixture needs a room for this to prove anything').toBeGreaterThan(0);
            expect(html, `the plan must name ${rooms.body[0]!.name}`).toContain(rooms.body[0]!.name);
        } finally {
            await api(`/api/screens/${screen.id}`, { method: 'DELETE', cookie });
        }
    });
});
