/**
 * A fetch rejection's status, narrowed without trusting its shape: an `ofetch`
 * rejection is untyped and a network failure is not an object at all. Anything
 * that is not a number is null — "we do not know how far this got".
 */
export function statusCodeOf(error: unknown): number | null {
    if (typeof error !== 'object' || error === null) {
        return null;
    }

    const code = (error as { statusCode?: unknown }).statusCode;

    return typeof code === 'number' ? code : null;
}

export interface LoadFailure {
    title: string;
    detail: string;
    /** Whether retrying could plausibly succeed. A 403 will not fix itself. */
    retryable: boolean;
}

/** Why the schedule could not be read, as something renderable. */
export function describeScheduleFailure(error: unknown): LoadFailure {
    switch (statusCodeOf(error)) {
        case 401:
            return {
                title: 'Your session has expired',
                detail: 'Sign in again to see the schedule.',
                retryable: false,
            };
        case 403:
            return {
                title: 'You cannot see this schedule',
                detail: 'One of the reference endpoints this page reads refused. '
                    + 'The permissions it needs are named by the schedule middleware.',
                retryable: false,
            };
        case 404:
            return {
                title: 'This schedule is not there',
                detail: 'The term or grid this view asked for no longer exists.',
                retryable: false,
            };
        default:
            return {
                title: 'Could not load the schedule',
                detail: 'The request did not come back. Nothing has been changed — '
                    + 'your timetable is intact.',
                retryable: true,
            };
    }
}
