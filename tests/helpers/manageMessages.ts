import type { Translate } from '../../app/composables/i18n';
import manage from '../../i18n/locales/en/manage.json';
import common from '../../i18n/locales/en/common.json';

/**
 * A `Translate` resolving REAL ENGLISH SENTENCES from the `manage` namespace,
 * for the suites that assert what the entity registry SAYS.
 *
 * WHY NOT THE `(key) => key` STUB. That stub is right for a suite measuring
 * STRUCTURE (`icon-names`, `institution-counts`, `manage-relation-gates`,
 * `relation-picker-search` all use it), and wrong for the four that measure
 * COPY: `offering-required-rooms` asserts the help text says capacities are
 * ADDED, `offering-required-lecturers` that it names the pool it draws from,
 * `group-curriculum-plan` that it distinguishes intent from an applied plan,
 * and `relation-empty-warning` that the AccessRole warning names no role key
 * and instructs nobody. Every one of those assertions is about a sentence, and
 * against an identity stub each would be checking a key name instead: the
 * wording could then change to anything at all and nothing would report it.
 *
 * Same shape and same reasoning as `tests/helpers/landingMessages.ts`, and
 * deliberately a SECOND, namespace-scoped resolver rather than a widening of
 * that one: a resolver over every tree becomes the place a suite reaches for
 * somebody else's message instead of asserting its own.
 *
 * `common` is loaded alongside `manage` because the registry REUSES its atoms
 * (`common.field.name`, `.code`, `.colour`, `.active`, `.weight`,
 * `.description`, `.timezone`) rather than duplicating eleven one-word
 * messages into this namespace. Without it, building the registry would throw
 * on the first column header.
 */
type MessageNode = string | { [segment: string]: MessageNode };

const TREES: Record<string, MessageNode> = { manage, common };

/**
 * Throws on a key the catalogue does not carry, rather than echoing it back.
 *
 * A resolver that returned the key for a missing message would make an
 * extraction mistake (a key renamed in the JSON but not in
 * `manageRegistry.ts`) look like a field that simply says something else,
 * which is the "correctly found nothing / broken and found nothing" confusion
 * CLAUDE.md warns about.
 *
 * Named placeholders and vue-i18n's `|` plural forms are both handled the way
 * the runtime handles them, so `{max}` with `{ max: 4 }` and a two-form
 * message with a count produce the same sentence here as in the browser. The
 * plural half matters because the registry has such messages (Offering's
 * derived-capacity line), and a resolver ignoring them would hand a test the
 * literal `"… group | … groups"`, which reads like copy nobody proofread.
 */
export const englishT: Translate = (key, ...args) => {
    const path = String(key).split('.');

    let node: MessageNode | undefined = TREES[path[0]!];

    for (const segment of path.slice(1)) {
        node = typeof node === 'object' ? node[segment] : undefined;
    }

    if (typeof node !== 'string') {
        throw new Error(`No English message for "${ String(key) }" in i18n/locales/en/${ path[0] }.json.`);
    }

    // `t(key, plural)` and `t(key, named, plural)`, the two shapes the
    // registry uses; anything else leaves the message as written.
    const named = typeof args[0] === 'object' && args[0] !== null
        ? args[0] as Record<string, unknown>
        : undefined;
    const count = [args[0], args[1]].find((arg) => typeof arg === 'number') as number | undefined;

    let message = node;

    if (message.includes('|')) {
        const forms = message.split('|').map((form) => form.trim());

        // vue-i18n's default rules: two forms are one/other, three are
        // zero/one/other.
        const index = forms.length >= 3
            ? (count === 0 ? 0 : (count === 1 ? 1 : 2))
            : (count === 1 ? 0 : 1);

        message = forms[Math.min(index, forms.length - 1)]!;
    }

    const values = { ...named, ...(count === undefined ? {} : { n: count, count }) };

    return message.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (whole, name: string) => (
        name in values ? String(values[name]) : whole
    ));
};
