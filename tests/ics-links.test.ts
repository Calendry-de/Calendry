import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Fixtures, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * Calendar-subscription links: issue #15's stream half, replacing the
 * one-off `GET /api/me/schedule.ics` download (`tests/ical-export.test.ts`,
 * removed with it).
 *
 * THE SECRET IS RETRIEVABLE, unlike an API token or screen key: the whole
 * point is a link a Person re-copies into a calendar app, so `GET
 * /api/me/ics-links` returns the full `url` every time, not once.
 *
 * THE STREAM ITSELF REUSES `ownSessionClause`, the same "mine" `session.read_own`
 * already uses, proven the same way the old download test proved it: a second
 * Session in the same Term attached to a different Person must never appear.
 *
 * `test-tenant-a`'s timezone is set to Europe/Berlin here for the same reason
 * the old suite set it: the fixture defaults to UTC, which would make a wrong
 * UTC conversion invisible.
 *
 * PERMISSION FIXTURES (issue #115). `adminA` holds the whole catalogue
 * (`allPermissions` in `tests/helpers/seed.ts`), so it covers both
 * `ics_link.generate` and `ics_link.generate_own`: the "may target Groups"
 * cases below use it. `viewerA` holds exactly `session.read`, pinned exactly
 * by `auth-permissions.test.ts` and shared by 24 other suites, so it is
 * deliberately NOT widened here. It stands in for "holds neither ics_link
 * key". `multiA` (personMultiA, `ACCOUNTS.multi` logged into `test-a`) is a
 * SECOND admin-shaped person in the same tenant, used wherever the "own
 * links only" tests need somebody who is not `adminA` but can still mint one.
 * `ownOnly` is a file-local fixture (own AccessRole, own Person, own Account)
 * holding EXACTLY `ics_link.generate_own`, the one shape that can mint a
 * link at all but must be refused `groupIds`.
 */
let f: Fixtures;
let adminCookie = '';
let viewerCookie = '';
let multiCookie = '';
let ownOnlyCookie = '';

const OWN_ONLY_EMAIL = 'ics-own-only@test.local';

interface CreatedLink {
    id: string;
    name: string;
    url: string;
    scope: 'ALL' | 'TERM';
    termId: string | null;
    weeksAhead: number | null;
    groupIds: string[];
}

function tokenOf(url: string): string {
    return new URL(url).searchParams.get('token') as string;
}

async function createLink(cookie: string, body: Record<string, unknown>) {
    const res = await api<CreatedLink>('/api/me/ics-links', {
        method: 'POST',
        cookie,
        body: JSON.stringify(body),
    });

    return { status: res.status, body: res.body };
}

/** A Person/AccessRole/Account holding exactly `ics_link.generate_own`: no `session.read_own`, no `ics_link.generate`. */
async function seedOwnOnly(tenantId: string) {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${OWN_ONLY_EMAIL}'`);

    const role = await ownerDb.accessRole.create({
        data: { tenantId, key: 'ics-own-only', name: 'Own calendar link only' },
    });

    await ownerDb.accessRolePermission.create({
        data: { accessRoleId: role.id, permissionKey: 'ics_link.generate_own', tenantId },
    });

    const person = await ownerDb.person.create({
        data: { tenantId, givenName: 'Own', familyName: 'Only', email: 'own-only-ics@a.test' },
    });

    await ownerDb.personAccessRole.create({ data: { personId: person.id, accessRoleId: role.id, tenantId } });

    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });
    const account = await ownerDb.account.create({ data: { email: OWN_ONLY_EMAIL, passwordHash: template.passwordHash } });

    await ownerDb.accountPerson.create({ data: { accountId: account.id, personId: person.id } });
}

beforeAll(async () => {
    f = await seed();
    adminCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    viewerCookie = (await login(ACCOUNTS.viewerA, TEST_PASSWORD)).cookie;
    multiCookie = (await login(ACCOUNTS.multi, TEST_PASSWORD, 'test-a')).cookie;

    await seedOwnOnly(f.tenantA);
    ownOnlyCookie = (await login(OWN_ONLY_EMAIL, TEST_PASSWORD)).cookie;

    await ownerDb.tenant.update({ where: { id: f.tenantA }, data: { timezone: 'Europe/Berlin' } });
});

