import type { PermissionRequirement } from '#shared/permissions';

/**
 * The permission each `/my/*` self-service page actually needs, keyed by
 * route path — the ONE place `navigation.ts` (the nav entries' gates) and
 * `middleware/my.ts` (the shared route guard) both read, so the two cannot
 * disagree the way they did until issue #108.
 *
 * WHAT WAS WRONG. `middleware/my.ts` hardcoded `availability.manage_own` for
 * every page carrying `middleware: 'my'` — correct for `/my/availability` and
 * `/my/preferences`, but `/my/exams` needs `exam.request_own` and
 * `/my/teaching-pattern` needs `offering.set_scheduling_pattern`. Their own
 * NAV ENTRIES already named the right key; the shared middleware just never
 * read it, so a lecturer holding exactly `exam.request_own` — the permission
 * their own "My exams" link is gated on — was turned away from `/my/exams`
 * itself with a 403 naming `availability.manage_own`, a permission that page
 * never needed. Confirmed live: an account holding only `exam.request_own`
 * got 403 on `GET /my/exams` before this fix and 200 after it.
 *
 * `/my/account` is deliberately ABSENT: it needs no permission at all (any
 * signed-in Person may set their own locale) and does not carry
 * `middleware: 'my'` for that reason.
 */
export const MY_SECTION_PERMISSIONS: Record<string, PermissionRequirement> = {
    '/my/availability': ['availability.manage_own'],
    '/my/exams': ['exam.request_own'],
    '/my/preferences': ['availability.manage_own'],
    '/my/teaching-pattern': ['offering.set_scheduling_pattern'],
    /**
     * ANY-OF, not a single key (issue #115): `ics_link.generate_own` mints a
     * link over the caller's own schedule, `ics_link.generate` also lets it
     * name Groups. Either is enough to reach the page — the page itself
     * checks `canTargetGroups` (from `GET /api/me/ics-links/context`) to
     * decide whether to offer the group picker.
     */
    '/my/calendar-links': [['ics_link.generate', 'ics_link.generate_own']],
};

/**
 * "May use at least one `/my` section" — the hub's own authority, at `/my`
 * itself and its header link.
 *
 * ANY of the section keys above, not all of them: a lecturer holding only
 * `exam.request_own` must still be able to open the hub and see the one card
 * that applies to them, the same reasoning `SCHEDULE_PERMISSIONS` gives for
 * its own any-of clause. Deduplicated (`availability.manage_own` names two
 * sections) so the denial message below does not repeat a key.
 *
 * `flat(2)`, not `flat()`: `/my/calendar-links` (issue #115) was the first
 * section whose OWN requirement is an any-of (`[['ics_link.generate',
 * 'ics_link.generate_own']]`), one level deeper than every other entry's bare
 * key. A single `.flat()` leaves that inner array intact, and the old
 * `filter((c): c is string => ...)` here would then have silently DROPPED it
 * rather than erroring — exactly the "absorbing a nested array" failure its
 * own comment warned about, just from the reading rather than the writing
 * side. `flat(2)` unwraps both `PermissionRequirement`'s own array and one
 * level of any-of, so every string clause reaches the `Set` regardless of
 * which layer it started in.
 */
const HUB_KEYS = [...new Set(Object.values(MY_SECTION_PERMISSIONS).flat(2))];

export const MY_HUB_PERMISSIONS: PermissionRequirement = [HUB_KEYS];
