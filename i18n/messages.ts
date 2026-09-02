import type { AppLanguage } from '#shared/language';

/**
 * Loads one language's messages, as one chunk.
 *
 * WHY TWO LITERAL `import()` CALLS AND NOT A COMPUTED PATH
 *
 * `import(`./locales/${lang}`)` would work at runtime and is worse: a
 * computed specifier makes the bundler emit a chunk for every directory that
 * could match, and gives up on tree-shaking what it cannot see. Two literal
 * specifiers give exactly two chunks, each containing one language's 18
 * namespaces merged, and the switch below is the only thing that decides
 * which one is fetched. A viewer therefore downloads German or English,
 * never both.
 *
 * WHY A CHUNK AND NOT THE SSR PAYLOAD
 *
 * The obvious alternative is to resolve messages on the server and serialise
 * them into the payload via `useState`, the way `useViewerLocale()` carries
 * the locale itself. That is right for a single string and wrong for a
 * catalogue: the payload is inlined into every HTML response and is never
 * cached, so each navigation would re-ship the whole message tree. A chunk is
 * fetched once and then served from the browser cache for the rest of the
 * session and the next one, and Nuxt emits a `modulepreload` for it, so it
 * downloads in parallel with the main bundle rather than after it.
 *
 * The plugin `await`s this before Vue mounts, which is what makes the chunk
 * safe: hydration cannot begin with a half-populated catalogue, so there is no
 * window in which the client renders a key where the server rendered a
 * sentence. That is the same hydration hazard `app/utils/formatDate.ts` and
 * `app/composables/locale.ts` are both written around, one layer up.
 */
export async function loadMessages(lang: AppLanguage) {
    if (lang === 'de') {
        return (await import('./locales/de')).default;
    }

    return (await import('./locales/en')).default;
}

/**
 * The shape of a complete message tree, taken from the English barrel.
 *
 * ENGLISH IS THE STRUCTURAL SOURCE even though German is the default
 * language, and the two roles are deliberately separate. `DEFAULT_LANGUAGE`
 * answers "what does a viewer with no preference see"; this answers "what
 * counts as the full set of keys". Typing it from one of them rather than
 * from a union means a key present in German and missing from English is a
 * typecheck failure at its call site, not a silent `de`-only string that
 * renders as a raw key for every English reader.
 *
 * `tests/i18n-catalogue.test.ts` asserts the reverse direction, which types
 * cannot: that German has every key English does, with nothing left in
 * English by an unfinished translation.
 */
export type MessageTree = typeof import('./locales/en')['default'];
