import { createI18n } from 'vue-i18n';
import type { AppLanguage } from '#shared/language';
import { UNSUPPORTED_LANGUAGE_FALLBACK, resolveLanguage } from '#shared/language';
import { loadMessages } from '~~/i18n/messages';
import type { Translate } from '~/composables/i18n';
import { applyLanguage } from '~/utils/i18nRuntime';
import { useViewerLocale } from '~/composables/locale';

/**
 * Installs vue-i18n, with the language taken from the locale chain issue #17
 * already built rather than detected again here.
 *
 * WHY NOT `@nuxtjs/i18n`
 *
 * That module brings its own locale detection (cookie, browser, route prefix)
 * and, by default, prefixes every route. Both are wrong for this app, and the
 * second is actively dangerous: `app/middleware/auth.global.ts` decides what
 * needs a session by matching `to.path` against exact strings
 * (`PUBLIC_ROUTES`, `ANONYMOUS_ROUTES`), so a `/de/login` matches neither and
 * an anonymous visitor gets bounced off the sign-in page by the guard meant to
 * let them through. `HOME_ROUTE` (`app/utils/routes.ts`) is likewise
 * documented as the ONLY place "where a signed-in session belongs" is
 * written, and generated locale routes would be a second. Detection is the
 * same objection one layer down: `resolveLocale()` (`shared/locale.ts`) is
 * this app's answer to "which locale", so a module with its own would be a
 * second implementation of a decision that already has one.
 *
 * WHY THE LANGUAGE IS RE-CHECKED IN MIDDLEWARE AND NOT SETTLED HERE
 *
 * Nuxt runs plugins BEFORE route middleware, and the acting Person's own
 * `locale` arrives with the session, which `auth.global.ts` fetches in
 * middleware. So the two sides see different things at this moment, and both
 * are correct:
 *
 *   SSR:    no session yet -> `useViewerLocale()` gives the header locale.
 *   Client: `useState` is restored from the payload before plugins run, so
 *           the session, and its locale, are already here.
 *
 * Rather than fetch the session from this plugin, which would put an API call
 * on `/` and `/pricing` and break the rule that the landing page reads no
 * session and calls no API, the plugin starts from whatever is known now and
 * `app/middleware/i18n.global.ts` guarantees the final language before the
 * first render. Middleware is awaited on both sides, so server and client
 * both finish at the session's language and the markup matches by
 * construction. The cost of the split is one extra in-process message load
 * during SSR when a Person's stored language differs from their browser's;
 * the client pays nothing, because it knew the answer up front.
 */
export default defineNuxtPlugin({
    name: 'calendry-i18n',
    /**
     * Ahead of the default, so `useT()` is usable from any other plugin's
     * setup rather than depending on registration order.
     */
    enforce: 'pre',
    async setup(nuxtApp) {
        const lang = resolveLanguage(useViewerLocale().value);

        const i18n = createI18n({
            // Composition API mode. `legacy: true` would install a global
            // `this.$t` mixin on every component instance, which is both
            // slower to instantiate and untypeable.
            legacy: false,
            globalInjection: false,
            locale: lang,
            fallbackLocale: UNSUPPORTED_LANGUAGE_FALLBACK,
            messages: { [lang]: await loadMessages(lang) },
            // A key with no message is a bug worth seeing in development and
            // worth staying silent about in production, where the string is
            // already on screen and the console noise reaches nobody who can
            // act on it. `tests/i18n-catalogue.test.ts` is what actually
            // prevents it shipping.
            missingWarn: import.meta.dev,
            fallbackWarn: import.meta.dev,
        });

        nuxtApp.vueApp.use(i18n);

        /*
         * Exposed for the two contexts that have no component setup and
         * therefore cannot call `useT()`/`useI18n()`.
         *
         * `$applyLanguage` is for `app/middleware/i18n.global.ts`, which needs
         * the instance and has no other handle on it.
         *
         * `$t` is for ROUTE MIDDLEWARE that has to author a message, which is
         * `manage.ts`, `my.ts`, `review.ts` and `schedule.ts`: each throws
         * `createError({ statusMessage })` and that sentence is read by a
         * person. Safe with respect to language, and the ordering is the
         * reason: those four are NAMED middleware, so Nuxt runs them after
         * every global one, and `i18n.global.ts` has therefore already
         * settled the language before any of them executes.
         *
         * Deliberately NOT a general escape hatch from `useT()`. A component
         * that reaches for `$t` loses the typed `MessageKey` check that
         * `useT()` gives it, so the signature below keeps that check: it is
         * the same `Translate` type, not a loose `(key: string)`.
         */
        return {
            provide: {
                applyLanguage: (next: AppLanguage) => applyLanguage(i18n.global, next),
                t: i18n.global.t as Translate,
            },
        };
    },
});
