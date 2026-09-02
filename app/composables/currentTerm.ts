import type { CurrentTermResponse, TermContext } from '~/utils/currentTerm';
import { mayReadCurrentTerm, termContext } from '~/utils/currentTerm';
import { useSession } from '~/composables/session';

/**
 * Which term `/dashboard`'s numbers are about, and which week of it today is.
 *
 * A THIRD HANDLE beside `useInstitutionCounts()` and `useReviewQueueCounts()`,
 * for the reason those two are separate from each other: this is a different
 * kind of fact (a calendar position, not a count), from a different route, with
 * a different gate, and folding it into either would put one `useAsyncData` key
 * over unrelated failure surfaces. A term that could not be read must not blank
 * a room count.
 *
 * SYNCHRONOUS, per CLAUDE.md: an `await` in here would detach the composable
 * from the Nuxt instance ("called outside a Vue setup function"). It returns the
 * handle; the page holds the top-level await, which is also what makes the
 * header line arrive with the first render rather than through a watcher Vue
 * would never flush during SSR.
 *
 * `useRequestFetch`, never bare `$fetch`: `$fetch` drops the browser cookie
 * server-side, so the request would 401 during SSR and a perfectly healthy
 * tenant's header would read "could not be read".
 *
 * RESOLVES TO `null` WHEN THE CALLER MAY NOT ASK, which the view draws as no
 * line at all. That is not the same as the `unavailable` state: see
 * `~/utils/currentTerm`, where the four cases and why they must stay apart are
 * written down.
 */
export function useCurrentTerm() {
    const request = useRequestFetch();
    const session = useSession();

    return useAsyncData<TermContext | null>('dashboard:current-term', async () => {
        if (!mayReadCurrentTerm(new Set(session.value?.permissions ?? []))) {
            return null;
        }

        /*
         * CAUGHT, not left to reject. `useAsyncData`'s own `error` would be
         * the other way to carry this, but the view has four states and only
         * one of them is an error, so mapping the failure into the same
         * `TermContext` union keeps the whole decision in one value the
         * template can switch on. The distinction that matters is preserved:
         * a failed request is `unavailable`, and a tenant with no Term is
         * `none`, which the route answers with `{ term: null }`.
         */
        try {
            return termContext(await request<CurrentTermResponse>('/api/term-current'));
        } catch {
            return { kind: 'unavailable' };
        }
    });
}
