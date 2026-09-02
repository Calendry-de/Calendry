import { describe, expect, it } from 'vitest';
import { sessionLabel } from '../app/composables/schedule';

/**
 * What a Session is called on screen.
 *
 * Pinned because this rule now has FIVE consumers (the grid chip, the
 * inspector, the off-grid tray, the placement banner and the violations panel)
 * and it previously had five copies. Two said "Untitled session", one said
 * "Session", and the banner had no fallback at all, so it rendered
 * "Pick a slot for ." for every Event. One definition is the fix; this is what
 * keeps it one.
 */
describe('sessionLabel', () => {
    it('calls an Event by its own name', () => {
        expect(sessionLabel({ title: 'Open Day Briefing', offering: null } as never))
            .toBe('Open Day Briefing');
    });

    it('calls an Offering-linked Session after its Offering', () => {
        expect(sessionLabel({ title: null, offering: { id: 'o', title: 'Accounting', code: 'ACC' } } as never))
            .toBe('Accounting');
    });

    it('lets the Offering win even if a title somehow exists', () => {
        // The write guard refuses this combination, so it should be
        // unreachable. Asserted anyway: if a row ever acquires one, the two
        // names must not start competing silently: the Offering is the answer.
        expect(sessionLabel({ title: 'stray', offering: { id: 'o', title: 'Accounting', code: null } } as never))
            .toBe('Accounting');
    });

    it('names a legacy Event that predates the column', () => {
        // Title is required at creation, so this is for rows written before it
        // existed rather than for ordinary use.
        expect(sessionLabel({ title: null, offering: null } as never)).toBe('Untitled event');
    });

    it('handles nothing-selected, which is the banner case that had no fallback', () => {
        expect(sessionLabel(null)).toBe('Session');
        expect(sessionLabel(undefined)).toBe('Session');
    });
});
