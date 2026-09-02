import type { Translate } from '../../app/composables/i18n';
import errors from '../../i18n/locales/en/errors.json';

/**
 * A `Translate` resolving REAL ENGLISH SENTENCES from the `errors` namespace,
 * for `tests/schedule-load-failure.test.ts`, which runs in plain Node.
 *
 * WHY NOT THE `(key) => key` STUB `i18n/CONVENTIONS.md` RECOMMENDS. That stub
 * is right for a suite measuring STRUCTURE, and wrong for this one, which
 * measures COPY: the suite asserts a transport failure never blames
 * configuration (no "time grid", no "configured", no "create" in the words
 * shown) and that a 500 reassures the reader their timetable is "intact".
 * Against an identity stub every one of those would be checking a key NAME, so
 * the wording could change to anything at all and nothing would report it,
 * which is exactly the state `describeScheduleFailure` exists to prevent.
 *
 * Same shape and same reasoning as `tests/helpers/landingMessages.ts` and
 * `manageMessages.ts`, and deliberately a THIRD namespace-scoped resolver
 * rather than a widening of either: a resolver over every tree becomes the
 * place a suite reaches for somebody else's message instead of asserting its
 * own.
 */
type MessageNode = string | { [segment: string]: MessageNode };

const TREES: Record<string, MessageNode> = { errors };

/**
 * Throws on a key the catalogue does not carry, rather than echoing it back.
 *
 * A resolver that returned the key for a missing message would make an
 * extraction mistake (a key renamed in the JSON but not in `httpError.ts`)
 * look like a failure state that merely says something else, which is the
 * "correctly found nothing / broken and found nothing" confusion CLAUDE.md
 * warns about.
 */
export const englishT: Translate = (key) => {
    const path = String(key).split('.');

    let node: MessageNode | undefined = TREES[path[0]!];

    for (const segment of path.slice(1)) {
        node = typeof node === 'object' ? node[segment] : undefined;
    }

    if (typeof node !== 'string') {
        throw new Error(`No English message for "${ String(key) }" in i18n/locales/en/errors.json.`);
    }

    return node;
};
