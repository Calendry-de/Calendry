import type { Composer } from 'vue-i18n';
import type { AppLanguage } from '#shared/language';
import { loadMessages } from '~~/i18n/messages';

/**
 * Makes `lang` the active language, fetching its message chunk first if this
 * page has not already loaded it.
 *
 * The single place that mutates vue-i18n's locale. Both callers, the plugin
 * and `i18n.global.ts`, go through it, because "load the chunk, then switch"
 * written out twice is two chances to switch before the messages land and
 * render a screen of raw keys.
 *
 * Idempotent on both halves: an already-loaded language is not re-fetched
 * (`availableLocales` is vue-i18n's own record of what it holds), and an
 * already-active one is not reassigned, so the middleware can call this on
 * every navigation for the price of two comparisons.
 *
 * TAKES THE `Composer`, NOT THE `I18n` INSTANCE, because vue-i18n's bare
 * `I18n` type is a union across both API modes and its `.global` is therefore
 * `Composer | VueI18n`, on which `locale` is `string | WritableComputedRef`.
 * The plugin runs `legacy: false`, so the composition half is the only one
 * that exists at runtime; naming it here gets the narrow type without a cast
 * asserting something the compiler could not otherwise check.
 *
 * KEPT OUT OF `i18n/messages.ts` ON PURPOSE. That module is imported by the
 * Nitro build in Phase 3, for the shared catalogues, and must stay free of
 * anything that pulls the vue-i18n RUNTIME into server code, which issue #19
 * names as a hazard in its own right. A `type`-only import would be erased,
 * but the function below needs the real instance, so it lives here in `app/`
 * where a client runtime belongs.
 */
export async function applyLanguage(i18n: Composer, lang: AppLanguage): Promise<void> {
    if (!i18n.availableLocales.includes(lang)) {
        i18n.setLocaleMessage(lang, await loadMessages(lang));
    }

    if (i18n.locale.value !== lang) {
        i18n.locale.value = lang;
    }
}
