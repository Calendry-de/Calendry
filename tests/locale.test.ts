import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { formatDate } from '../app/utils/formatDate';
import { isUsableLocale, parseAcceptLanguage, resolveLocale } from '../shared/locale';
import { api, login } from './helpers/client';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';

/**
 * Locale resolution (issue #17): Person.locale > TenantDisplaySettings.
 * defaultLocale > Accept-Language, extending `useViewerLocale`'s existing
 * header-only mechanism rather than replacing it: see shared/locale.ts's
 * own doc comment for why `parseAcceptLanguage` lives there unchanged from
 * `app/composables/locale.ts`'s original.
 */
describe('resolveLocale precedence', () => {
    it('prefers the Person locale over everything else', () => {
        expect(resolveLocale({
            personLocale: 'de-DE', tenantDefaultLocale: 'fr-FR', acceptLanguage: 'ja-JP',
        })).toBe('de-DE');
    });

    it('falls back to the tenant default when no Person locale is set', () => {
        expect(resolveLocale({ tenantDefaultLocale: 'fr-FR', acceptLanguage: 'ja-JP' })).toBe('fr-FR');
    });

    it('falls back to Accept-Language when neither is set', () => {
        expect(resolveLocale({ acceptLanguage: 'ja-JP,en;q=0.8' })).toBe('ja-JP');
    });

    it('falls back to the hardcoded floor when nothing resolves', () => {
        // `de-DE` since issue #19, not `en-GB`: this value now also decides
        // the UI LANGUAGE (via `resolveLanguage`), so it is the product's
        // answer to "no preference stated" rather than a neutral formatting
        // default. `tests/i18n-catalogue.test.ts` asserts it stays in step
        // with `DEFAULT_LANGUAGE`.
        expect(resolveLocale({})).toBe('de-DE');
    });

    it('skips an unusable stored value rather than throwing', () => {
        expect(resolveLocale({ personLocale: 'not a locale!!', acceptLanguage: 'de-DE' })).toBe('de-DE');
    });
});

describe('isUsableLocale / parseAcceptLanguage', () => {
    it('accepts real tags and rejects garbage', () => {
        expect(isUsableLocale('de-DE')).toBe(true);
        expect(isUsableLocale('not a locale!!')).toBe(false);
        expect(isUsableLocale(null)).toBe(false);
    });

    it('takes the first tag of Accept-Language', () => {
        expect(parseAcceptLanguage('de-DE,de;q=0.9,en;q=0.8')).toBe('de-DE');
    });
});

describe('formatDate with an explicit locale', () => {
    it('writes the same instant differently per locale', () => {
        expect(formatDate('2027-09-27T00:00:00Z', 'en-US')).toMatch(/Sep/);
        expect(formatDate('2027-09-27T00:00:00Z', 'de-DE')).toMatch(/Sept/);
    });

    it('reads UTC, not the runtime zone', () => {
        expect(formatDate('2027-09-27T00:00:00Z', 'en-GB')).toContain('27');
    });

    it('reports an unparseable date without throwing', () => {
        expect(formatDate('not a date', 'en-GB')).toBe('date unknown');
    });
});

const TENANT_A = 'test-tenant-a';
const PERSON_A = 'test-person-a';

describe('GET /api/auth/session resolves the tiered locale', () => {
    afterEach(async () => {
        await ownerDb.person.update({ where: { id: PERSON_A }, data: { locale: null } });
        await ownerDb.tenantDisplaySettings.deleteMany({ where: { tenantId: TENANT_A } });
    });

    it('uses Accept-Language when nothing is configured', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api('/api/auth/session', {
            cookie, headers: { 'accept-language': 'ja-JP,en;q=0.8' },
        });

        expect(res.body.locale).toBe('ja-JP');
    });

    it('prefers the tenant default over Accept-Language', async () => {
        await ownerDb.tenantDisplaySettings.create({
            data: { tenantId: TENANT_A, defaultLocale: 'fr-FR' },
        });

        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api('/api/auth/session', {
            cookie, headers: { 'accept-language': 'ja-JP' },
        });

        expect(res.body.locale).toBe('fr-FR');
    });

    it('prefers the Person locale over the tenant default', async () => {
        await ownerDb.tenantDisplaySettings.create({
            data: { tenantId: TENANT_A, defaultLocale: 'fr-FR' },
        });
        await ownerDb.person.update({ where: { id: PERSON_A }, data: { locale: 'de-DE' } });

        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api('/api/auth/session', { cookie });

        expect(res.body.locale).toBe('de-DE');
    });
});

