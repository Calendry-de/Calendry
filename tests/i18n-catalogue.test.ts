import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_LANGUAGES, DEFAULT_LANGUAGE, UNSUPPORTED_LANGUAGE_FALLBACK, resolveLanguage } from '../shared/language';
import { FALLBACK_LOCALE } from '../shared/locale';
import de from '../i18n/locales/de';
import en from '../i18n/locales/en';

/**
 * The message catalogue's structural invariants (issue #19).
 *
 * WHY THESE ARE TESTS AND NOT TYPES. `MessageKey` (`i18n/keys.ts`) is derived
 * from the ENGLISH tree, so TypeScript already refuses a call to a key
 * English does not have. It cannot see the other direction: a key English
 * carries and German does not compiles perfectly and renders a raw
 * `manage.person.label` to every German reader, which is the default
 * language. Nor can it see a namespace file that exists on disk but is
 * missing from a barrel, since the barrel's own type is whatever it happens
 * to import.
 *
 * Both are the failure mode CLAUDE.md names as the worst kind: a page that
 * renders, returns 200, and is wrong. So they are checked here, by reading
 * the DIRECTORY rather than a list of paths, the same technique
 * `tests/helpers/migrations.ts` uses, for the same reason: a guard that can
 * only "correctly find nothing" is not a guard.
 */
const LOCALES_DIR = join(import.meta.dirname, '..', 'i18n', 'locales');

type Tree = Record<string, unknown>;

const TREES: Record<string, Tree> = { de, en };

/** Every dotted leaf path in a message tree, sorted. */
function leafKeys(tree: Tree, prefix = ''): string[] {
    return Object.entries(tree).flatMap(([key, value]) => {
        const path = prefix ? `${ prefix }.${ key }` : key;

        if (typeof value === 'string') {
            return [path];
        }

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return leafKeys(value as Tree, path);
        }

        // Reported rather than skipped: an array or a number in the tree
        // breaks `LeafKeys` in `i18n/keys.ts`, which stops at `string`, so the
        // key would exist at runtime and be uncallable in typed code.
        return [`${ path }  <-- NOT A STRING (${ Array.isArray(value) ? 'array' : typeof value })`];
    }).sort();
}

function namespaceFilesOnDisk(lang: string): string[] {
    return readdirSync(join(LOCALES_DIR, lang))
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.replace(/\.json$/, ''))
        .sort();
}

describe('language and locale defaults agree', () => {
    it('derives DEFAULT_LANGUAGE from FALLBACK_LOCALE, rather than restating it', () => {
        // These are two constants in two files that mean one thing: "what
        // does a viewer with no stated preference get". Nothing stops them
        // being edited apart, and the symptom would be a German-market
        // product serving English to anonymous visitors while every date on
        // the page stayed German.
        expect(resolveLanguage(FALLBACK_LOCALE)).toBe(DEFAULT_LANGUAGE);
    });

    it('falls back to a language that is actually translated', () => {
        expect(APP_LANGUAGES).toContain(DEFAULT_LANGUAGE);
        expect(APP_LANGUAGES).toContain(UNSUPPORTED_LANGUAGE_FALLBACK);
    });

    it('answers "no preference" and "a language we lack" differently', () => {
        // The split issue #19 decided: silence means German (the product's
        // market), while an explicit French preference means English, because
        // that viewer has already said German is not their language.
        expect(resolveLanguage(FALLBACK_LOCALE)).toBe('de');
        expect(resolveLanguage('fr-FR')).toBe(UNSUPPORTED_LANGUAGE_FALLBACK);
    });

    it('matches a language by primary subtag, so regional variants need no entry', () => {
        expect(resolveLanguage('de-AT')).toBe('de');
        expect(resolveLanguage('de-CH')).toBe('de');
        expect(resolveLanguage('en-GB')).toBe('en');
        expect(resolveLanguage('EN-us')).toBe('en');
    });

    it('treats an absent or empty locale as no preference', () => {
        expect(resolveLanguage(null)).toBe(DEFAULT_LANGUAGE);
        expect(resolveLanguage(undefined)).toBe(DEFAULT_LANGUAGE);
        expect(resolveLanguage('')).toBe(DEFAULT_LANGUAGE);
    });
});

describe('every language has every namespace', () => {
    for (const lang of APP_LANGUAGES) {
        it(`${ lang }: every .json on disk is imported by the barrel`, () => {
            // The barrel is hand-written (see its own comment for why it is
            // not a glob), so this is the check that makes forgetting a line
            // loud instead of invisible.
            expect(Object.keys(TREES[lang]!).sort()).toEqual(namespaceFilesOnDisk(lang));
        });
    }

    it('all languages declare the same namespaces', () => {
        expect(namespaceFilesOnDisk('de')).toEqual(namespaceFilesOnDisk('en'));
    });

    it('every declared language has a message tree', () => {
        expect(Object.keys(TREES).sort()).toEqual([...APP_LANGUAGES].sort());
    });
});

