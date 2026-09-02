import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Fixtures, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';
import { migrationStatements } from './helpers/migrations';

/**
 * `PATCH /api/staff/tenants/:id/locale`: a Tenant's default locale, set from
 * the staff panel.
 *
 * `tenant_display_settings` is tenant-scoped and carries
 * `ENABLE`/`FORCE ROW LEVEL SECURITY`, and a staff session is never IN a
 * tenant (CLAUDE.md's fourth tenant-isolation exception — `StaffIdentity`
 * cannot even be passed to `withTenant()`), so the write goes through
 * `calendry_internal.staff_set_tenant_locale()`, a narrow SECURITY DEFINER
 * function on the ORDINARY `calendry_app` connection. Same technique as
 * `staff_create_tenant()` (#105), `staff_set_tenant_federation()` (#64) and
 * `staff_erase_tenant()` (#84); NOT a new owner-connection write, which
 * issue #105 deliberately moved away from.
 *
 * WHAT IS WORTH PINNING HERE, beyond "the column saves":
 *
 *   1. The UPSERT. A tenant that has never opened the display page has NO
 *      settings row at all (absent row = defaults), so a staff write has to
 *      create it. That is the case the tenant-side `PUT /api/display-settings`
 *      never has to think about, because it always runs inside the tenant.
 *   2. Clearing on a tenant with no row creates NOTHING. `null` and an absent
 *      row say the same thing, and inserting one would flip the singleton
 *      into existence with every other display setting stamped at its
 *      default.
 *   3. Absent-vs-null. An omitted key is REFUSED, never read as "clear", the
 *      precedent `[id].patch.ts`'s `federationId` set.
 *   4. That the value actually REACHES `resolveLocale()`. A staff-set default
 *      that no Person's session ever resolves to would be a setting that
 *      saves and does nothing, exactly the failure shape this codebase keeps
 *      writing rules about.
 */
const STAFF_EMAIL = 'tenant-locale-staff@calendry.test';
const TENANT_A = 'test-tenant-a';
const PERSON_A = 'test-person-a';

let f: Fixtures;
let staffCookie = '';
let tenantCookie = '';

function staffCookieFrom(setCookie: string | null): string {
    const match = setCookie?.match(/(?:^|;\s*|,\s*)calendry_staff_session=([^;,]*)/);

    if (!match) {
        throw new Error(`Expected a calendry_staff_session cookie but got: ${setCookie}`);
    }

    return `calendry_staff_session=${match[1]}`;
}

async function seedStaffAccount() {
    await ownerDb.$executeRawUnsafe(`DELETE FROM staff_account WHERE email = '${STAFF_EMAIL}'`);

    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });

    await ownerDb.staffAccount.create({
        data: { email: STAFF_EMAIL, passwordHash: template.passwordHash, mustChangePassword: false },
    });
}

beforeAll(async () => {
    f = await seed();
    await seedStaffAccount();

    // The fixture leaves both null; asserted rather than assumed, because the
    // precedence test below is only meaningful if the Person has no locale of
    // its own and the tenant has no settings row yet.
    await ownerDb.person.update({ where: { id: PERSON_A }, data: { locale: null } });
    await ownerDb.tenantDisplaySettings.deleteMany({ where: { tenantId: TENANT_A } });

    tenantCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;

    const staffLogin = await api('/api/staff-auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: STAFF_EMAIL, password: TEST_PASSWORD }),
    });

    if (staffLogin.status !== 200) {
        throw new Error(`Staff login failed: ${staffLogin.status} ${JSON.stringify(staffLogin.body)}`);
    }

    staffCookie = staffCookieFrom(staffLogin.setCookie);
}, 60_000);

afterAll(async () => {
    await ownerDb.$executeRawUnsafe(`DELETE FROM staff_account WHERE email = '${STAFF_EMAIL}'`);
    await ownerDb.tenantDisplaySettings.deleteMany({ where: { tenantId: TENANT_A } });
    await ownerDb.person.update({ where: { id: PERSON_A }, data: { locale: null } });
    await teardown();
    await ownerDb.$disconnect();
});

interface SetLocaleResult {
    tenantId: string;
    tenantSlug: string;
    defaultLocale: string | null;
    configured: boolean;
}

function patchLocale(tenantId: string, body: unknown, cookie = staffCookie) {
    return api<SetLocaleResult & { message?: string }>(`/api/staff/tenants/${tenantId}/locale`, {
        method: 'PATCH',
        cookie,
        body: JSON.stringify(body),
    });
}

describe('the SQL function is in the migration history', () => {
    it('declares staff_set_tenant_locale and grants it to the runtime role only', () => {
        // Reads the migrations DIRECTORY (helpers/migrations.ts), never a
        // path: the history is squashed periodically. `migrationStatements()`
        // strips `--` comments, so these match real SQL rather than the
        // migration's own prose about it.
        const sql = migrationStatements();

        expect(sql).toContain('CREATE OR REPLACE FUNCTION calendry_internal.staff_set_tenant_locale(');
        expect(sql).toContain('GRANT EXECUTE ON FUNCTION calendry_internal.staff_set_tenant_locale(text, text) TO calendry_app;');
        expect(sql).toContain('REVOKE ALL ON FUNCTION calendry_internal.staff_set_tenant_locale(text, text) FROM PUBLIC;');
    });
});

