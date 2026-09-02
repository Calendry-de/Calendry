import type { EntityCount } from '~/utils/institutionCounts';
import { countedEntities } from '~/utils/institutionCounts';
import type { ReviewQueueCount } from '~/utils/reviewQueues';
import { reviewQueues } from '~/utils/reviewQueues';
import { useSession } from '~/composables/session';
import { useT } from '~/composables/i18n';

/**
 * True row counts for the entities that describe an institution's shape.
 *
 * WHY COUNTS AT ALL
 *
 * `/dashboard` used to state nothing. It listed destinations and left every
 * question about the institution to the page you clicked through to, so the
 * home page of a scheduling product could not tell you whether the term had
 * been populated at all.
 *
 * WHERE THE NUMBERS COME FROM
 *
 * `GET /api/{resource}?limit=1`: the generic list route's `{ rows, total }`
 * envelope, which `limit` switches on. CLAUDE.md names that shape switch as a
 * repeat source of bugs, so it was read from the route rather than assumed:
 * `total` counts the whole filtered set, not the one row `limit` returns. So
 * this is six indexed counts, not six list fetches.
 *
 * WHAT IS DELIBERATELY ABSENT HERE: the REVIEW QUEUES, which used to be absent
 * from the page entirely and are now `useReviewQueueCounts()` below. They stay
 * out of THIS function because they are a different kind of fact answered by a
 * different mechanism; see `~/utils/reviewQueues` for why they are not a
 * seventh `COUNTED_KEYS` entry. What this comment used to say, and what issue
 * #125 fixed, is that neither route could be counted at all: `GET
 * /api/generations` returns a bare capped array with no total and runs a
 * `runSummaryFor` subquery per row, and `GET /api/availability/vetoes` returns
 * every person and veto in the tenant. Both now have a `count.get.ts` sibling
 * that answers the number with one aggregate, so the queues can be stated
 * without pulling a payload on every sign-in or reporting a capped list's
 * length as a total.
 *
 * The selection and its gating live in `~/utils/institutionCounts` so a test
 * can reach them. This function is the fetch and nothing else.
 */
export function useInstitutionCounts() {
    /*
     * SYNCHRONOUS, per CLAUDE.md: an `await` in here would detach the
     * composable from the Nuxt instance ("called outside a Vue setup
     * function"). It returns the handle; the page holds the top-level await.
     *
     * `useRequestFetch`, never bare `$fetch`: `$fetch` drops the browser
     * cookie server-side, so every count would 401 during SSR and the strip
     * would render "Unavailable" across a perfectly healthy tenant.
     */
    const request = useRequestFetch();
    const session = useSession();
    /*
     * Resolved at SETUP, not inside the fetch below: `useT()` needs the Vue
     * instance and the callback runs later, detached from it. The registry's
     * own labels come back through it, so the tile and the `/manage` link in
     * the sidebar cannot disagree on what an entity is called.
     */
    const { t } = useT();

    return useAsyncData<EntityCount[]>('dashboard:institution-counts', async () => {
        const wanted = countedEntities(new Set(session.value?.permissions ?? []), t);

        /*
         * `allSettled`, NOT `all`. One 403 or one slow resource inside a
         * `Promise.all` rejects the whole wave, and this page is gated on
         * `dashboard.view` alone, so a caller holding five of these six keys
         * would lose the entire strip rather than one tile. That is exactly the
         * "one missing permission blanks the page" failure CLAUDE.md warns
         * about, and settling per request is what makes each tile independent.
         */
        const settled = await Promise.allSettled(wanted.map((entity) => request<{ rows: unknown[]; total: number }>(
            `/api/${entity.key}`,
            { query: { limit: 1 } },
        )));

        return wanted.map((entity, index) => {
            const result = settled[index];

            return {
                key: entity.key,
                label: entity.plural,
                to: `/manage/${entity.key}`,
                total: result?.status === 'fulfilled' ? result.value.total : null,
            };
        });
    });
}

/**
 * How much is waiting for a decision: `/dashboard`'s review-queue tiles.
 *
 * A SECOND FETCH RATHER THAN MORE ENTRIES IN THE ONE ABOVE, and the split is
 * the point. The strip above answers "what does my institution look like" from
 * six copies of one generic route; this answers "what needs me" from one
 * bespoke count route per queue, each with its own gate. Merging them would
 * have put one `useAsyncData` key over unrelated failure surfaces, so a slow
 * veto count would hold the room count's first render, and the page would have
 * one skeleton for two things that are not the same thing.
 *
 * WHY A DEDICATED COUNT ROUTE EACH. `GET /api/generations` caps at `limit` (max
 * 100) and returns a bare array with no total, so `array.length` is a subset
 * presented as a whole the moment a tenant is busy. `GET
 * /api/availability/vetoes` carries the review page's entire reference wave.
 * `GET /api/exam-requests` carries every row's Offering, kind, room, term and
 * both people, and re-classifies each row's week per Term on the way out. The
 * `count` sibling of each is one indexed aggregate, gated and scoped
 * identically to its list route.
 *
 * `useRequestFetch`, never bare `$fetch`, for the reason above: `$fetch` drops
 * the browser cookie server-side, so every count would 401 during SSR and the
 * tiles would read "Unavailable" on a perfectly healthy tenant. And the page
 * holds the top-level `await`, so first render ships real numbers rather than a
 * skeleton the client replaces, which is also what keeps this out of a watcher
 * Vue would never flush during SSR.
 */
export function useReviewQueueCounts() {
    const request = useRequestFetch();
    const session = useSession();

    return useAsyncData<ReviewQueueCount[]>('dashboard:review-queues', async () => {
        const wanted = reviewQueues(new Set(session.value?.permissions ?? []));

        /*
         * `allSettled`, NOT `all`, the same property the strip above has and
         * for the same reason: this page is gated on `dashboard.view` alone, so
         * a caller holding `generation.read` and neither availability key nor
         * `exam.review` is ordinary. Under `Promise.all` one 403 would reject
         * the wave and blank EVERY tile, and under one shared fetch it would
         * blank the whole page. Settling per request is what makes each tile
         * independent.
         *
         * A rejection lands as `total: null`, which the view draws as the word
         * rather than as 0: a queue that could not be read and a queue with
         * nothing in it are different facts.
         */
        const settled = await Promise.allSettled(
            wanted.map((queue) => request<{ total: number }>(queue.countPath)),
        );

        return wanted.map((queue, index) => {
            const result = settled[index];

            return {
                ...queue,
                total: result?.status === 'fulfilled' ? result.value.total : null,
            };
        });
    });
}
