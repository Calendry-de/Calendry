import { describe, expect, it } from 'vitest';
import { describeScheduleFailure, statusCodeOf } from '../app/composables/httpError';
import { englishT } from './helpers/errorMessages';

/**
 * A failure to LOAD the schedule must never be reported as a failure to CONFIGURE
 * one. The page's first empty state is reached whenever `grid` is null, which a
 * 500 or an expired session also produces, telling the reader to create a
 * TimeGrid their tenant already has.
 *
 * Pure, so the branch is verified rather than only read: forcing a mid-SSR
 * reference failure over HTTP would mean breaking the database the auth lookup
 * needs too.
 */
describe('statusCodeOf', () => {
    it('reads a numeric statusCode and nothing else', () => {
        expect(statusCodeOf({ statusCode: 403 })).toBe(403);
        expect(statusCodeOf({ statusCode: 500 })).toBe(500);
    });

    it('returns null for everything that is not a number', () => {
        // None of these may produce a default status that implies we know how
        // far the request got.
        // `ofetch` rejections are not typed. Every one of these must mean
        // "we do not know", never a default status that implies we do.
        expect(statusCodeOf(new TypeError('Failed to fetch'))).toBeNull();
        expect(statusCodeOf('500')).toBeNull();
        expect(statusCodeOf(null)).toBeNull();
        expect(statusCodeOf(undefined)).toBeNull();
        expect(statusCodeOf({ statusCode: '403' })).toBeNull();
        expect(statusCodeOf({})).toBeNull();
    });
});

describe('describeScheduleFailure', () => {
    it('never blames configuration for a transport failure', () => {
        for (const error of [new TypeError('Failed to fetch'), {}, null, { statusCode: 500 }]) {
            const failure = describeScheduleFailure(englishT, error);

            expect(failure.title.toLowerCase()).not.toContain('time grid');
            expect(failure.title.toLowerCase()).not.toContain('configured');
            expect(failure.detail.toLowerCase()).not.toContain('create');
        }
    });

    it('offers a retry only where retrying could work', () => {
        // A retry button that cannot succeed invites pressing it repeatedly.
        // an invitation to keep pressing it.
        expect(describeScheduleFailure(englishT, { statusCode: 500 }).retryable).toBe(true);
        expect(describeScheduleFailure(englishT, new TypeError('offline')).retryable).toBe(true);
        expect(describeScheduleFailure(englishT, { statusCode: 401 }).retryable).toBe(false);
        expect(describeScheduleFailure(englishT, { statusCode: 403 }).retryable).toBe(false);
        expect(describeScheduleFailure(englishT, { statusCode: 404 }).retryable).toBe(false);
    });

    it('distinguishes the four cases it claims to distinguish', () => {
        const titles = [401, 403, 404, 500]
            .map((statusCode) => describeScheduleFailure(englishT, { statusCode }).title);

        expect(new Set(titles).size).toBe(4);
    });

    it('reassures that nothing was changed when nothing was', () => {
        // The reader's first question is whether their timetable survived.
        // timetable survived it.
        expect(describeScheduleFailure(englishT, { statusCode: 500 }).detail).toContain('intact');
    });
});