afterAll(async () => {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${OWN_ONLY_EMAIL}'`);
    await teardown();
    await ownerDb.$disconnect();
});

describe('creating a link', () => {
    it('mints a TERM-scope link with a full, immediately-usable url', async () => {
        const { status, body } = await createLink(adminCookie, { name: 'Phone', scope: 'TERM', termId: f.termA });

        expect(status).toBe(201);
        expect(body.scope).toBe('TERM');
        expect(body.termId).toBe(f.termA);
        expect(body.url).toContain('/api/ics/stream.ics?token=');

        await api(`/api/me/ics-links/${body.id}`, { method: 'DELETE', cookie: adminCookie });
    });

    it('mints an ALL-scope link with a weeksAhead window', async () => {
        const { status, body } = await createLink(adminCookie, { name: 'Laptop', scope: 'ALL', weeksAhead: 6 });

        expect(status).toBe(201);
        expect(body.scope).toBe('ALL');
        expect(body.weeksAhead).toBe(6);
        expect(body.termId).toBeNull();

        await api(`/api/me/ics-links/${body.id}`, { method: 'DELETE', cookie: adminCookie });
    });

    it('refuses TERM scope with no termId', async () => {
        const { status } = await createLink(adminCookie, { name: 'Bad', scope: 'TERM' });

        expect(status).toBe(400);
    });

    it('refuses ALL scope with no weeksAhead', async () => {
        const { status } = await createLink(adminCookie, { name: 'Bad', scope: 'ALL' });

        expect(status).toBe(400);
    });

    it('refuses a weeksAhead outside 1..52', async () => {
        const { status } = await createLink(adminCookie, { name: 'Bad', scope: 'ALL', weeksAhead: 0 });

        expect(status).toBe(400);
    });

    it('refuses a termId from another tenant', async () => {
        const { status } = await createLink(adminCookie, { name: 'Cross-tenant', scope: 'TERM', termId: f.termB });

        expect(status).toBe(404);
    });

    it('a bearer token cannot mint a link, session only', async () => {
        const minted = await api<{ token: string; id: string }>('/api/me/api-tokens', {
            method: 'POST',
            cookie: adminCookie,
            body: JSON.stringify({ name: 'Probe', permissions: ['room.read'] }),
        });

        try {
            const viaToken = await api<CreatedLink>('/api/me/ics-links', {
                method: 'POST',
                headers: { authorization: `Bearer ${minted.body.token}` },
                body: JSON.stringify({ name: 'Laundered', scope: 'ALL', weeksAhead: 1 }),
            });

            expect(viaToken.status).toBe(403);
        } finally {
            await api(`/api/me/api-tokens/${minted.body.id}`, { method: 'DELETE', cookie: adminCookie });
        }
    });
});

describe('permission gating (issue #115)', () => {
    it('refuses a caller holding neither ics_link key', async () => {
        const { status } = await createLink(viewerCookie, { name: 'Nope', scope: 'ALL', weeksAhead: 4 });

        expect(status).toBe(403);
    });

    it('ics_link.generate_own may mint an own-schedule link', async () => {
        const { status, body } = await createLink(ownOnlyCookie, { name: 'Own', scope: 'ALL', weeksAhead: 4 });

        expect(status).toBe(201);
        expect(body.groupIds).toEqual([]);

        await api(`/api/me/ics-links/${body.id}`, { method: 'DELETE', cookie: ownOnlyCookie });
    });

    it('ics_link.generate_own may NOT target a Group', async () => {
        const { status } = await createLink(ownOnlyCookie, {
            name: 'Overreach', scope: 'ALL', weeksAhead: 4, groupIds: [f.groupSeminarA],
        });

        expect(status).toBe(403);
    });
});

