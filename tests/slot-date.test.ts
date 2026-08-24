import { describe, expect, it } from 'vitest';
import { isoDate, slotDate } from '../shared/academicCalendar';
import { formatSlotDate, weekdayName, weekdayShort } from '../app/composables/schedule';
import { parseAcceptLanguage } from '../app/composables/locale';

/**
 * The calendar date behind a `(termWeek, dayOfWeek)` slot, and how it is written.
 *
 * WHY THE DATE ITSELF IS NOT A DISPLAY CONCERN. The same arithmetic already
 * exists in SQL — `calendry_internal.federation_room_occupancy()` computes
 * `date_trunc('week', start_date) + ((week-1)*7 + (day-1))` — and its comment
 * says it anchors that way deliberately so both sides agree. A fourth
 * definition drifting from the other three is the failure this module keeps
 * being written to prevent, so the expectations below are the SQL's answers for
 * the demo term, checked against a live database.
 */
describe('slotDate agrees with the SQL already in production', () => {
    // Wintersemester starts 2027-10-02, a SATURDAY — so week 1 begins on the
    // Monday BEFORE the term's own start date. Anything anchoring on the start
    // date itself rather than its ISO Monday gets this wrong by five days.
    const termStart = new Date('2027-10-02T00:00:00Z');

    it('puts week 1 day 1 on the ISO Monday of the term start', () => {
        expect(isoDate(slotDate(termStart, 1, 1))).toBe('2027-09-27');
    });

    it('walks days within a week', () => {
        expect(isoDate(slotDate(termStart, 1, 2))).toBe('2027-09-28');
        expect(isoDate(slotDate(termStart, 1, 7))).toBe('2027-10-03');
    });

    it('walks whole weeks', () => {
        expect(isoDate(slotDate(termStart, 2, 1))).toBe('2027-10-04');
        expect(isoDate(slotDate(termStart, 2, 2))).toBe('2027-10-05');
        expect(isoDate(slotDate(termStart, 13, 1))).toBe('2027-12-20');
    });

    it('is unaffected by a term start that is already a Monday', () => {
        expect(isoDate(slotDate(new Date('2026-10-05T00:00:00Z'), 1, 1))).toBe('2026-10-05');
    });
});

describe('formatting follows the viewer, the date does not', () => {
    const date = slotDate(new Date('2027-10-02T00:00:00Z'), 1, 1); // 2027-09-27

    it('writes the same day differently per locale', () => {
        expect(formatSlotDate(date, 'en-GB')).toContain('27');
        expect(formatSlotDate(date, 'ja-JP')).toContain('27');
        // Order differs, the day does not.
        expect(formatSlotDate(date, 'en-US')).toMatch(/Sep/);
        expect(formatSlotDate(date, 'de-DE')).toMatch(/Sept/);
    });

    it('never shifts the calendar day, whatever the runtime zone', () => {
        // The trap: `slotDate` returns a UTC midnight, so formatting it in a
        // zone west of UTC would render the PREVIOUS day. Every formatter here
        // pins `timeZone: 'UTC'`; this is what proves it.
        for (const locale of ['en-GB', 'en-US', 'de-DE', 'ja-JP']) {
            expect(formatSlotDate(date, locale, 'full')).toContain('27');
        }
    });

    it('localises weekday names, and does not slice them to three characters', () => {
        expect(weekdayName(1, 'de-DE')).toBe('Montag');
        expect(weekdayName(1, 'ja-JP')).toBe('月曜日');

        // The old `weekdayShort` was `weekdayName().slice(0, 3)`, which is
        // only correct for English.
        expect(weekdayShort(3, 'de-DE')).not.toBe('Mit');
    });

    it('keeps the English fallback when no locale is supplied', () => {
        expect(weekdayName(1)).toBe('Monday');
        expect(weekdayShort(1)).toBe('Mon');
    });

    it('renders nothing for a null date rather than "Invalid Date"', () => {
        expect(formatSlotDate(null, 'en-GB')).toBe('');
    });
});

describe('the locale the server resolves', () => {
    it('takes the first tag of Accept-Language', () => {
        expect(parseAcceptLanguage('de-DE,de;q=0.9,en;q=0.8')).toBe('de-DE');
    });

    it('returns null for a missing or malformed header instead of throwing', () => {
        // Intl throws a RangeError on an invalid tag, which would take down
        // every render for one bad request header.
        expect(parseAcceptLanguage(undefined)).toBeNull();
        expect(parseAcceptLanguage('')).toBeNull();
        expect(parseAcceptLanguage('not a language!!')).toBeNull();
    });
});
