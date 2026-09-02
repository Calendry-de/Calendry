import type { Translate } from '~/composables/i18n';

/**
 * A fetch rejection's status, narrowed without trusting its shape: an `ofetch`
 * rejection is untyped and a network failure is not an object at all. Anything
 * that is not a number is null: "we do not know how far this got".
 */
export function statusCodeOf(error: unknown): number | null {
    if (typeof error !== 'object' || error === null) {
        return null;
    }

    const code = (error as { statusCode?: unknown }).statusCode;

    return typeof code === 'number' ? code : null;
}

/**
 * The server's own explanation of a failure, or null when it gave none.
 *
 * ONE PLACE THAT KNOWS THE SHAPE OF A FETCH REJECTION, because there were
 * about fifty inline `serverErrorMessage(cause)`
 * casts and each was a separate chance to read the wrong field.
 *
 * WHY `data.message` AND NOT `statusMessage`. Nitro's error body carries both,
 * and h3 mirrors whichever one the route supplied into the other, so reading
 * either worked. That stops being true: h3 sanitises `statusMessage` by
 * default in a coming version, because it is emitted into the HTTP status LINE
 * (`HTTP/1.1 401 Invalid credentials.`), where arbitrary text does not belong.
 * `message` is a body field and is not sanitised, so every route here now
 * supplies `message` and every reader takes it from the body.
 *
 * WHY NOT `error.message`, WHICH IS THE OBVIOUS GUESS AND IS WRONG. On an
 * `ofetch` rejection that property is ofetch's own construction, along the
 * lines of `[GET] "/api/persons": 404 Not Found` — a useful thing to log and
 * never a thing to show a person. The server's sentence is only ever in
 * `error.data`.
 *
 * Returns null rather than a fallback sentence: the caller owns the fallback,
 * because only the caller knows which of its own translated messages fits.
 *
 * AND IT DELIBERATELY DOES NOT FALL BACK TO `statusMessage`, which was the
 * first version of this function and was wrong. Verified against a live 401
 * once the routes had moved: the body now reads
 * `{ statusCode: 401, statusMessage: 'Server Error', message: 'Authentication
 * required.' }`. h3 fills the unset `statusMessage` with a generic phrase, so
 * reading it as a last resort does not surface an unmigrated route's sentence,
 * it surfaces the literal words "Server Error" to a person, in place of the
 * caller's own translated fallback. Null is strictly better: it is the honest
 * answer to "did the server explain itself", and it lets the caller say
 * something a reader can act on.
 */
export function serverErrorMessage(error: unknown): string | null {
    if (typeof error !== 'object' || error === null) {
        return null;
    }

    const stated = (error as { data?: { message?: unknown } }).data?.message;

    return typeof stated === 'string' && stated.trim() ? stated : null;
}

export interface LoadFailure {
    title: string;
    detail: string;
    /** Whether retrying could plausibly succeed. A 403 will not fix itself. */
    retryable: boolean;
}

/**
 * Why the schedule could not be read, as something renderable.
 *
 * ONE KEY PER STATE, never a shared sentence for two of them, and that is the
 * whole reason this function exists rather than a single "could not load"
 * message: an expired session, a refused permission, a term that is gone and a
 * request that never came back have four different fixes, and CLAUDE.md's
 * standing rule is that if "no data" and "fetch failed" render identically the
 * bug is invisible. `tests/schedule-load-failure.test.ts` pins the four titles
 * as distinct. Two of these English strings would read similarly if shortened;
 * merging their keys would erase the distinction in every language at once.
 *
 * TAKES `t`, IT DOES NOT CALL `useT()` (i18n/CONVENTIONS.md § "Copy in plain
 * `.ts` modules"): this is a plain module, called from a `computed` getter in
 * `useScheduleData()` and imported by a unit test that runs in plain Node with
 * no Nuxt instance. Required rather than optional, so a caller that forgets it
 * is a typecheck error rather than a page rendering raw keys.
 */
export function describeScheduleFailure(t: Translate, error: unknown): LoadFailure {
    switch (statusCodeOf(error)) {
        case 401:
            return {
                title: t('errors.scheduleLoad.expired.title'),
                detail: t('errors.scheduleLoad.expired.detail'),
                retryable: false,
            };
        case 403:
            return {
                title: t('errors.scheduleLoad.forbidden.title'),
                detail: t('errors.scheduleLoad.forbidden.detail'),
                retryable: false,
            };
        case 404:
            return {
                title: t('errors.scheduleLoad.missing.title'),
                detail: t('errors.scheduleLoad.missing.detail'),
                retryable: false,
            };
        default:
            return {
                title: t('errors.scheduleLoad.unknown.title'),
                detail: t('errors.scheduleLoad.unknown.detail'),
                retryable: true,
            };
    }
}
