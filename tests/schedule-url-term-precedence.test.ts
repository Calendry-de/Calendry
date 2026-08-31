import { describe, expect, it } from 'vitest';
import { resolveTermId, scheduleLinkForTerm } from '../app/composables/scheduleFilters';

/**
 * #73 and #74 explicitly warn that building the Pinia store in isolation from
 * the URL sync risks the two fighting each other over which Term wins. Both
 * land through `resolveTermId`, so this pins the one rule that keeps them
 * from disagreeing, plus the #75 fix that depends on the same URL shape.
 *
 * The URL read/write side itself is `useScheduleFilters()`'s own (pre-existing)
 * `?term=` param — not re-tested here, since these two helpers no longer
 * duplicate that reading/writing.
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

describe('scheduleLinkForTerm (#75)', () => {
    it('carries the reviewed Term so the schedule opens on it, not the newest one', () => {
        expect(scheduleLinkForTerm('term-reviewed')).toBe('/schedule?term=term-reviewed');
    });

    it('degrades to a bare link when the Term is unknown', () => {
        expect(scheduleLinkForTerm(null)).toBe('/schedule');
    });

    it('encodes a termId that is not already URL-safe', () => {
        expect(scheduleLinkForTerm('term with space')).toBe('/schedule?term=term%20with%20space');
    });
});
