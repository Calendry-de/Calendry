import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { login } from './helpers/client';

/**
 * The one-off `.ics` download — issue #15, deliberately only that half. The
 * subscribe-feed half needs the same link-identity answer `#9` does and is a
 * separate, unbuilt card.
 *
 * REUSES `ownSessionClause`, THE SAME "MINE" `session.read_own` ALREADY USES.
 * Not a second definition — the card is explicit that inventing one is the
 * one thing this must not do. Proven here by attaching a SECOND Session in
 * the same Term to a different Person and asserting it never appears.
 *
 * THE REAL TIMEZONE CONVERSION IS THE POINT. `test-tenant-a`'s timezone is
 * set to Europe/Berlin for this file specifically — the fixture defaults to
 * UTC, which would make a wrong conversion invisible.
 */
let f: Fixtures;
let cookie = '';

beforeAll(async () => {
    f = await seed();
    cookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;

    await ownerDb.tenant.update({ where: { id: f.tenantA }, data: { timezone: 'Europe/Berlin' } });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

async function download(termId: string) {
    const res = await fetch(`${process.env.TEST_BASE_URL ?? 'http://localhost:8080'}/api/me/schedule.ics?termId=${termId}`, {
        headers: { cookie },
    });

    return { status: res.status, headers: res.headers, text: await res.text() };
}

describe('the export', () => {
    it('is a valid, well-formed VCALENDAR', async () => {
        const res = await download(f.termA);

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/calendar');
        expect(res.headers.get('content-disposition')).toContain('attachment');
        expect(res.text).toContain('BEGIN:VCALENDAR');
        expect(res.text).toContain('END:VCALENDAR');
        expect(res.text).toContain('BEGIN:VEVENT');
    });

    it('resolves tenant-local wall clock to the REAL UTC instant', async () => {
        // test-session-a: week 1, Tuesday, block 0 (08:00 local) — 2026-09-29
        // in Europe/Berlin, still CEST (UTC+2) before the late-October
        // transition. A UTC-literal bug would emit 08:00Z instead of 06:00Z.
        const res = await download(f.termA);

        expect(res.text).toContain('DTSTART:20260929T060000Z');
        expect(res.text).toContain('DTEND:20260929T064500Z');
    });

    it('names the Offering as the event title, and the room as its location', async () => {
        const res = await download(f.termA);

        expect(res.text).toContain('SUMMARY:Databases');
        expect(res.text).toContain('LOCATION:Private A');
    });

    it('includes only MY OWN sessions — the same walk session.read_own uses', async () => {
        // A second Session in the same Term, attached to nobody `adminA` is.
        const stranger = await ownerDb.person.create({
            data: { tenantId: f.tenantA, givenName: 'Not', familyName: 'Mine', email: 'notmine@a.test' },
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

        const res = await download(f.termA);

        expect(res.text).toContain('Databases');
        expect(res.text).not.toContain('Somebody else');
    });

    it('is stable across re-exports of the same Session — same UID', async () => {
        const first = await download(f.termA);
        const second = await download(f.termA);

        const uid = /UID:([^\r\n]+)/.exec(first.text)?.[1];

        expect(uid).toBeTruthy();
        expect(second.text).toContain(`UID:${uid}`);
    });
});

describe('the write boundary', () => {
    it('refuses a Term in another tenant', async () => {
        const res = await download(f.termB);

        expect(res.status).toBe(404);
    });

    it('answers 200 for either permission the schedule page itself accepts', async () => {
        // viewerA holds ONLY session.read (not session.read_own) — proves the
        // route is reachable on the broader key too, still scoped to "own".
        const viewer = (await login(ACCOUNTS.viewerA, TEST_PASSWORD)).cookie;
        const r = await fetch(
            `${process.env.TEST_BASE_URL ?? 'http://localhost:8080'}/api/me/schedule.ics?termId=${f.termA}`,
            { headers: { cookie: viewer } },
        );

        expect(r.status).toBe(200);
    });

    it('refuses an account holding NEITHER session.read nor session.read_own', async () => {
        // Ad-hoc email, not in the shared ACCOUNTS map teardown() knows about
        // — cleared explicitly so a run that never reaches its own cleanup
        // (an earlier failure, a mutation-testing pass) cannot leave this
        // account behind for the next run to collide with.
        await ownerDb.$executeRawUnsafe("DELETE FROM account WHERE email = 'noaccess@a.test'");
        await ownerDb.$executeRawUnsafe("DELETE FROM person WHERE email = 'noaccess@a.test'");

        const role = await ownerDb.accessRole.create({
            data: { tenantId: f.tenantA, key: 'no-schedule-access', name: 'No schedule access' },
        });
        const person = await ownerDb.person.create({
            data: { tenantId: f.tenantA, givenName: 'No', familyName: 'Access', email: 'noaccess@a.test' },
        });

        await ownerDb.personAccessRole.create({
            data: { personId: person.id, accessRoleId: role.id, tenantId: f.tenantA },
        });

        const account = await ownerDb.account.create({
            data: { email: 'noaccess@a.test', passwordHash: (await ownerDb.account.findUniqueOrThrow({
                where: { email: ACCOUNTS.adminA },
            })).passwordHash },
        });

        await ownerDb.accountPerson.create({ data: { accountId: account.id, personId: person.id } });

        const blocked = (await login('noaccess@a.test', TEST_PASSWORD)).cookie;
        const r = await fetch(
            `${process.env.TEST_BASE_URL ?? 'http://localhost:8080'}/api/me/schedule.ics?termId=${f.termA}`,
            { headers: { cookie: blocked } },
        );

        expect(r.status).toBe(403);
    });
});
