import { SCHEDULE_DENIAL, SCHEDULE_PERMISSIONS, canViewSchedule } from '~/utils/schedulePermissions';
import { useSession } from '~/composables/session';

/**
 * Guards `/schedule` on the one thing it needs: either read key.
 *
 * WHAT THIS USED TO DO
 *
 * Demand all six permissions the page's reference wave touched, and name the
 * missing ones, because without that a role holding only `session.read` reached
 * the page, one fetch 403'd, the whole `Promise.all` rejected, and the page
 * rendered NOTHING, indistinguishable from an unconfigured tenant.
 *
 * That failure is gone at its source: the page now draws from
 * `GET /api/schedule/context`, which is behind this same gate, and every
 * directory fetch it makes on top is individually tolerant and only feeds
 * controls that are absent without it. So this middleware is back to asserting
 * exactly what the page's own data requires, which is the state it should
 * always have been in, and is now true by construction rather than by a list
 * being kept in sync.
 *
 * Convenience, not enforcement, exactly as the manage middleware notes: every
 * API route re-checks inside its own tenant transaction.
 */
export default defineNuxtRouteMiddleware(() => {
    const session = useSession();

    if (canViewSchedule(session.value?.permissions ?? [])) {
        return;
    }

    return abortNavigation(createError({
        statusCode: 403,
        statusMessage: SCHEDULE_DENIAL,
        // The shape the page's error branch already reads. Flattened, because a
        // requirement is an AND of ORs and a client that cannot act on the
        // structure should not be handed it.
        data: { missing: SCHEDULE_PERMISSIONS.flat() },
    }));
});
