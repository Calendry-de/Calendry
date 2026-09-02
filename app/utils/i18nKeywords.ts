import type { Translate } from '~/composables/i18n';
import type { MessageKey } from '~~/i18n/keys';

/**
 * A searchable entry's synonyms: the translated terms PLUS the English ones.
 *
 * SHARED, and deliberately not in `navPlaces.ts` where it was written.
 * `manageRegistry.ts` needs exactly this merge for its own 96 palette
 * keywords, and two copies of "translated terms plus English aliases,
 * deduped" is the one-implementation-per-operation rule in CLAUDE.md,
 * failing in the way that rule exists to describe: the copies would drift
 * on the dedupe or the delimiter and nothing would report it, because the
 * only symptom is a search that stops finding one section.
 *
 * ADDED TO, NEVER REPLACING (`i18n/CONVENTIONS.md` § "Search keywords").
 * These terms are never rendered; they are what the Ctrl+K fuzzy match runs
 * against, so a purely translated list would break the palette for an admin
 * who learned the product in English, and a purely English one leaves it
 * useless in the product's DEFAULT language, where "Stundenplan" currently
 * finds nothing.
 *
 * ONE comma-separated string rather than one key per term, because the number
 * of useful synonyms differs per language and per entry: a translator adding a
 * sixth German word for "Raum" should not need a schema change, and a message
 * ARRAY would break `MessageKey` (CONVENTIONS forbids it). Commas are safe as
 * the delimiter because a keyword is a word or a short phrase ("right to
 * access", "preferred days"), never a clause.
 *
 * The English aliases stay in CODE rather than being read back out of the
 * English tree with a locale override: `t()` accepts one, but returns the raw
 * key when that tree is not loaded, and a palette that quietly stops matching
 * is exactly the invisible failure this repo keeps writing rules about.
 * Duplicates are dropped case-insensitively, so while every language still
 * carries the English list verbatim this is precisely a no-op.
 */
export function searchKeywords(t: Translate, key: MessageKey, englishAliases: readonly string[]): string[] {
    const translated = t(key).split(',').map((term) => term.trim()).filter(Boolean);
    const seen = new Set<string>();

    return [...translated, ...englishAliases].filter((term) => {
        const folded = term.toLowerCase();

        if (seen.has(folded)) {
            return false;
        }

        seen.add(folded);

        return true;
    });
}
