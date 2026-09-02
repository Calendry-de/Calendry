import { SCHEDULE_PERMISSIONS, canViewSchedule } from '~/utils/schedulePermissions';
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
    // `$t`, not `useT()`: route middleware is not a component setup. See
    // `app/plugins/i18n.ts` for why that is safe with respect to language.
    const { $t } = useNuxtApp();
    const session = useSession();

    if (canViewSchedule(session.value?.permissions ?? [])) {
        return;
    }

    return abortNavigation(createError({
        statusCode: 403,
        /*
         * NAMES BOTH KEYS, and that is the whole point of the sentence: a
         * tenant admin reading "needs session.read" would grant the entire
         * institution's timetable to somebody who only ever needed their own,
         * the more privileged of the two chosen by an error message.
         *
         * Resolved HERE rather than held as a `const` in
         * `schedulePermissions.ts`, where it used to live: module scope has no
         * language, so a module-level string can only ever be one.
         */
        message: $t('errors.schedule.denied'),
        // The shape the page's error branch already reads. Flattened, because a
        // requirement is an AND of ORs and a client that cannot act on the
        // structure should not be handed it.
        data: { missing: SCHEDULE_PERMISSIONS.flat() },
    }));
});
