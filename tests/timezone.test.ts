import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from '../shared/timezone';

/**
 * `zonedTimeToUtc`: the one conversion the iCal export (#15) needs and grid
 * resolution must never touch. Pure, so tested without a database: what
 * matters is that the offset-lookup algorithm gets a REAL zone's real
 * transition right, not just its own round-trip.
 */
describe('zonedTimeToUtc', () => {
    it('resolves CEST (summer, UTC+2) correctly', () => {
        // 6 Oct 2026 is before Europe's DST ends (last Sunday of October).
        const utc = zonedTimeToUtc({ year: 2026, month: 10, day: 6, hour: 9, minute: 0 }, 'Europe/Berlin');

        expect(utc.toISOString()).toBe('2026-10-06T07:00:00.000Z');
    });

    it('resolves CET (winter, UTC+1) correctly', () => {
        const utc = zonedTimeToUtc({ year: 2026, month: 12, day: 1, hour: 9, minute: 0 }, 'Europe/Berlin');

        expect(utc.toISOString()).toBe('2026-12-01T08:00:00.000Z');
    });

    it('crosses the DST boundary between two conversions, correctly', () => {
        // 25 Oct 2026 is the last Sunday of October: CEST ends that day.
        const beforeChange = zonedTimeToUtc({ year: 2026, month: 10, day: 24, hour: 9, minute: 0 }, 'Europe/Berlin');
        const afterChange = zonedTimeToUtc({ year: 2026, month: 10, day: 26, hour: 9, minute: 0 }, 'Europe/Berlin');

        // Same LOCAL wall-clock hour, different UTC offset either side of the
        // transition: this is the property a fixed offset would get wrong.
        expect(beforeChange.getUTCHours()).toBe(7);
        expect(afterChange.getUTCHours()).toBe(8);
    });

    it('resolves a non-integer offset zone (IST, UTC+5:30)', () => {
        const utc = zonedTimeToUtc({ year: 2026, month: 6, day: 1, hour: 9, minute: 0 }, 'Asia/Kolkata');

        expect(utc.toISOString()).toBe('2026-06-01T03:30:00.000Z');
    });

    it('leaves UTC itself unchanged', () => {
        const utc = zonedTimeToUtc({ year: 2026, month: 3, day: 15, hour: 12, minute: 30 }, 'UTC');

        expect(utc.toISOString()).toBe('2026-03-15T12:30:00.000Z');
    });
});
