import { useSession } from '~/composables/session';

/**
 * Guards the /my self-service routes.
 *
 * Gated on `availability.manage_own` alone, and that is the whole point of the
 * separate section: a lecturer must not need `person.read` — the authority to
 * read the entire staff directory — in order to say they cannot teach on
 * Fridays. Layering this into `/manage/persons/:id` would have required exactly
 * that.
 *
 * A stated denial rather than a redirect. `/manage` redirects a caller who
 * cannot read a section because the navigation already omits it and the honest
 * answer is "that section is not yours"; here there is one destination and
 * silently bouncing somebody off it looks like the feature is broken. Naming
 * the missing permission is what the schedule gate learned to do.
 *
 * Convenience, not enforcement: every route re-checks server-side.
 */
export default defineNuxtRouteMiddleware(() => {
    const session = useSession();
    const held = new Set(session.value?.permissions ?? []);

    if (!held.has('availability.manage_own')) {
        return abortNavigation(createError({
            statusCode: 403,
            statusMessage: 'You do not have permission to manage your own availability '
                + '(availability.manage_own). Ask an administrator to grant it.',
        }));
    }
});
