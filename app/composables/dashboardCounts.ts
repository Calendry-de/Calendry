import type { EntityCount } from '~/utils/institutionCounts';
import { countedEntities } from '~/utils/institutionCounts';
import { useSession } from '~/composables/session';

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
 * WHAT IS DELIBERATELY ABSENT, and it is the honest gap on this surface: the
 * REVIEW QUEUES. `GET /api/generations` returns a bare array with no total and
 * runs a `runSummaryFor` subquery per row; `GET /api/availability/vetoes`
 * returns every person and veto in the tenant. Counting either means pulling
 * the whole payload on every sign-in, and a count taken from a capped list
 * would simply be wrong. "3 proposals waiting" needs a count mode on those
 * routes first; reporting no number beats reporting a wrong one.
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

    return useAsyncData<EntityCount[]>('dashboard:institution-counts', async () => {
        const wanted = countedEntities(new Set(session.value?.permissions ?? []));

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
