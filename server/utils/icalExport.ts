import { addDays, isoDate, mondayOf, weekIndexOf } from '../../shared/academicCalendar';
import { blockSpan } from '../../shared/timeGrid';
import type { BlockGrid } from '../../shared/timeGrid';
import { zonedTimeToUtc } from '../../shared/timezone';

export interface ExportSession {
    id: string;
    termWeek: number;
    dayOfWeek: number;
    blockIndex: number;
    durationBlocks: number;
    title: string;
    location: string | null;
}

/**
 * One Session's real start/end instant, resolved from tenant-local wall clock
 * — the ONE conversion this feature exists to do (see `shared/timezone.ts`).
 */
function resolveInstant(
    session: ExportSession,
    termStartDate: Date,
    grid: BlockGrid,
    timeZone: string,
): { start: Date; end: Date } {
    const date = addDays(mondayOf(termStartDate), (session.termWeek - 1) * 7 + (session.dayOfWeek - 1));
    const startSpan = blockSpan(grid, session.blockIndex, session.dayOfWeek);
    const endSpan = blockSpan(grid, session.blockIndex + session.durationBlocks - 1, session.dayOfWeek);

    const partsAt = (minutesSinceMidnight: number) => ({
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: Math.floor(minutesSinceMidnight / 60),
        minute: minutesSinceMidnight % 60,
    });

    return {
        start: zonedTimeToUtc(partsAt(startSpan.start), timeZone),
        end: zonedTimeToUtc(partsAt(endSpan.end), timeZone),
    };
}

/** `YYYYMMDDTHHMMSSZ` — the iCalendar UTC form, required so every consumer's clock agrees. */
function icsUtc(date: Date): string {
    return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * Escapes the characters RFC 5545 §3.3.11 requires escaped in TEXT values.
 * Order matters: backslash first, or escaping the others would re-escape the
 * backslashes just added. CR/CRLF is normalised to `\n` BEFORE the newline
 * escape — a raw CR surviving into the output would start a new content line
 * mid-value, letting a title inject arbitrary ICS properties.
 */
function icsText(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\r\n?/g, '\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

/** One Term's worth of Sessions, resolved against that Term's own grid. */
export interface ExportTermGroup {
    termStartDate: Date;
    grid: BlockGrid;
    sessions: ExportSession[];
}

/**
 * `.ics` text for one Person's Sessions, across one or several Terms — issue
 * #15's stream half (`server/api/ics/stream.ics.get.ts`), and the one-off
 * download it replaced. GROUPED BY TERM because `resolveInstant` needs each
 * Session's own Term start date and TimeGrid, and an "all Terms" stream can
 * legitimately span several.
 */
export function buildIcs(groups: ExportTermGroup[], timeZone: string): string {
    const now = icsUtc(new Date());

    const events = groups.flatMap((group) => group.sessions.map((session) => {
        const { start, end } = resolveInstant(session, group.termStartDate, group.grid, timeZone);

        return [
            'BEGIN:VEVENT',
            // Stable across re-exports of the SAME Session, so importing twice
            // updates one calendar entry instead of duplicating it.
            `UID:${session.id}@calendry`,
            `DTSTAMP:${now}`,
            `DTSTART:${icsUtc(start)}`,
            `DTEND:${icsUtc(end)}`,
            `SUMMARY:${icsText(session.title)}`,
            ...(session.location ? [`LOCATION:${icsText(session.location)}`] : []),
            'END:VEVENT',
        ].join('\r\n');
    }));

    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Calendry//Schedule Export//EN',
        // CRLF line endings throughout — RFC 5545 §3.1, and several calendar
        // clients silently drop LF-only files rather than erroring.
        ...events,
        'END:VCALENDAR',
    ].join('\r\n');
}

/** Which Term-week index a date range covers, per Term — for the query bound. */
export function weekRangeOf(termStartDate: Date, from: Date, to: Date): { first: number; last: number } {
    return {
        first: Math.max(0, weekIndexOf(termStartDate, from)) + 1,
        last: weekIndexOf(termStartDate, to) + 1,
    };
}

export { isoDate };
