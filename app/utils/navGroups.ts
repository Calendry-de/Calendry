import type { Translate } from '~/composables/i18n';
import type { MessageKey } from '~~/i18n/keys';

/**
 * How `CommonAppShell`'s sidebar groups the app's destinations under
 * scan-friendly headings.
 *
 * A MODULE rather than a const inside the component, so `tests/nav-groups.test.ts`
 * can import it. That is not a cosmetic move: the sidebar SILENTLY DROPS any
 * destination no group claims (see `navGroups()` in the shell), which is the
 * exact "no data and load failed render identically" failure CLAUDE.md names:
 * a route stays reachable in the header and in Ctrl+K while vanishing from the
 * app's one persistent nav, and nothing says so. `/manage/data-export` shipped
 * in that state. The test is what makes the next one impossible; living in a
 * `.vue` script block is what made the test impossible.
 *
 * Membership is keyed by route path rather than by a `group` field on
 * `NavEntry`: adding one is a bigger change than this grouping warrants, and
 * the test covers what the field would have guaranteed.
 */
export interface NavGroup {
    /**
     * The heading, as a message key rather than a string (issue #19). Only
     * `groupNavEntries()` resolves it, so a caller reading `NAV_GROUPS`
     * directly cannot accidentally render an untranslated heading.
     */
    labelKey: MessageKey;
    /** Exact `NavEntry.to` values. A path claimed by no group is not rendered. */
    paths: string[];
}

export const NAV_GROUPS: NavGroup[] = [
    { labelKey: 'nav.group.schedule', paths: ['/schedule', '/schedule/proposals'] },
    {
        labelKey: 'nav.group.mySettings',
        paths: [
            '/my',
            '/my/availability',
            '/my/exams',
            '/my/preferences',
            '/my/teaching-pattern',
            '/my/calendar-links',
            '/my/account',
        ],
    },
    /*
     * Issue: "put API token creation in its own category". These two are the
     * self-service capabilities that are about DATA AND ACCESS rather than
     * about a person's own schedule, and both were previously panels stacked
     * under the locale form on `/my/account` — reachable only by scrolling a
     * settings page nobody visits for them.
     *
     * A group of its own rather than two more cards in "My settings": the
     * hub's card for `/my/account` reads "Your own display locale", so a
     * reader looking for a token had nothing to aim at.
     */
    {
        labelKey: 'nav.group.accessData',
        paths: ['/my/api-tokens', '/my/data-export'],
    },
    { labelKey: 'nav.group.people', paths: ['/manage/persons', '/manage/roles', '/manage/availability/preferences'] },
    {
        labelKey: 'nav.group.resources',
        paths: ['/manage/rooms', '/manage/equipment', '/manage/groups'],
    },
    {
        labelKey: 'nav.group.curriculum',
        paths: [
            '/manage/time-grids',
            '/manage/session-kinds',
            '/manage/offerings',
            '/manage/offering-templates',
            '/manage/offering-plans',
            '/manage/curriculum-progression',
            '/manage/constraints',
            '/manage/terms',
            '/manage/calendar-periods',
        ],
    },
    {
        labelKey: 'nav.group.accessReview',
        paths: [
            '/manage/accounts',
            '/manage/access-roles',
            '/manage/access-defaults',
            '/manage/display',
            '/manage/exams/reviews',
            '/manage/availability/reviews',
            '/manage/screens',
            '/manage/data-export',
        ],
    },
];

/**
 * Sort a list of destinations into the groups above, dropping empty groups.
 *
 * ONE implementation for two renderings: `CommonAppShell`'s sidebar and
 * `/dashboard`'s overview both call this, so the headings a visitor reads in
 * the nav and the headings they read on the home page cannot disagree. The
 * dashboard previously rendered its destinations as one flat, ungrouped wall
 * while the sidebar beside it grouped the very same routes, which is the same
 * taxonomy expressed twice and worse in the more prominent place.
 *
 * Generic over the entry type: the sidebar passes `ResolvedNavEntry`, and
 * anything with a `to` works. Order comes from `NAV_GROUPS`, never from the
 * caller's list, so both renderings read top to bottom the same way.
 *
 * `t` is a parameter for the reason `Translate` (`~/composables/i18n`) gives:
 * this is a plain module, called from a `computed`, so it cannot call
 * `useT()` itself.
 *
 * RETURNS BOTH `id` AND `label`, and they are not interchangeable. `label` is
 * translated and therefore changes with the reader's language; `id` is the
 * message key, which never does. Anything PERSISTED must use `id`:
 * `useNavGroupCollapse` remembers which topics a reader collapsed, and keying
 * that by the translated label gave one account a separate, silently reset
 * memory per language. `id` is derived from `labelKey` rather than declared
 * beside it, so there are not two identifiers per group to keep in agreement.
 */
export function groupNavEntries<T extends { to?: string }>(
    entries: readonly T[],
    t: Translate,
): { id: string; label: string; entries: T[] }[] {
    return NAV_GROUPS
        .map((group) => ({
            id: group.labelKey,
            label: t(group.labelKey),
            entries: entries.filter((entry) => entry.to !== undefined && group.paths.includes(entry.to)),
        }))
        .filter((group) => group.entries.length > 0);
}