describe('GET/PUT /api/me/settings', () => {
    afterEach(async () => {
        await ownerDb.person.update({ where: { id: PERSON_A }, data: { locale: null, timezone: null } });
    });

    it('round-trips a Person locale', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);

        expect((await api('/api/me/settings', { cookie })).body).toEqual({ locale: null, timezone: null });

        const put = await api('/api/me/settings', {
            method: 'PUT', cookie, body: JSON.stringify({ locale: 'de-DE' }),
        });

        expect(put.status).toBe(200);
        expect(put.body.locale).toBe('de-DE');
        // `timezone` was not sent, so the PUT leaves it untouched, still null.
        expect((await api('/api/me/settings', { cookie })).body).toEqual({ locale: 'de-DE', timezone: null });
    });

    it('refuses an unrecognised locale', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api('/api/me/settings', {
            method: 'PUT', cookie, body: JSON.stringify({ locale: 'not a locale!!' }),
        });

        expect(res.status).toBe(400);
    });

    it('clears the setting when locale is null', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        await api('/api/me/settings', { method: 'PUT', cookie, body: JSON.stringify({ locale: 'de-DE' }) });

        const cleared = await api('/api/me/settings', {
            method: 'PUT', cookie, body: JSON.stringify({ locale: null }),
        });

        expect(cleared.body.locale).toBeNull();
    });

    it('round-trips a Person timezone, independent of locale', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);

        const put = await api('/api/me/settings', {
            method: 'PUT', cookie, body: JSON.stringify({ locale: null, timezone: 'Europe/Berlin' }),
        });

        expect(put.status).toBe(200);
        expect(put.body).toEqual({ locale: null, timezone: 'Europe/Berlin' });

        const get = await api('/api/me/settings', { cookie });

        expect(get.body).toEqual({ locale: null, timezone: 'Europe/Berlin' });
    });

    it('leaves timezone untouched when the PUT omits it', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        await api('/api/me/settings', { method: 'PUT', cookie, body: JSON.stringify({ locale: null, timezone: 'Europe/Berlin' }) });

        const put = await api('/api/me/settings', { method: 'PUT', cookie, body: JSON.stringify({ locale: 'de-DE' }) });

        expect(put.body).toEqual({ locale: 'de-DE', timezone: 'Europe/Berlin' });
    });

    it('refuses an unrecognised timezone', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api('/api/me/settings', {
            method: 'PUT', cookie, body: JSON.stringify({ locale: null, timezone: 'Not/AZone' }),
        });

        expect(res.status).toBe(400);
    });
});

describe('PUT /api/display-settings defaultLocale', () => {
    afterEach(async () => {
        await ownerDb.tenantDisplaySettings.deleteMany({ where: { tenantId: TENANT_A } });
    });

    it('round-trips the tenant default', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const put = await api('/api/display-settings', {
            method: 'PUT', cookie, body: JSON.stringify({ defaultLocale: 'de-DE' }),
        });

        expect(put.status).toBe(200);
        expect(put.body.defaultLocale).toBe('de-DE');

        const get = await api('/api/display-settings', { cookie });

        expect(get.body.defaultLocale).toBe('de-DE');
    });

    it('refuses an unrecognised locale', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api('/api/display-settings', {
            method: 'PUT', cookie, body: JSON.stringify({ defaultLocale: 'not a locale!!' }),
        });

        expect(res.status).toBe(400);
    });
});

describe('PUT /api/display-settings timezone', () => {
    afterEach(async () => {
        await ownerDb.tenant.update({ where: { id: TENANT_A }, data: { timezone: 'Europe/Berlin' } });
        await ownerDb.tenantDisplaySettings.deleteMany({ where: { tenantId: TENANT_A } });
    });

    it('defaults to the tenant\'s current value (Europe/Berlin, this fixture\'s seed)', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const get = await api('/api/display-settings', { cookie });

        expect(get.body.timezone).toBe('Europe/Berlin');
    });

    it('writes `tenant.timezone` directly, not the display-settings singleton', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const put = await api('/api/display-settings', {
            method: 'PUT', cookie, body: JSON.stringify({ timezone: 'America/New_York' }),
        });

        expect(put.status).toBe(200);
        expect(put.body.timezone).toBe('America/New_York');

        const row = await ownerDb.tenant.findUniqueOrThrow({ where: { id: TENANT_A } });

        expect(row.timezone).toBe('America/New_York');

        // Never touches the display-settings singleton, which this fixture's
        // seed leaves absent, so a write scoped to `tenant` alone must not
        // create it as a side effect.
        expect(await ownerDb.tenantDisplaySettings.findUnique({ where: { tenantId: TENANT_A } })).toBeNull();
    });

    it('leaves the tenant timezone untouched when the PUT omits it', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const put = await api('/api/display-settings', {
            method: 'PUT', cookie, body: JSON.stringify({ defaultColor: '#112233' }),
        });

        expect(put.status).toBe(200);
        expect(put.body.timezone).toBe('Europe/Berlin');
    });

    it('refuses an unrecognised timezone', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await api('/api/display-settings', {
            method: 'PUT', cookie, body: JSON.stringify({ timezone: 'Not/AZone' }),
        });

        expect(res.status).toBe(400);
    });

    it('refuses a caller without tenant.update', async () => {
        const { cookie } = await login(ACCOUNTS.viewerA, TEST_PASSWORD);
        const res = await api('/api/display-settings', {
            method: 'PUT', cookie, body: JSON.stringify({ timezone: 'America/New_York' }),
        });

        expect(res.status).toBe(403);
    });
});

beforeAll(async () => {
    await seed();
}, 60_000);

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});