describe('every language has every key', () => {
    it('German and English carry an identical key set', () => {
        const enKeys = leafKeys(en as Tree);
        const deKeys = leafKeys(de as Tree);

        // Named rather than counted: a diff of 400 keys is unreadable as
        // "expected 2130, got 1730", and the whole point of this assertion is
        // that it tells the next person which keys to go and write.
        expect({
            missingFromGerman: enKeys.filter((k) => !deKeys.includes(k)),
            missingFromEnglish: deKeys.filter((k) => !enKeys.includes(k)),
        }).toEqual({ missingFromGerman: [], missingFromEnglish: [] });
    });

    it('holds only strings, so every key is reachable from MessageKey', () => {
        expect(leafKeys(en as Tree).filter((k) => k.includes('NOT A STRING'))).toEqual([]);
        expect(leafKeys(de as Tree).filter((k) => k.includes('NOT A STRING'))).toEqual([]);
    });

    it('has no empty message values', () => {
        // An empty string renders as nothing, which looks like a layout bug
        // rather than a missing translation and is the least diagnosable
        // version of this failure.
        const empty = (tree: Tree, lang: string) => leafKeys(tree)
            .filter((key) => key.split('.').reduce<unknown>(
                (node, seg) => (node as Tree | undefined)?.[seg], tree,
            ) === '')
            .map((key) => `${ lang }:${ key }`);

        expect([...empty(en as Tree, 'en'), ...empty(de as Tree, 'de')]).toEqual([]);
    });
});

describe('placeholders survive translation', () => {
    /** `{name}` style placeholders in a vue-i18n message, sorted and deduped. */
    function placeholders(message: string): string[] {
        return [...new Set(message.match(/\{[a-zA-Z][a-zA-Z0-9]*\}/g) ?? [])].sort();
    }

    function messagesOf(tree: Tree): Map<string, string> {
        const out = new Map<string, string>();

        for (const key of leafKeys(tree)) {
            const value = key.split('.').reduce<unknown>((node, seg) => (node as Tree | undefined)?.[seg], tree);

            if (typeof value === 'string') {
                out.set(key, value);
            }
        }

        return out;
    }

    it('German uses exactly the placeholders English declares', () => {
        // A dropped `{count}` renders a sentence with a hole in it; an invented
        // `{persons}` renders the literal braces to the user. Both are silent,
        // and both are the kind of thing a translation pass introduces.
        const enMessages = messagesOf(en as Tree);
        const deMessages = messagesOf(de as Tree);
        const mismatched: Record<string, { en: string[]; de: string[] }> = {};

        for (const [key, enValue] of enMessages) {
            const deValue = deMessages.get(key);

            if (deValue === undefined) {
                continue; // Reported by the key-set test above; not this one's job.
            }

            const expected = placeholders(enValue);
            const actual = placeholders(deValue);

            if (expected.join() !== actual.join()) {
                mismatched[key] = { en: expected, de: actual };
            }
        }

        expect(mismatched).toEqual({});
    });

    it('German keeps the same number of plural forms as English', () => {
        // vue-i18n splits plural forms on `|` inside one message. A German
        // message with fewer forms than its English original silently picks
        // the wrong branch for a count it has no form for.
        const enMessages = messagesOf(en as Tree);
        const deMessages = messagesOf(de as Tree);
        const mismatched: Record<string, { en: number; de: number }> = {};

        for (const [key, enValue] of enMessages) {
            const deValue = deMessages.get(key);

            if (deValue === undefined) {
                continue;
            }

            const enForms = enValue.split('|').length;
            const deForms = deValue.split('|').length;

            if (enForms !== deForms) {
                mismatched[key] = { en: enForms, de: deForms };
            }
        }

        expect(mismatched).toEqual({});
    });
});

describe('the conventions are followed', () => {
    it('declares every namespace listed in CONVENTIONS.md, and no others', () => {
        // The conventions table is prose, and CLAUDE.md's own warning is that
        // prose is checked by nobody. This is the check: a namespace added to
        // the tree without documenting who owns it, or documented without
        // existing, fails here.
        const documented = [...readFileSync(join(LOCALES_DIR, '..', 'CONVENTIONS.md'), 'utf8')
            .matchAll(/^\| `([a-zA-Z]+)` \|/gm)].map((m) => m[1]!).sort();

        expect(documented).toEqual(namespaceFilesOnDisk('en'));
    });
});
