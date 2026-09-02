import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { login } from './helpers/client';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';

/**
 * i18n reaching the rendered page (issue #19).
 *
 * WHAT THIS FILE IS FOR, and why the catalogue test does not cover it.
 * `tests/i18n-catalogue.test.ts` checks the message trees as data: same keys,
 * same placeholders, same plural forms. It says nothing about whether a
 * request's locale actually selects a tree, which is the half that involves a
 * plugin, a middleware, an ordering dependency between them, and an SSR pass.
 * Every one of those can be wrong while the catalogue is perfect, and the
 * symptom, an English page for a German reader, looks like nothing at all if
 * you are reading in English.
 *
 * So these assertions name GERMAN sentences deliberately: they are the only
 * assertions in this suite that must not be satisfiable by the English tree.
 *
 * WHAT IT CANNOT CHECK. A true hydration mismatch needs a browser: the server
 * markup and the client's first patch have to be compared, and an HTTP test
 * only ever sees the first of those. What is checkable, and checked here, is
 * the SSR half of the invariant: the language is settled BEFORE the first byte
 * of HTML, so `lang` and the copy agree with each other and with the locale
 * the payload carries. A mismatch would need the client to disagree with all
 * three at once, which is the case `app/middleware/i18n.global.ts` is
 * structured to make impossible rather than merely unlikely.
 */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';
const TENANT_A = 'test-tenant-a';
const PERSON_A = 'test-person-a';

/**
 * The HTML minus its comments.
 *
 * Vue's SSR compiler keeps template comments in DEVELOPMENT and strips them in
 * a production build, and `tests/run-integration.sh` runs `nuxt dev`, so this
 * suite always sees them. That matters here because this repo comments its
 * templates heavily, and a comment explaining a `{link}` placeholder contains
 * the literal text `{link}`: an assertion that no placeholder survived
 * rendering would fail on the explanation rather than on the render.
 */
function rendered(html: string): string {
    return html.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * A raw page fetch with an explicit language.
 *
 * `accept-language` is always set here, which matters because
 * `tests/helpers/setup.ts` forces `en-GB` on any request that omits it: this
 * file is the one that must control the header itself, and the setup patch
 * fills in rather than overrides precisely so it can.
 */
async function page(path: string, acceptLanguage: string, cookie?: string) {
    const res = await fetch(`${ BASE }${ path }`, {
        redirect: 'manual',
        headers: {
            'accept-language': acceptLanguage,
            ...(cookie ? { cookie } : {}),
        },
    });

    return { status: res.status, html: await res.text() };
}

describe('an anonymous page renders in the requested language', () => {
    it('serves German copy and declares lang="de" for a German request', async () => {
        const res = await page('/login', 'de-DE');

        expect(res.status).toBe(200);
        // The copy itself, server-rendered. Not a marker class or an element
        // count: those render identically in both languages, so they would
        // pass while the page was entirely English.
        expect(res.html).toContain('Melden Sie sich an, um fortzufahren.');
        // Two more, from an attribute and from a ternary in the template, so
        // this does not pass on one lucky text node: a `placeholder` is the
        // kind of thing that keeps the server's language after a bad
        // hydration, and the submit label is chosen in script rather than
        // markup. Step two's copy ("Anderes Konto verwenden") is deliberately
        // NOT asserted: it lives behind `v-else` on the tenant-selection step,
        // so it is absent from a bare GET for reasons that have nothing to do
        // with language.
        expect(res.html).toContain('placeholder="Passwort"');
        expect(res.html).toContain('Anmelden');
        expect(res.html).toContain('lang="de"');
        // And the English original is genuinely gone, not merely joined.
        expect(res.html).not.toContain('Sign in to continue.');
    });

    it('serves English copy and declares lang="en" for an English request', async () => {
        const res = await page('/login', 'en-GB');

        expect(res.status).toBe(200);
        expect(res.html).toContain('Sign in to continue.');
        expect(res.html).toContain('lang="en"');
        expect(res.html).not.toContain('Melden Sie sich an');
    });

    it('falls back to English for a language it does not translate', async () => {
        // The deliberate asymmetry in `shared/language.ts`: a French speaker
        // gets English rather than the German default, because they have
        // already said German is not their language.
        const res = await page('/login', 'fr-FR');

        expect(res.html).toContain('Sign in to continue.');
        expect(res.html).toContain('lang="en"');
    });

    it('renders German for a regional variant with no tree of its own', async () => {
        // `de-AT` has no message file; `resolveLanguage` matches the primary
        // subtag, so it must not fall through to English.
        const res = await page('/login', 'de-AT');

        expect(res.html).toContain('Melden Sie sich an, um fortzufahren.');
        expect(res.html).toContain('lang="de"');
    });

    it('interpolates a link inside a translated sentence', async () => {
        // The `<i18n-t>` case: the sentence and the anchor are one message
        // with a `{link}` slot, so a broken setup renders either the raw
        // placeholder or an unlinked sentence.
        const res = await page('/login', 'de-DE');

        const html = rendered(res.html);

        expect(html).toContain('Neu bei Calendry?');
        // The anchor has to sit INSIDE the sentence, which is the whole point
        // of `<i18n-t>`: three separate keys would also produce all of these
        // substrings, just in English word order.
        expect(html).toMatch(/Neu bei Calendry\?\s*<a[^>]*href="\/"[^>]*>Was Calendry ist[^<]*<\/a>\s*\./);
        expect(html).not.toContain('{link}');
    });

    it('never leaks an untranslated key to the page', async () => {
        for (const language of ['de-DE', 'en-GB']) {
            const res = await page('/login', language);

            // A missing message renders as its own key. Anchored to this
            // page's namespace rather than a bare dot-scan, so a legitimate
            // sentence containing a full stop cannot match.
            expect(rendered(res.html)).not.toMatch(/auth\.(login|error)\.[a-zA-Z]+/);
        }
    });
});

describe('a signed-in page follows the Person, not the browser', () => {
    beforeAll(async () => {
        await seed();
    });

    afterAll(async () => {
        await teardown();
    });

    afterEach(async () => {
        await ownerDb.person.update({ where: { id: PERSON_A }, data: { locale: null } });
        await ownerDb.tenantDisplaySettings.deleteMany({ where: { tenantId: TENANT_A } });
    });

    it('renders the Person locale language even when the browser asks for another', async () => {
        // THE CASE THE PLUGIN ALONE CANNOT GET RIGHT, and the reason
        // `i18n.global.ts` exists: at plugin time on the server there is no
        // session, so the header (English) is all that is known. Only after
        // `auth.global.ts` has fetched the session does the Person's own
        // German become visible, and it still has to win before the first
        // byte of HTML.
        await ownerDb.person.update({ where: { id: PERSON_A }, data: { locale: 'de-DE' } });

        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await page('/dashboard', 'en-GB', cookie);

        expect(res.status).toBe(200);
        expect(res.html).toContain('lang="de"');
    });

    it('renders the tenant default language when the Person states none', async () => {
        await ownerDb.tenantDisplaySettings.create({
            data: { tenantId: TENANT_A, defaultLocale: 'de-DE' },
        });

        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await page('/dashboard', 'en-GB', cookie);

        expect(res.html).toContain('lang="de"');
    });

    it('lets the browser decide when neither Person nor tenant states a locale', async () => {
        const { cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD);
        const res = await page('/dashboard', 'en-GB', cookie);

        expect(res.html).toContain('lang="en"');
    });
});
