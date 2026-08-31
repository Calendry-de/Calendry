import { describe, expect, it } from 'vitest';
import {
    resolveTermId,
    scheduleFiltersFromQuery,
    scheduleFiltersToQuery,
    scheduleLinkForTerm,
} from '../app/composables/scheduleFilters';

/**
 * #73 and #74 explicitly warn that building the Pinia store in isolation from
 * the URL sync risks the two fighting each other over which Term wins. Both
 * land through `resolveTermId`, so this pins the one rule that keeps them
 * from disagreeing, plus the #75 fix that depends on the same URL shape.
 */
describe('resolveTermId (the #73/#74 precedence rule)', () => {
    it('lets an explicit URL termId win over a remembered one', () => {
        expect(resolveTermId('term-from-url', 'term-from-store')).toBe('term-from-url');
    });

    it('falls back to the store when the URL carries no termId', () => {
        expect(resolveTermId(undefined, 'term-from-store')).toBe('term-from-store');
    });

    it('falls back to the server default (empty) when neither has one', () => {
        expect(resolveTermId(undefined, '')).toBe('');
    });
});

describe('scheduleFiltersFromQuery', () => {
    it('reads present fields and leaves absent ones undefined', () => {
        expect(scheduleFiltersFromQuery({ termId: 'term-1', roomId: 'room-1' }))
            .toMatchObject({ termId: 'term-1', roomId: 'room-1', groupId: undefined, personId: undefined });
    });

    it('takes the first value of a repeated query key', () => {
        expect(scheduleFiltersFromQuery({ termId: ['term-1', 'term-2'] }).termId).toBe('term-1');
    });

    it('parses week as a positive integer, ignoring garbage', () => {
        expect(scheduleFiltersFromQuery({ week: '3' }).week).toBe(3);
        expect(scheduleFiltersFromQuery({ week: '0' }).week).toBeUndefined();
        expect(scheduleFiltersFromQuery({ week: 'nope' }).week).toBeUndefined();
    });

    it('parses includeNested, defaulting undefined only when absent', () => {
        expect(scheduleFiltersFromQuery({}).includeNested).toBeUndefined();
        expect(scheduleFiltersFromQuery({ includeNested: 'false' }).includeNested).toBe(false);
        expect(scheduleFiltersFromQuery({ includeNested: 'true' }).includeNested).toBe(true);
    });
});

describe('scheduleFiltersToQuery', () => {
    const base = { termId: '', week: 1, groupId: '', roomId: '', personId: '', includeNested: true };

    it('omits every field at its default, for a clean bare /schedule link', () => {
        expect(scheduleFiltersToQuery(base)).toEqual({});
    });

    it('round-trips a non-default selection', () => {
        const query = scheduleFiltersToQuery({
            ...base, termId: 'term-1', week: 4, groupId: 'group-1', includeNested: false,
        });

        expect(query).toEqual({ termId: 'term-1', week: '4', groupId: 'group-1', includeNested: 'false' });
    });

    it('sends includeNested only alongside a groupId, matching the API query shape', () => {
        expect(scheduleFiltersToQuery({ ...base, includeNested: false })).toEqual({});
    });
});

describe('scheduleLinkForTerm (#75)', () => {
    it('carries the reviewed Term so the schedule opens on it, not the newest one', () => {
        expect(scheduleLinkForTerm('term-reviewed')).toBe('/schedule?termId=term-reviewed');
    });

    it('degrades to a bare link when the Term is unknown', () => {
        expect(scheduleLinkForTerm(null)).toBe('/schedule');
    });

    it('encodes a termId that is not already URL-safe', () => {
        expect(scheduleLinkForTerm('term with space')).toBe('/schedule?termId=term%20with%20space');
    });
});
