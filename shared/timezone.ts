/**
 * Converting a TENANT-LOCAL wall clock into a real instant: the ONE place
 * this conversion belongs, and nowhere else.
 *
 * Timezone in Calendry is per-Person and DISPLAY-ONLY (TAXONOMY.md §8):
 * grid resolution, constraint evaluation and "same day" logic all run in
 * `Tenant.timezone`, and none of that needs to know what an absolute instant
 * is: a block index and a day-of-week are already unambiguous within one
 * institution. An exported `.ics` file is the first artefact that LEAVES the
 * app and is rendered by someone else's software, which has no notion of
 * "this institution's wall clock"; it only understands real instants. This
 * function is the boundary where that translation happens; it must never be
 * used inside grid or constraint logic, which have no instant to convert.
 */

export interface ZonedDateParts {
    year: number;
    /** 1-based, matching `Date`'s constructor convention elsewhere in this codebase. */
    month: number;
    day: number;
    hour: number;
    minute: number;
}

/**
 * The instant that DISPLAYS as `parts` when read in `timeZone`.
 *
 * NO DATE LIBRARY: the same reasoning `localNow` in `solverCalendar.ts`
 * already gives for the reverse direction: `Intl` is the only correct way to
 * ask what a zone's clock says without reimplementing tzdata, and adding one
 * for a single conversion this narrow is not worth a new dependency.
 *
 * THE ALGORITHM, since going this direction is genuinely harder than
 * `localNow`'s (instant → local parts is a straight lookup; local parts →
 * instant needs the zone's OFFSET at a moment that is not yet known):
 *
 *   1. Read `parts` as if they were already UTC: a wrong first guess, but a
 *      concrete instant to measure from.
 *   2. Ask `Intl` what wall-clock time THAT instant displays as in `timeZone`.
 *      The difference between that answer and the original guess IS the
 *      zone's offset at (approximately) the moment being converted.
 *   3. Subtract the offset from the guess.
 *
 * ONE ITERATION, not a fixed point loop: the offset can only change again
 * within the same conversion if `parts` names a moment inside a DST
 * transition, where the local time is genuinely ambiguous (occurs twice) or
 * nonexistent (skipped), a case with no single correct answer for ANY
 * implementation, calendar libraries included. A Session starting in that
 * hour is a real-world rarity this export accepts rather than solves.
 */
export function zonedTimeToUtc(parts: ZonedDateParts, timeZone: string): Date {
    const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);

    const formatted = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(new Date(guess));

    const get = (type: string) => Number(formatted.find((p) => p.type === type)?.value ?? '0');

    // Same `% 24` correction `localNow` already documents: some ICU versions
    // format midnight as hour 24 under `hour12: false`.
    const asIfGuessWereLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));

    return new Date(guess - (asIfGuessWereLocal - guess));
}

/**
 * Whether `value` is an IANA zone name `Intl` recognises: the same
 * try/construct check `isUsableLocale` (`shared/locale.ts`) does for a BCP-47
 * tag, so a saved-but-unusable timezone fails the same way a saved-but-
 * unusable locale does: at the write boundary, not silently at read time.
 */
export function isUsableTimeZone(value: string | null | undefined): value is string {
    if (!value) {
        return false;
    }

    try {
        new Intl.DateTimeFormat(undefined, { timeZone: value });

        return true;
    } catch {
        return false;
    }
}
