import type { PermissionRequirement } from '#shared/permissions';
import { satisfiesPermissionRequirement } from '#shared/permissions';
import type { MessageKey } from '~~/i18n/keys';

/**
 * `/dashboard`'s SECOND count family: pending work, not institution shape.
 *
 * WHY THIS IS NOT A SEVENTH ENTRY IN `COUNTED_KEYS`
 *
 * `app/utils/institutionCounts.ts` is scoped by its own doc comment to "the
 * entities that describe an institution's SHAPE rather than its activity", and
 * that scope is load-bearing rather than decorative. Those six are one kind of
 * fact (how many rooms exist), answered by one mechanism (`/api/{resource}
 * ?limit=1`'s `{ rows, total }` envelope), gated one way (`<resource>.read`),
 * and true of an institution whether or not anybody is looking. A review queue
 * is the opposite on every axis: it is a fact about NOW, it needs a dedicated
 * count route per queue, its gate is a nav entry's authority rather than a
 * resource's, and a non-zero value is a request for the reader's attention.
 * Merging them would have meant one strip where six tiles mean "this is your
 * institution" and the rest mean "do something", which is exactly the flattening
 * `/dashboard`'s own 24-identical-cards grid was rewritten to undo.
 *
 * A PURE MODULE with no Vue and no translator, for the same reason
 * `institutionCounts.ts` is pure: the selection below is permission logic, and
 * permission logic inside a `useAsyncData` callback cannot be reached by a
 * test. `tests/review-queue-counts.test.ts` imports this.
 *
 * IT TAKES NO `Translate`, unlike `countedEntities()`, and the difference is
 * deliberate rather than an inconsistency: that function must thread a
 * translator because its labels belong to the MANAGE REGISTRY, and resolving
 * them anywhere else would introduce a second name for an entity the sidebar
 * already names. These queues have no registry entry to borrow from, so the
 * copy is this family's own; the keys travel and the component resolves them,
 * which also lets it pick the plural form once it knows the count.
 */
export interface ReviewQueue {
    key: string;
    /** The tile's static label. Not count-dependent, so it needs no plural form. */
    labelKey: MessageKey;
    /**
     * The whole sentence, in plural FORMS (`zero | one | other`), used as the
     * tile's accessible name. A screen reader hears "3 solver proposals are
     * waiting for review", not the numeral and an uppercase fragment. Per
     * `i18n/CONVENTIONS.md` this is one message with `|` forms, never a word
     * with a suffix patched on: German has no `-s` plural.
     */
    sentenceKey: MessageKey;
    /**
     * Said when the count could not be READ, which is a third state and not a
     * shade of zero. "Nothing is waiting", "you may not see this queue" and
     * "the request failed" are three different facts; the first is a numeral,
     * the second is the tile's absence, and this is the third.
     */
    unavailableKey: MessageKey;
    /** Where acting on the queue happens. The same destination its nav entry has. */
    to: string;
    /**
     * The count route, WITH its status filter baked in, so "waiting" has one
     * definition rather than one per caller. Query written out here rather than
     * assembled in the fetch: the number and the page it links to have to mean
     * the same thing, and that agreement is checkable only if the filter is a
     * value a test can read.
     */
    countPath: string;
    /**
     * AN AND OF ORS (`PermissionRequirement`), because the queues genuinely
     * differ in shape: proposals and exam reviews need one key each, vetoes
     * accept either administration key. A bare string would have forced the
     * veto tile to pick one and hide itself from half the people who can open
     * the page it links to.
     */
    permission: PermissionRequirement;
}

/**
 * The review queues, in the order the dashboard states them.
 *
 * Each gate is its DESTINATION'S gate, copied from `navPlaces.ts`, and each
 * count route's own gate is its LIST route's gate. Those two facts together are
 * what keep the strip from widening the page's permission surface by anything:
 * a tile appears exactly when the sidebar link beside it does, and the request
 * behind it succeeds exactly when that link's page would load.
 *
 * `status=READY`, NOT `PENDING`, for proposals, and that is the one judgement
 * call in this file. `PENDING` and `RUNNING` are the solver's own in-flight
 * states, advanced server-side by the poller without anybody doing anything;
 * `READY` is the state that is waiting for a HUMAN. `/schedule/proposals`
 * already defaults its own scope filter to `READY` for the same reason, so
 * counting anything wider would put a number on the dashboard that the page it
 * links to does not show, which is the worst available outcome for a tile whose
 * entire job is to be trusted at a glance.
 */
export const REVIEW_QUEUES: readonly ReviewQueue[] = [
    {
        key: 'proposals',
        labelKey: 'dashboard.reviewQueues.proposals.label',
        sentenceKey: 'dashboard.reviewQueues.proposals.sentence',
        unavailableKey: 'dashboard.reviewQueues.proposals.unavailable',
        to: '/schedule/proposals',
        countPath: '/api/generations/count?status=READY',
        permission: ['generation.read'],
    },
    {
        key: 'vetoes',
        labelKey: 'dashboard.reviewQueues.vetoes.label',
        sentenceKey: 'dashboard.reviewQueues.vetoes.sentence',
        unavailableKey: 'dashboard.reviewQueues.vetoes.unavailable',
        to: '/manage/availability/reviews',
        countPath: '/api/availability/vetoes/count?status=PENDING',
        /*
         * EITHER key, matching `GET /api/availability/vetoes/count`. The nav
         * entry gates on `manage_any` alone because a page whose only actions
         * are approve and reject is not worth offering to somebody who can do
         * neither; a COUNT is not an action, and a scheduler holding `read_any`
         * has a real reason to know the queue is not empty.
         */
        permission: [['availability.manage_any', 'availability.read_any']],
    },
    /*
     * `exam.review`, NOT `exam.request_own`, matching both the nav entry and
     * `GET /api/exam-requests/count`: this queue is everybody's requests, so
     * the key that lets a lecturer ASK for an exam must not put the
     * institution's queue size on their home page. A lecturer's own requests
     * live at `/my/exams`, which is a different page for a different question.
     *
     * `status=PENDING` for the same reason the two above pin a status: the
     * review page's queue IS the pending rows, and a count over any wider
     * status would put a number on the dashboard that the page it links to
     * does not show.
     */
    {
        key: 'exams',
        labelKey: 'dashboard.reviewQueues.exams.label',
        sentenceKey: 'dashboard.reviewQueues.exams.sentence',
        unavailableKey: 'dashboard.reviewQueues.exams.unavailable',
        to: '/manage/exams/reviews',
        countPath: '/api/exam-requests/count?status=PENDING',
        permission: ['exam.review'],
    },
] as const;

/** One queue's count, as the dashboard renders it. */
export interface ReviewQueueCount extends ReviewQueue {
    /**
     * `null` means THE REQUEST FAILED, and the view must not draw it as 0.
     * Zero is a real, meaningful answer here ("nothing is waiting for you") and
     * gets the real numeral; drawing a failure the same way is the failure mode
     * CLAUDE.md calls invisible.
     */
    total: number | null;
}

/**
 * The review queues this caller may actually read.
 *
 * A queue the caller cannot read is DROPPED, not rendered as "Unavailable":
 * that word means "I asked and could not get an answer", and offering it to
 * somebody who was never allowed to ask makes a permission boundary look like a
 * broken server. It is also why this runs before the fetch rather than after
 * it, so no request is made that is known in advance to 403.
 */
export function reviewQueues(held: ReadonlySet<string>): ReviewQueue[] {
    return REVIEW_QUEUES.filter((queue) => satisfiesPermissionRequirement(held, queue.permission));
}