describe('listing and deleting', () => {
    it('lists only the callers own links, with the streamable url every time', async () => {
        const mine = await createLink(adminCookie, { name: 'Mine', scope: 'TERM', termId: f.termA });
        const theirs = await createLink(multiCookie, { name: 'Theirs', scope: 'TERM', termId: f.termA });

        try {
            const list = await api<CreatedLink[]>('/api/me/ics-links', { cookie: adminCookie });

            expect(list.status).toBe(200);
            const row = list.body.find((l) => l.id === mine.body.id);

            expect(row).toBeTruthy();
            expect(row?.url).toContain('token=');
            expect(list.body.some((l) => l.id === theirs.body.id)).toBe(false);
        } finally {
            await api(`/api/me/ics-links/${mine.body.id}`, { method: 'DELETE', cookie: adminCookie });
            await api(`/api/me/ics-links/${theirs.body.id}`, { method: 'DELETE', cookie: multiCookie });
        }
    });

    it('cannot delete somebody else\'s link', async () => {
        const { body } = await createLink(adminCookie, { name: 'Not yours', scope: 'TERM', termId: f.termA });

        try {
            const res = await api(`/api/me/ics-links/${body.id}`, { method: 'DELETE', cookie: viewerCookie });

            expect(res.status).toBe(404);
        } finally {
            await api(`/api/me/ics-links/${body.id}`, { method: 'DELETE', cookie: adminCookie });
        }
    });

    it('a deleted link stops streaming immediately', async () => {
        const { body } = await createLink(adminCookie, { name: 'Short-lived', scope: 'TERM', termId: f.termA });
        const token = tokenOf(body.url);

        const before = await api(`/api/ics/stream.ics?token=${token}`);

        expect(before.status).toBe(200);

        const del = await api(`/api/me/ics-links/${body.id}`, { method: 'DELETE', cookie: adminCookie });

        expect(del.status).toBe(200);

        const after = await api(`/api/ics/stream.ics?token=${token}`);

        expect(after.status).toBe(401);
    });
});

describe('the stream', () => {
    it('refuses no token, and one that resolves to nothing', async () => {
        expect((await api('/api/ics/stream.ics')).status).toBe(401);
        expect((await api('/api/ics/stream.ics?token=not-a-real-token')).status).toBe(401);
    });

    it('is a valid VCALENDAR, unauthenticated, containing only MY OWN sessions', async () => {
        const { body } = await createLink(adminCookie, { name: 'Term feed', scope: 'TERM', termId: f.termA });

        try {
            // A second Session in the same Term, attached to nobody `adminA`
            // is: the stream must never show it.
            const stranger = await ownerDb.person.create({
                data: { tenantId: f.tenantA, givenName: 'Not', familyName: 'Mine', email: 'notmine-ics@a.test' },
            });
            const other = await ownerDb.session.create({
                data: {
                    tenantId: f.tenantA, termId: f.termA, kindId: 'test-kind-a', timeGridId: 'test-grid-a',
                    title: 'Somebody else’s meeting', termWeek: 1, dayOfWeek: 3, blockIndex: 0,
                    generationId: 'test-generation-a', isLocked: true,
                },
            });

            await ownerDb.sessionPerson.create({
                data: { tenantId: f.tenantA, sessionId: other.id, personId: stranger.id },
            });

            // No `cookie`: this is the whole point, an external calendar app
            // never has one.
            const res = await api(`/api/ics/stream.ics?token=${tokenOf(body.url)}`);

            expect(res.status).toBe(200);
            const text = res.body as unknown as string;

            expect(text).toContain('BEGIN:VCALENDAR');
            expect(text).toContain('END:VCALENDAR');
            expect(text).toContain('SUMMARY:Databases');
            expect(text).toContain('LOCATION:Private A');
            expect(text).not.toContain('Somebody else');

            // test-session-a: week 1, Tuesday, block 0 (08:00 local),
            // 2026-09-29 in Europe/Berlin, still CEST (UTC+2) before the late
            // October transition. A UTC-literal bug would emit 08:00Z.
            expect(text).toContain('DTSTART:20260929T060000Z');
            expect(text).toContain('DTEND:20260929T064500Z');

            const uid = /UID:([^\r\n]+)/.exec(text)?.[1];

            expect(uid).toBeTruthy();

            const second = await api(`/api/ics/stream.ics?token=${tokenOf(body.url)}`);

            expect((second.body as unknown as string)).toContain(`UID:${uid}`);
        } finally {
            await api(`/api/me/ics-links/${body.id}`, { method: 'DELETE', cookie: adminCookie });
        }
    });

    it('ALL scope bounds by weeksAhead: a short window excludes a Session further out, a longer one includes it', async () => {
        // test-session-a is ~4 weeks from "now" at the time this suite was
        // written (2026-09-29, term starts 2026-10-01); see the fixture.
        const short = await createLink(adminCookie, { name: 'Next week', scope: 'ALL', weeksAhead: 1 });
        const long = await createLink(adminCookie, { name: 'Next couple months', scope: 'ALL', weeksAhead: 8 });

        try {
            const near = await api(`/api/ics/stream.ics?token=${tokenOf(short.body.url)}`);
            const far = await api(`/api/ics/stream.ics?token=${tokenOf(long.body.url)}`);

            expect((near.body as unknown as string)).not.toContain('Databases');
            expect((far.body as unknown as string)).toContain('Databases');
        } finally {
            await api(`/api/me/ics-links/${short.body.id}`, { method: 'DELETE', cookie: adminCookie });
            await api(`/api/me/ics-links/${long.body.id}`, { method: 'DELETE', cookie: adminCookie });
        }
    });

    it('a signed-in cookie with no token still gets refused, not a silent empty calendar', async () => {
        const res = await api('/api/ics/stream.ics', { cookie: adminCookie });

        expect(res.status).toBe(401);
    });
});

