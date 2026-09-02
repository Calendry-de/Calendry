import { satisfiesPermissionRequirement } from '#shared/permissions';
import { MY_HUB_PERMISSIONS, MY_SECTION_PERMISSIONS } from '~/utils/mySectionPermissions';
import { useSession } from '~/composables/session';

/**
 * Guards the /my self-service routes: on WHATEVER PERMISSION THAT SPECIFIC
 * PAGE NEEDS (`MY_SECTION_PERMISSIONS`), not one hardcoded key.
 *
 * ISSUE #108: this used to check `availability.manage_own` unconditionally,
 * for every page carrying `middleware: 'my'`. That was correct when only
 * `/my/availability` and `/my/preferences` existed, and silently wrong once
 * `/my/exams` (`exam.request_own`) and `/my/teaching-pattern`
 * (`offering.set_scheduling_pattern`) joined the section: a lecturer holding
 * exactly the permission their OWN page's nav entry names (say,
 * `exam.request_own` and nothing else) was turned away from `/my/exams`
 * with a 403 that named a permission (`availability.manage_own`) the page
 * never actually needed. The route's own API
 * (`GET /api/me/exam-requests`) never required it either; only this shared
 * gate did.
 *
 * `/my` itself (the hub) checks `MY_HUB_PERMISSIONS`: ANY section's key is
 * enough to open it, the same reasoning `SCHEDULE_PERMISSIONS` uses: a
 * lecturer with only one of the four self-service capabilities must still be
 * able to reach the hub and see the one card that applies to them.
 *
 * A path this map does not name (today, only `/my/account`, which needs no
 * permission at all and does not carry this middleware for that reason) is
 * let through: nothing here to check beyond being signed in, which
 * `auth.global.ts` already enforces.
 *
 * A stated denial rather than a redirect. `/manage` redirects a caller who
 * cannot read a section because the navigation already omits it and the honest
 * answer is "that section is not yours"; here there is one destination and
 * silently bouncing somebody off it looks like the feature is broken. Naming
 * the missing permission is what the schedule gate learned to do.
 *
 * Convenience, not enforcement: every route re-checks server-side.
 */
export default defineNuxtRouteMiddleware((to) => {
    const session = useSession();
    const held = new Set(session.value?.permissions ?? []);

    const requirement = to.path === '/my' ? MY_HUB_PERMISSIONS : MY_SECTION_PERMISSIONS[to.path];

    // Not a path this guard has an opinion about (`/my/account`, or any future
    // page that genuinely needs nothing beyond a session).
    if (!requirement) {
        return;
    }

    if (satisfiesPermissionRequirement(held, requirement)) {
        return;
    }

    const missing = [...new Set(requirement.flat())];

    return abortNavigation(createError({
        statusCode: 403,
        statusMessage: `You do not have permission to use this page. It needs ${missing.join(' or ')}. `
            + 'Ask an administrator to grant it.',
    }));
});
