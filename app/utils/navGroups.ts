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
    label: string;
    /** Exact `NavEntry.to` values. A path claimed by no group is not rendered. */
    paths: string[];
}

export const NAV_GROUPS: NavGroup[] = [
    { label: 'Schedule', paths: ['/schedule', '/schedule/proposals'] },
    {
        label: 'My settings',
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
    { label: 'People', paths: ['/manage/persons', '/manage/roles', '/manage/availability/preferences'] },
    {
        label: 'Resources',
        paths: ['/manage/rooms', '/manage/equipment', '/manage/groups'],
    },
    {
        label: 'Curriculum',
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
        label: 'Access & review',
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
 */
export function groupNavEntries<T extends { to?: string }>(
    entries: readonly T[],
): { label: string; entries: T[] }[] {
    return NAV_GROUPS
        .map((group) => ({
            label: group.label,
            entries: entries.filter((entry) => entry.to !== undefined && group.paths.includes(entry.to)),
        }))
        .filter((group) => group.entries.length > 0);
}