describe('group-scoped links (issue #115)', () => {
    it('refuses a groupId not found in the caller\'s own tenant', async () => {
        const { status } = await createLink(adminCookie, {
            name: 'Bad group', scope: 'ALL', weeksAhead: 4, groupIds: ['does-not-exist'],
        });

        expect(status).toBe(404);
    });

    it('streams a Group\'s own Sessions, not the creator\'s', async () => {
        // test-session-a is attached DIRECTLY to groupSeminarA (session_group);
        // the fixture's own creator, personA, is also directly attached to
        // it via session_person. A group-scoped link must reach it through
        // the GROUP row alone: `multiA` (personMultiA) creates this link and
        // is attached to no Session at all, so the only way it can show up
        // is the Group match.
        const { status, body } = await createLink(multiCookie, {
            name: 'Seminar feed', scope: 'TERM', termId: f.termA, groupIds: [f.groupSeminarA],
        });

        expect(status).toBe(201);
        expect(body.groupIds).toEqual([f.groupSeminarA]);

        try {
            const res = await api(`/api/ics/stream.ics?token=${tokenOf(body.url)}`);

            expect(res.status).toBe(200);
            expect((res.body as unknown as string)).toContain('SUMMARY:Databases');
        } finally {
            await api(`/api/me/ics-links/${body.id}`, { method: 'DELETE', cookie: multiCookie });
        }
    });

    it('does NOT walk down to a child Group\'s Sessions, only ancestors, same as a member\'s own timetable', async () => {
        // groupCohortA is groupSeminarA's PARENT. test-session-a is assigned
        // to the SEMINAR, not the cohort, so a link scoped to the cohort must
        // miss it: the same "attendance flows down, not up" rule
        // `ownSessionClause`'s own comment states. Getting this backwards
        // would also accidentally leak `multiA`'s creator identity never
        // mattering here, since a DESCENDANT walk would show the seminar's
        // session to anyone targeting the cohort regardless of membership.
        const { status, body } = await createLink(multiCookie, {
            name: 'Cohort feed', scope: 'TERM', termId: f.termA, groupIds: [f.groupCohortA],
        });

        expect(status).toBe(201);

        try {
            const res = await api(`/api/ics/stream.ics?token=${tokenOf(body.url)}`);

            expect(res.status).toBe(200);
            expect((res.body as unknown as string)).not.toContain('Databases');
        } finally {
            await api(`/api/me/ics-links/${body.id}`, { method: 'DELETE', cookie: multiCookie });
        }
    });
});
