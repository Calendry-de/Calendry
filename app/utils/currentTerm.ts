import type { TermPhase } from '#shared/academicCalendar';
import type { MessageKey } from '~~/i18n/keys';

/**
 * `/dashboard`'s CALENDAR LABEL: which term the page's numbers are about, and
 * which week of it today is.
 *
 * WHY THE PAGE NEEDS THIS AT ALL. Every count on the dashboard is implicitly
 * scoped to a term and the page named none of them, so a reader got numbers
 * with no calendar around them and no way to tell a term that has not started
 * from one halfway through. The strip below it can say "12 offerings" about a
 * term nobody is teaching yet.
 *
 * A PURE MODULE with no Vue and no translator, for the same reason
 * `reviewQueues.ts` and `institutionCounts.ts` are pure: the permission gate
 * and the four-way state below are logic, and logic inside a `useAsyncData`
 * callback cannot be reached by a test. `tests/current-term-context.test.ts`
 * imports this.
 */

/** The `/api/term-current` Term summary. Dates are ISO-8601, date only. */
export interface CurrentTermSummary {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
}

/**
 * What `GET /api/term-current` sends, as a DISCRIMINATED UNION on `term`
 * rather than a term with three optional siblings: `phase`/`week`/`totalWeeks`
 * describe nothing when the tenant has authored no Term, and CLAUDE.md prefers
 * a union over optional-field soup so a consumer cannot read a week that is not
 * about anything. Written out here because `request<T>()` is an unchecked
 * assertion about what the server sends: this type IS the claim, so it is
 * stated once, next to the state machine that consumes it, and pinned against
 * the live route by `tests/current-term-api.test.ts`.
 */
export type CurrentTermResponse =
    | { term: null }
    | { term: CurrentTermSummary; phase: TermPhase; week: number; totalWeeks: number };

/**
 * The header line's state, as the view renders it. FOUR CASES, and keeping them
 * apart is the whole point of the type:
 *
 *   (absent)      the caller has no `term.read`, so nothing was asked and there
 *                 is no line at all. Represented by `null` from the composable
 *                 rather than a case here: a permission boundary is not a state
 *                 of the term.
 *   `none`        the tenant has authored no Term. The most useful thing a
 *                 fresh institution's home page can say, and the reason this
 *                 is not folded into `unavailable`.
 *   `unavailable` the request failed. CLAUDE.md's invisible-bug rule: "no term
 *                 configured" and "could not ask" must not render alike.
 *   `term`        a real answer, `phase` saying whether the week describes now
 *                 or a boundary.
 */
export type TermContext =
    | { kind: 'none' }
    | { kind: 'unavailable' }
    | { kind: 'term'; name: string; phase: TermPhase; week: number; totalWeeks: number };

/**
 * Whether to ask at all.
 *
 * `term.read`, the same key `GET /api/term-current` requires and the same one
 * the counts strip's Terms tile is gated on, so the header line appears exactly
 * when that tile does. Checked BEFORE the fetch, not after: a caller who was
 * never allowed to ask must see no line rather than the word "unavailable",
 * which means "I asked and could not get an answer" and makes a permission
 * boundary look like a broken server.
 */
export function mayReadCurrentTerm(held: ReadonlySet<string>): boolean {
    return held.has('term.read');
}

/** The response, as the four-case state above. */
export function termContext(response: CurrentTermResponse): TermContext {
    if (response.term === null) {
        return { kind: 'none' };
    }

    return {
        kind: 'term',
        name: response.term.name,
        phase: response.phase,
        week: response.week,
        totalWeeks: response.totalWeeks,
    };
}

/**
 * The message key for a state, and the ONE place the phase→copy mapping lives.
 *
 * A `Record` over `TermPhase` rather than a `switch` with a default: adding a
 * fourth phase to `shared/academicCalendar.ts` then fails to compile here
 * instead of silently rendering whichever branch the default happened to be.
 */
const PHASE_KEYS: Record<TermPhase, MessageKey> = {
    BEFORE: 'dashboard.term.before',
    DURING: 'dashboard.term.during',
    AFTER: 'dashboard.term.after',
};

export function termContextKey(context: TermContext): MessageKey {
    switch (context.kind) {
        case 'none':
            return 'dashboard.term.none';
        case 'unavailable':
            return 'dashboard.term.unavailable';
        case 'term':
            return PHASE_KEYS[context.phase];
    }
}
