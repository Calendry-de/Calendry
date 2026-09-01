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
 */
const HUB_KEYS = [...new Set(
    Object.values(MY_SECTION_PERMISSIONS)
        .flat()
        // Every clause today is a single string (no section needs an
        // any-of of its own); this filter is the type-narrowing a plain
        // `.flat()` cannot do, and defends the hub clause from silently
        // absorbing a nested array if one is ever added above.
        .filter((clause): clause is string => typeof clause === 'string'),
)];

export const MY_HUB_PERMISSIONS: PermissionRequirement = [HUB_KEYS];
