import type { ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppLanguage } from '#shared/language';
import { resolveLanguage } from '#shared/language';
import { useViewerLocale } from '~/composables/locale';
import type { MessageKey } from '~~/i18n/keys';

/**
 * A resolved `t`, as a value that can be passed around.
 *
 * WHY THIS TYPE EXISTS RATHER THAN EIGHT COPIES OF IT. Plenty of this app's
 * copy lives in plain `.ts` modules that are NOT components:
 * `app/utils/navPlaces.ts`, `manageRegistry.ts`, `shared/permissions.ts`,
 * `shared/constraintTypes.ts`. `useT()` is illegal there for two independent
 * reasons, and either alone is decisive: it needs Vue's injection context, so
 * it cannot be called from a lazily-evaluated `computed` getter, and several
 * of those modules are imported by unit tests that run in plain Node with no
 * Nuxt instance at all, which is the property their doc comments say they
 * exist to have.
 *
 * So those modules TAKE a translator instead, and this is its type.
 *
 * THREADED INTO THE FUNCTION, NOT ONTO EACH FIELD. The tempting alternative
 * is to make each copy-bearing field a callable (`label: (t) => string`), but
 * that pushes the callable shape outward into every component that reads the
 * field: `NavEntry.label` is read by five surfaces (header menu, sidebar,
 * dashboard cards, command palette, nav rail), and all five would have to
 * learn to call a label instead of rendering a string. Passing `t` into the
 * function that BUILDS the structure keeps every field a plain resolved
 * `string` and confines the change to the few call sites that build it.
 *
 * REQUIRED, NEVER OPTIONAL WITH A FALLBACK. An optional `t` defaulting to
 * identity or to English would let a call site that forgets it keep compiling
 * and render the wrong language, or a raw key, to a user. Required makes that
 * a typecheck error at the call site instead, which is this repo's standing
 * preference: a guard that fails loudly over one that silently finds nothing.
 *
 * In a unit test that only measures structure, stub it as `(key) => key`. No
 * cast is needed, and no message catalogue has to be loaded.
 */
export type Translate = (key: MessageKey, ...args: unknown[]) => string;

/**
 * Translation for a component.
 *
 * The ONE app-facing entry point, wrapping `useI18n()` so that no component
 * imports from `vue-i18n` directly. That indirection is what makes the
 * library replaceable and, more usefully day to day, what lets `t` be typed
 * against the real catalogue: `MessageKey` is the union of every key in the
 * English tree (`i18n/keys.ts`), so a typo, or a key deleted from the JSON
 * while a call site still asks for it, is a `nuxt build` failure rather than
 * a raw `manage.person.label` rendered to a user. This repo's convention is
 * that typecheck should mean something; an untyped `t(string)` would make it
 * mean less here than it does everywhere else.
 *
 * `globalInjection` is off in the plugin, so there is no `$t` in templates.
 * Deliberate: an injected global is untyped and invisible to
 * `noUnusedLocals`, so a component that stops translating anything keeps
 * compiling clean. Destructuring `t` makes the dependency explicit.
 *
 * WHY THIS DOES NOT RE-EXPORT vue-i18n's `n()` AND `d()`
 *
 * They would be subtly wrong here, and wrong in a way that still renders a
 * plausible number. vue-i18n formats against ITS locale, which this app sets
 * to the message LANGUAGE (`de`, `en`), while date and number shape is the
 * viewer's full tag (`de-AT`, `en-GB`, `fr-FR`), a value the message
 * language deliberately discards, see `shared/language.ts`. So `n(1234.5)`
 * through vue-i18n would draw an Austrian reader's number as generic German
 * and a French reader's as English.
 *
 * Formatting therefore stays where issue #17 put it, taking an explicit full
 * locale: `formatDate(iso, locale)` and `formatNumber(value, locale)`
 * (`app/utils/`), fed from `useViewerLocale()`. One rule, one axis each:
 * messages by language, formatting by locale.
 *
 * USAGE
 *
 *   const { t } = useT();
 *   t('common.action.save')
 *   t('manage.person.emptyHint', { entity: name })   // interpolation
 *   t('schedule.session.count', n)                   // plural, see CONVENTIONS.md
 */
export function useT() {
    const { t, te, locale } = useI18n();

    return {
        t: t as Translate,
        /**
         * Whether a key exists. For genuinely optional copy (an entity that
         * may or may not declare a help text), never as a guard wrapped
         * around every call: a missing key is a bug the catalogue test is
         * there to catch, not a condition to render around.
         */
        te: te as (key: MessageKey) => boolean,
        /** The active message language, as vue-i18n holds it. Prefer `useLanguage()`. */
        locale,
    };
}

/**
 * The active message language, and the viewer's full formatting locale.
 *
 * Both, because they answer different questions and a caller usually wants
 * the second: `language` is `de` or `en` and picks the message tree, while
 * `locale` is the whole tag and picks date and number shape.
 */
export function useLanguage(): { language: ComputedRef<AppLanguage>; locale: ComputedRef<string> } {
    const locale = useViewerLocale();

    return {
        language: computed(() => resolveLanguage(locale.value)),
        locale,
    };
}
