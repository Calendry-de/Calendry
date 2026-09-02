import type { MessageTree } from './messages';

/**
 * Every message key that exists, as a dotted string union.
 *
 * Derived from the ENGLISH tree's inferred type rather than declared by hand,
 * so the catalogue and the type cannot disagree: adding a key to a `.json`
 * file makes it callable, and deleting one turns every remaining call site
 * into a typecheck error naming the file and line. Nothing has to be kept in
 * agreement, which is the only version of this that survives 2,500 keys and
 * eight agents editing them.
 *
 * WHY `never` IS THE CORRECT VALUE FOR AN EMPTY TREE, rather than a problem
 * to work around: with no keys extracted yet, every `t()` call fails to
 * compile. That is the desired order of work, extract the string into JSON
 * first and then reference it, and it makes the alternative, referencing a
 * key nobody has written, impossible rather than merely discouraged.
 */
export type MessageKey = LeafKeys<MessageTree>;

/**
 * Dotted paths to the string leaves of a nested object type.
 *
 * Stops at `string` because a message is always a leaf: vue-i18n's plural
 * forms live INSIDE one string, separated by `|`, rather than as a nested
 * object, so there is no case where a branch is also a usable key. An array
 * would break that, which is why `i18n/CONVENTIONS.md` forbids arrays in the
 * message tree: the rule exists to keep this type honest.
 */
type LeafKeys<T, Prefix extends string = ''> = {
    [K in keyof T & string]: T[K] extends string
        ? `${Prefix}${K}`
        : LeafKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];
