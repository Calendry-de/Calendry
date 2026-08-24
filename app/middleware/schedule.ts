import { missingSchedulePermissions } from '~/utils/schedulePermissions';
import { useSession } from '~/composables/session';

/**
 * Guards `/schedule` on every permission its reference wave needs, not just the
 * one its name suggests.
 *
 * WHY IT MUST RUN BEFORE THE PAGE
 *
 * The page's data arrives as one `Promise.all` of five reference fetches, each
 * behind its own read permission. Without this guard a role holding only
 * `session.read` reached the page, one fetch 403'd, the whole wave rejected,
 * and the page rendered NOTHING — indistinguishable from a tenant that has not
 * been set up. Stopping here means the denial is STATED rather than inferred
 * from an empty screen.
 *
 * WHY IT NAMES THE MISSING PERMISSIONS
 *
 * "You do not have access" sends someone to ask for the wrong thing. A tenant
 * admin reading "missing term.read, room.read" can fix it in one step, and the
 * whole reason this page broke is that its real requirements were invisible.
 *
 * Convenience, not enforcement, exactly as the manage middleware notes: every
 * API route re-checks its own permission inside the tenant transaction, so
 * defeating this reaches a page whose every request 403s anyway.
 */
export default defineNuxtRouteMiddleware(() => {
    const session = useSession();
    const missing = missingSchedulePermissions(session.value?.permissions ?? []);

    if (missing.length === 0) {
        return;
    }

    return abortNavigation(createError({
        statusCode: 403,
        statusMessage: 'You do not have permission to view the schedule. '
            + `It also needs: ${missing.join(', ')}.`,
        data: { missing },
    }));
});
