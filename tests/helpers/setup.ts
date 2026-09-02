/**
 * Suite-wide setup: this suite reads the app in ENGLISH.
 *
 * WHY THIS EXISTS (issue #19)
 *
 * `FALLBACK_LOCALE` is `de-DE`, so a request that states no preference gets
 * German, which is correct for the product and wrong for a test suite whose
 * ~200 copy assertions are English sentences. The suite sends no
 * `Accept-Language` of its own: before i18n there was no reason to, because
 * there was only one language.
 *
 * WHY A GLOBAL `fetch` PATCH RATHER THAN A HEADER ON EVERY CALL
 *
 * There are 51 bare `fetch` calls across 18 files, in a dozen different
 * shapes, plus `helpers/client.ts`'s `api()`. Adding a header to each is 51
 * chances to miss one, and a missed one does not fail loudly: the page comes
 * back in German, the assertion looks for an English sentence, and the message
 * says a page did not render its content, which is the symptom of a blanked
 * page, a dropped fetch and a permissions bug as well. Diagnosing that costs
 * far more than this file.
 *
 * Patching one entry point instead means the guarantee holds for every call
 * site, including ones written later by somebody who has never read this
 * comment, which is the property that actually matters.
 *
 * THE SAME TECHNIQUE THE APP ITSELF USES. `nuxt.config.ts` wraps
 * `window.fetch` to attach the CSRF header to every state-changing
 * same-origin request, for the same reason: so that no existing call site has
 * to change and no future one has to remember. See `shared/csrf.ts`'s comment.
 *
 * FILLS IN, NEVER OVERRIDES. A test that wants to exercise a language
 * explicitly, including the German default, sets its own `accept-language` and
 * that always wins. `tests/i18n-rendering.test.ts` relies on this.
 */
const TEST_LANGUAGE = 'en-GB';

const nativeFetch = globalThis.fetch;

globalThis.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const headers = new Headers(
        init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined),
    );

    if (!headers.has('accept-language')) {
        headers.set('accept-language', TEST_LANGUAGE);

        return nativeFetch(input, { ...init, headers });
    }

    return nativeFetch(input, init);
} as typeof globalThis.fetch;
