import type { Translate } from '../../app/composables/i18n';
import landing from '../../i18n/locales/en/landing.json';

/**
 * A `Translate` that resolves REAL ENGLISH SENTENCES, for the two landing
 * suites that run in plain Node.
 *
 * WHY NOT THE `(key) => key` STUB `i18n/CONVENTIONS.md` RECOMMENDS. That stub
 * is correct for a test measuring STRUCTURE, and wrong for these two, which
 * measure COPY. `tests/landing-page.test.ts` exists to catch the landing page
 * drifting from `app/utils/landingContent.ts`, and it does that by asserting
 * the rendered HTML contains each item's title. Hand that builder an identity
 * stub and the assertion becomes "the page contains the string
 * `landing.built.schedule.title`", which the page never contains, so it would
 * either fail outright or, worse, be softened into checking key names. Either
 * way the drift check is gone: the page could then render any sentence at all.
 *
 * Resolving from `i18n/locales/en/landing.json` keeps the property the suite
 * was written for. The catalogue is now the single source of the page's
 * sentences and `landingContent.ts` the single source of their order, state and
 * grouping, and the suite still asserts the served page matches BOTH,
 * character for character. `tests/helpers/setup.ts` forces
 * `Accept-Language: en-GB` on every request the suite makes, so the page under
 * test really is rendering this file.
 *
 * The one namespace, deliberately: these suites own `landing` and nothing else,
 * and a resolver that loaded every tree would quietly become the place other
 * suites reach for a message instead of asserting their own.
 */
type MessageNode = string | { [segment: string]: MessageNode };

const TREES: Record<string, MessageNode> = { landing };

/**
 * Throws on a key the catalogue does not carry, rather than echoing it back.
 *
 * A resolver that returned the key for a missing message would make an
 * extraction mistake (a key renamed in the JSON but not in
 * `landingContent.ts`) look like a page that failed to render one row, which is
 * the "correctly found nothing / broken and found nothing" confusion CLAUDE.md
 * warns about. Named placeholders are substituted the way vue-i18n does it, so
 * `{max}` in a message and `{ max: 2000 }` at the call site produce the same
 * sentence here as in the browser.
 */
export const englishT: Translate = (key, ...args) => {
    const path = String(key).split('.');

    let node: MessageNode | undefined = TREES[path[0]!];

    for (const segment of path.slice(1)) {
        node = typeof node === 'object' ? node[segment] : undefined;
    }

    if (typeof node !== 'string') {
        throw new Error(`No English message for "${ String(key) }" in i18n/locales/en/landing.json.`);
    }

    const named = args[0];

    if (named === null || typeof named !== 'object') {
        return node;
    }

    const values = named as Record<string, unknown>;

    return node.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (whole, name: string) => (
        name in values ? String(values[name]) : whole
    ));
};
