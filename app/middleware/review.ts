import { useSession } from '~/composables/session';

/**
 * Guards the two proposal routes, `/schedule/proposals` and
 * `/schedule/review/:id`, on the one permission they actually need.
 *
 * WHY NOT THE `schedule` MIDDLEWARE
 *
 * That one demands all six of SCHEDULE_PERMISSIONS, because the week grid
 * genuinely cannot draw without the Term, TimeGrid, Groups, Rooms and People.
 * These two pages are gated on `generation.read` alone, exactly like the API
 * routes behind them: every reference fetch they make is TOLERANT (see the
 * `optional()` helper in `generationReview.ts`), so a caller who may read
 * proposals but not rooms sees ids instead of names rather than an empty screen.
 * Borrowing the six-permission gate would refuse people the data permits.
 *
 * WHY `generation.read` AND NOT `session.read`
 *
 * It was `session.read` until the navigation made the consequence visible:
 * everybody who could look at a timetable was offered "Proposals" and could read
 * every solver run. A Generation is a set of PROPOSED placements, not the
 * applied timetable, so reviewing one is its own authority. `session.read` is
 * deliberately not required on top: demanding authority over the live schedule to
 * read a proposal would make "may review proposals" unexpressible alone.
 *
 * WHY IT EXISTS AT ALL, GIVEN THE PAGE ALSO HANDLES 403
 *
 * It does not replace the page's error branch, it removes the common case from
 * it. Without this, a caller lacking `session.read` reached the review page,
 * the preview fetch 403'd, and the page rendered "This proposal is undefined
 * and is not awaiting a decision.", a permission problem stated as a fact
 * about the proposal. The page now branches on the load error too, because
 * middleware is convenience and a 403 can still arrive (a permission revoked
 * mid-session, a stale client bundle); this makes the denial arrive as a denial
 * on the first visit rather than as a sentence about the data.
 *
 * Convenience, not enforcement: same as the schedule and manage middlewares.
 * Every API route re-checks inside its own tenant transaction.
 */
export default defineNuxtRouteMiddleware(() => {
    // `$t`, not `useT()`: route middleware is not a component setup. See
    // `app/plugins/i18n.ts` for why that is safe with respect to language.
    const { $t } = useNuxtApp();
    const session = useSession();

    if (session.value?.permissions.includes('generation.read')) {
        return;
    }

    return abortNavigation(createError({
        statusCode: 403,
        /*
         * ITS OWN KEY, not shared with `/my`'s or `/schedule`'s denial. The
         * three sentences are near-identical in English and say different
         * things: this one names one permission inline, `/my`'s interpolates
         * whichever keys that page needs, and `/schedule`'s explains the
         * difference between two. Merging them because the English looks
         * similar would erase the distinction in every language at once.
         */
        message: $t('errors.review.denied'),
        data: { missing: ['generation.read'] },
    }));
});
