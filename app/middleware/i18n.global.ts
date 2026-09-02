import { resolveLanguage } from '#shared/language';
import { useViewerLocale } from '~/composables/locale';

/**
 * Settles the message language before the first render.
 *
 * RUNS AFTER `auth.global.ts`, and that ordering is load-bearing rather than
 * incidental: Nuxt runs global middleware in filename order, so `auth`
 * precedes `i18n`, which means the session, and with it the acting Person's
 * own `locale`, has been fetched by the time this runs. Renaming either file
 * reorders them and reintroduces exactly the bug this middleware exists to
 * close, so the names are the mechanism.
 *
 * See `app/plugins/i18n.ts` for why the plugin cannot settle this itself
 * (plugins run before middleware, and fetching a session from a plugin would
 * put an API call on the landing page).
 *
 * WHY AN `await` HERE IS SAFE, AND NECESSARY
 *
 * Middleware is awaited before the page renders on BOTH sides, so blocking
 * here delays the first paint by one already-preloaded chunk in the rare
 * mismatch case and guarantees that the server and the client render from the
 * same catalogue. Switching the language after render instead would repaint
 * every string in the app, and on hydration it would be the mismatch class
 * this codebase has been bitten by four times: Vue patches mismatched text
 * but silently refuses to patch mismatched attributes, so a `title` or
 * `aria-label` would keep the language the server chose while the visible
 * text changed to the other one.
 */
export default defineNuxtRouteMiddleware(async () => {
    const { $applyLanguage } = useNuxtApp();

    await $applyLanguage(resolveLanguage(useViewerLocale().value));
});