describe('who may write it', () => {
    it('refuses a tenant Account session: staff only', async () => {
        const res = await patchLocale(f.tenantA, { defaultLocale: 'fr-FR' }, tenantCookie);

        expect(res.status).toBe(403);
    });

    it('refuses a request with no session at all', async () => {
        const res = await api(`/api/staff/tenants/${f.tenantA}/locale`, {
            method: 'PATCH',
            body: JSON.stringify({ defaultLocale: 'fr-FR' }),
        });

        expect(res.status).toBe(403);
    });

    it('404s an unknown tenant id, naming it in `message`', async () => {
        const res = await patchLocale('does-not-exist', { defaultLocale: 'fr-FR' });

        expect(res.status).toBe(404);
        // `message`, never `statusMessage`: h3 emits the latter into the
        // status LINE and sanitises it (i18n/CONVENTIONS.md).
        expect(res.body.message).toBe('Tenant not found.');
    });
});

describe('the body contract', () => {
    it('refuses an unrecognised tag rather than storing one that only degrades', async () => {
        const res = await patchLocale(f.tenantA, { defaultLocale: 'not a locale!!' });

        expect(res.status).toBe(400);
        expect(await ownerDb.tenantDisplaySettings.findUnique({ where: { tenantId: TENANT_A } })).toBeNull();
    });

    it('refuses the empty string, which is not the same as null', async () => {
        const res = await patchLocale(f.tenantA, { defaultLocale: '' });

        expect(res.status).toBe(400);
    });

    it('refuses an OMITTED key rather than treating it as a clear', async () => {
        const res = await patchLocale(f.tenantA, {});

        expect(res.status).toBe(400);
    });

    it('clearing a default that was never set inserts no settings row', async () => {
        const res = await patchLocale(f.tenantA, { defaultLocale: null });

        expect(res.status).toBe(200);
        expect(res.body.defaultLocale).toBeNull();
        // The distinguishing fact: nothing was created to record "no
        // default", because an absent row already says exactly that.
        expect(res.body.configured).toBe(false);
        expect(await ownerDb.tenantDisplaySettings.findUnique({ where: { tenantId: TENANT_A } })).toBeNull();
    });
});

describe('setting and clearing', () => {
    it('UPSERTS the singleton for a tenant that has never configured display settings', async () => {
        const res = await patchLocale(f.tenantA, { defaultLocale: 'fr-FR' });

        expect(res.status).toBe(200);
        expect(res.body.tenantId).toBe(f.tenantA);
        expect(res.body.defaultLocale).toBe('fr-FR');
        expect(res.body.configured).toBe(true);

        const row = await ownerDb.tenantDisplaySettings.findUnique({ where: { tenantId: TENANT_A } });

        expect(row?.defaultLocale).toBe('fr-FR');
        // Created with the column's own defaults, not nulled out by the
        // partial write.
        expect(row?.highlightOnline).toBe(true);
    });

    it('shows the stored value on GET /api/staff/tenants, flattened to defaultLocale', async () => {
        const res = await api<{ rows: { id: string; defaultLocale: string | null }[] }>(
            '/api/staff/tenants',
            { cookie: staffCookie },
        );

        expect(res.status).toBe(200);
        expect(res.body.rows.find((row) => row.id === f.tenantA)?.defaultLocale).toBe('fr-FR');
    });

    it('reaches resolveLocale: a Person with no locale of their own now resolves to it', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api<{ locale: string }>('/api/auth/session', {
            cookie,
            headers: { 'accept-language': 'ja-JP' },
        });

        // Tenant default beats Accept-Language, the middle tier of
        // `resolveLocale()`'s three sources.
        expect(res.body.locale).toBe('fr-FR');
    });

    it('is overridden by the Person\'s own locale, which the tenant default never displaces', async () => {
        await ownerDb.person.update({ where: { id: PERSON_A }, data: { locale: 'de-DE' } });

        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api<{ locale: string }>('/api/auth/session', { cookie });

        expect(res.body.locale).toBe('de-DE');

        await ownerDb.person.update({ where: { id: PERSON_A }, data: { locale: null } });
    });

    it('overwrites an existing default rather than adding a second row', async () => {
        const res = await patchLocale(f.tenantA, { defaultLocale: 'ja-JP' });

        expect(res.status).toBe(200);
        expect(res.body.defaultLocale).toBe('ja-JP');
        expect(await ownerDb.tenantDisplaySettings.count({ where: { tenantId: TENANT_A } })).toBe(1);
    });

    it('clears the default with null, keeping the row it already had', async () => {
        const res = await patchLocale(f.tenantA, { defaultLocale: null });

        expect(res.status).toBe(200);
        expect(res.body.defaultLocale).toBeNull();
        // The row still exists: this tenant HAS configured display settings,
        // it simply states no locale, so `configured` stays true.
        expect(res.body.configured).toBe(true);

        const row = await ownerDb.tenantDisplaySettings.findUnique({ where: { tenantId: TENANT_A } });

        expect(row).not.toBeNull();
        expect(row?.defaultLocale).toBeNull();
    });

    it('falls back to Accept-Language once the default is cleared', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api<{ locale: string }>('/api/auth/session', {
            cookie,
            headers: { 'accept-language': 'ja-JP' },
        });

        expect(res.body.locale).toBe('ja-JP');
    });
});
