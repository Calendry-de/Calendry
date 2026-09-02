/**
 * The MESSAGE LANGUAGE axis (issue #19), deliberately separate from the
 * FORMATTING LOCALE axis that `shared/locale.ts` already owns (issue #17).
 *
 * WHY TWO AXES AND NOT ONE
 *
 * `Person.locale` and `TenantDisplaySettings.defaultLocale` accept ANY valid
 * BCP-47 tag: `isUsableLocale()` validates by round-tripping through
 * `Intl.DateTimeFormat`, so `fr-FR`, `ja-JP` and `pt-BR` are all storable
 * today and all mean something useful, because that value decides DATE AND
 * NUMBER SHAPE ("5 Oct" vs. "Oct 5" vs. "10月5日"). The app is translated
 * into two languages, not into every tag `Intl` accepts.
 *
 * Collapsing the two would mean narrowing what those columns may hold, which
 * is a migration and a regression: a French administrator would lose French
 * dates to gain nothing. So the locale stays whatever the Person said, and
 * the LANGUAGE is derived from it here, by primary subtag. `de-AT` gets German
 * text with Austrian date shape; `fr-FR` gets French date shape with English
 * text. `prisma/schema.prisma`'s own comment on `Person.locale` reserves this
 * split ("never affects what UI text says (issue #19's territory)").
 *
 * WHY THE TWO FALLBACKS DIFFER, AND WHY THAT NEEDS NO SPECIAL CASE
 *
 * "Stated no preference" and "stated a language we do not have" are different
 * facts and deserve different answers: the first is a German-market product's
 * default, the second is better served by English than by German. Both fall
 * out of the existing chain without a branch here, so there is nothing to keep
 * in agreement:
 *
 *   no preference at all -> `resolveLocale()` returns `FALLBACK_LOCALE`
 *                           (`de-DE`) -> `resolveLanguage` -> `de`
 *   `Accept-Language: fr` -> `resolveLocale()` returns `fr-FR`
 *                           -> `resolveLanguage` -> unsupported -> `en`
 */

/**
 * The languages this app is actually translated into.
 *
 * Adding one is a code change, not config: it needs a message tree under
 * `i18n/locales/<lang>/`, a barrel entry, and a translation of every key, or
 * `tests/i18n-catalogue.test.ts` fails. A language declared here with no
 * messages behind it is a promise nothing keeps, the same reasoning
 * `shared/constraintTypes.ts` states for constraint types.
 */
export const APP_LANGUAGES = ['de', 'en'] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

/**
 * What a viewer who expressed no preference gets. Mirrors `FALLBACK_LOCALE`'s
 * primary subtag by construction, asserted by `tests/i18n-catalogue.test.ts`
 * so the two cannot drift into disagreeing about what "default" means.
 */
export const DEFAULT_LANGUAGE: AppLanguage = 'de';

/**
 * What a viewer who asked for a language this app does not have gets. English
 * rather than `DEFAULT_LANGUAGE`, because that viewer has already told us
 * German is not their language.
 */
export const UNSUPPORTED_LANGUAGE_FALLBACK: AppLanguage = 'en';

function isAppLanguage(value: string): value is AppLanguage {
    return (APP_LANGUAGES as readonly string[]).includes(value);
}

/**
 * The message language for a resolved formatting locale.
 *
 * Matches the PRIMARY SUBTAG only, so every regional variant of a translated
 * language resolves to it (`de`, `de-DE`, `de-AT`, `de-CH` -> `de`) rather
 * than needing an entry each. Case-insensitive, since a stored tag is
 * user-entered free text and `DE-de` is a legal spelling of the same tag.
 *
 * Takes the OUTPUT of `resolveLocale()`, never a raw header or column: this
 * function decides nothing about precedence, so there is still exactly one
 * place that knows Person beats Tenant beats header.
 */
export function resolveLanguage(locale: string | null | undefined): AppLanguage {
    const primary = locale?.split('-')[0]?.trim().toLowerCase();

    if (!primary) {
        return DEFAULT_LANGUAGE;
    }

    return isAppLanguage(primary) ? primary : UNSUPPORTED_LANGUAGE_FALLBACK;
}

/**
 * The message language as an Open Graph locale.
 *
 * Open Graph wants `language_TERRITORY` (`de_DE`), not a bare subtag, so a
 * literal `de` is not actually a valid value. The territory is CANONICAL per
 * language rather than taken from the viewer's own tag: an `og:locale`
 * describes the document a crawler or a chat client is unfurling, and that
 * document is written in one of two languages, not in `de-AT`. Mapping
 * `en` to `en_GB` keeps it consistent with this app's own English tier.
 *
 * WHY THIS FOLLOWS THE LANGUAGE AND NOT A LITERAL, which is worth stating
 * because the opposite was argued for during the migration and the argument
 * was reasonable: while extraction has copied English into the German tree,
 * a page reporting `de_DE` announces a language it is not yet fully serving.
 * True, and it is equally true of `<html lang>`, which `useCalendryLayout`
 * already derives. Two mechanisms for one fact, disagreeing for the duration
 * of a migration, is worse than one mechanism briefly ahead of its content:
 * the inconsistency outlives the migration, because nothing reminds anybody
 * to converge them. So both derive, and both become simply correct when the
 * translation pass lands.
 */
export function openGraphLocale(language: AppLanguage): string {
    return language === 'de' ? 'de_DE' : 'en_GB';
}
