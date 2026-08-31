/**
 * Schedule data and grid geometry.
 *
 * Every dimension of the grid is resolved from the tenant's TimeGrid at
 * runtime — active days, block count, block length, start time, breaks. There
 * is no fallback shape and no assumed Mon–Fri, because TAXONOMY.md §2 forbids
 * exactly that. A tenant with no TimeGrid renders an empty state, not a guess.
 */
import type { TimeGridBreak } from '#shared/timeGrid';
import { blockSpan } from '#shared/timeGrid';
import { LECTURER_ROLE_KEY } from '#shared/roles';
import type { Placed } from '#shared/sessionPlacement';
import { isPlacedSession } from '#shared/sessionPlacement';

export interface TimeGrid {
    id: string;
    name: string;
    blockLengthMinutes: number;
    blocksPerDay: number;
    activeDays: number[];
    startHour: number;
    startMinute: number;
    /** Default gap between consecutive blocks, unless a break override replaces it. */
    breakMinutes: number;
    /** Named, sparse overrides. Absent on a grid that has none — the common case. */
    breaks?: TimeGridBreak[];
    isDefault: boolean;
}

export interface Term {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    timeGridId: string | null;
}

export interface ScheduleSession {
    id: string;
    /** An EVENT's own name. Null for an Offering-linked Session. */
    title: string | null;
    /**
     * NULL for an EVENT — a Session placed by a human with no recurring demand
     * behind it (TAXONOMY.md §2).
     *
     * Typed `string` until now, which had not been updated when the column
     * became nullable. That matters here rather than being cosmetic: the UI
     * BRANCHES on this field to decide whether a Session can be deleted, and to
     * the compiler `offeringId === null` read as always-false.
     */
    offeringId: string | null;
    termId: string;
    kindId: string;
    /**
     * NULL together with `dayOfWeek`/`blockIndex` means this Session is
     * BANKED (issue #22, cancel-to-spare-bank) — cancelled but still owed by
     * its Offering, with nowhere to sit until a human places it again.
     * `isPlacedSession()` (`#shared/sessionPlacement`) is the one predicate
     * that reads these three; nothing else should compare them to `null`
     * directly. `PlacedScheduleSession` is what the grid, the agenda and their
     * peers still assume — every one of them only ever receives a Session this
     * predicate has already confirmed.
     */
    termWeek: number | null;
    dayOfWeek: number | null;
    blockIndex: number | null;
    durationBlocks: number;
    isLocked: boolean;
    groups: { groupId: string }[];
    people: { personId: string; roleId: string | null; role: { key: string } | null }[];
    rooms: { roomId: string }[];
    /** `color` is nullable and null means INHERIT — see `shared/sessionColor.ts`. */
    offering: { id: string; title: string; code: string | null; color?: string | null } | null;
    kind: { id: string; key: string; name: string; color: string | null } | null;
    /**
     * Who is COVERING this occurrence right now (issue #30), if anyone. Never
     * derived from `people` — a substitute is deliberately NOT written into
     * `session_person`, so the original lecturer's row is unaffected.
     */
    substitution: { coveringPersonId: string } | null;
}

/**
 * A `ScheduleSession` known to have a real placement — what `ScheduleGrid`,
 * `ScheduleAgenda`, `ScheduleSessionChip` and `ScheduleOffGridTray` declare as
 * their prop type. Every one of them is fed a list already filtered through
 * `isPlacedSession` (`useScheduleData`'s `onGridSessions`/`offGridSessions`),
 * so their own arithmetic on `dayOfWeek`/`blockIndex` stays exactly as it was
 * before banked Sessions existed — only the TYPE moved, not the logic.
 */
export type PlacedScheduleSession = Placed<ScheduleSession>;

export interface Violation {
    id: string;
    /**
     * Null for an OFFERING-scoped violation — ExactFrequency ("needs 6, placed
     * 4") is about demand that was never placed, so there is no session to
     * point at. Anything grouping by session must skip these rather than
     * bucketing them under a falsy key.
     */
    sessionId: string | null;
    offeringId?: string | null;
    offering?: { id: string; code: string | null; title: string; frequency: number } | null;
    severity: 'HARD' | 'SOFT';
    detail: Record<string, unknown>;
    constraint: { id: string; type: string; name: string; severity: string };
}

export interface NamedRow { id: string; name: string }

/** ISO weekday numbers, index 1-7. Never used to decide which days exist. */
const WEEKDAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function weekdayName(iso: number, locale?: string): string {
    if (locale) {
        return intlWeekday(iso, locale, 'long');
    }

    return WEEKDAY_NAMES[iso] ?? `Day ${iso}`;
}

export function weekdayShort(iso: number, locale?: string): string {
    if (locale) {
        return intlWeekday(iso, locale, 'short');
    }

    // Slicing three characters is only correct for English. It is kept as the
    // no-locale fallback so existing callers are unchanged, and every display
    // site that shows a date now passes a locale.
    return weekdayName(iso).slice(0, 3);
}

/**
 * A weekday name in the viewer's language.
 *
 * Anchored to a known ISO week (2024-01-01 was a Monday) and formatted in UTC,
 * so the weekday asked for is the weekday returned. Formatting a "now"-based
 * date would let the viewer's clock shift Monday into Sunday near midnight.
 */
const ISO_MONDAY_UTC = Date.UTC(2024, 0, 1);

function intlWeekday(iso: number, locale: string, weekday: 'long' | 'short'): string {
    if (iso < 1 || iso > 7) {
        return `Day ${iso}`;
    }

    return new Intl.DateTimeFormat(locale, { weekday, timeZone: 'UTC' })
        .format(new Date(ISO_MONDAY_UTC + (iso - 1) * 24 * 60 * 60 * 1000));
}

/**
 * A slot's calendar date, written the way the viewer writes dates.
 *
 * `timeZone: 'UTC'` is not a detail — `slotDate()` returns a UTC-anchored
 * midnight, and formatting it in the viewer's zone would move it to the
 * previous day for anyone west of UTC. The tenant's timetable says which date a
 * Session falls on; the viewer's locale says only how that date is spelled.
 * CLAUDE.md's "timezone is display-only" rule, at the one place that could
 * break it.
 */
export function formatSlotDate(
    date: Date | null,
    locale: string,
    style: 'short' | 'full' = 'short',
): string {
    if (!date) {
        return '';
    }

    return new Intl.DateTimeFormat(locale, style === 'full'
        ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
        : { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
}

/**
 * Clock label for a block index, derived from the grid. Walks cumulative
 * boundaries rather than multiplying by a stride, because a named break override
 * can replace the default gap at any position — the walk is shared with
 * `blockOfMinute()`, which asks the inverse question.
 *
 * `dayOfWeek` defaults to "no particular day", which sees only universal overrides.
 */
export function blockTime(
    grid: TimeGrid,
    blockIndex: number,
    dayOfWeek: number | null = null,
): { start: string; end: string } {
    const { start, end } = blockSpan(grid, blockIndex, dayOfWeek);

    const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

    return { start: fmt(start), end: fmt(end) };
}

/**
 * The one fixed Role key now lives in `shared/roles.ts`, where the server's
 * uses (lecturer assignment, materialisation, `lecturerIds` on the wire) read
 * the same definition. Imported and re-bound here — not `export ... from` —
 * because this file also uses it below.
 */
export { LECTURER_ROLE_KEY };

export interface AssignedPerson {
    personId: string;
    role: { key: string } | null;
}

/** Who is LEADING this Session. */
export function lecturersOf<T extends AssignedPerson>(people: readonly T[]): T[] {
    return people.filter((person) => person.role?.key === LECTURER_ROLE_KEY);
}

/** Everyone else directly assigned — students, auditors, whatever the tenant calls them. */
export function attendeesOf<T extends AssignedPerson>(people: readonly T[]): T[] {
    return people.filter((person) => person.role?.key !== LECTURER_ROLE_KEY);
}

/**
 * What to call a Session on screen. ONE definition, five consumers — previously
 * inlined at each with THREE different fallbacks, and the placement banner had
 * none, so it rendered "Pick a slot for ." for every Event.
 *
 * An Event is called what someone named it; anything else after its Offering. The
 * two never compete, which is why the create route refuses a title with an
 * offeringId.
 */
export function sessionLabel(session: Pick<ScheduleSession, 'title' | 'offering'> | null | undefined): string {
    if (!session) {
        return 'Session';
    }

    // The Offering wins whenever there is one, unconditionally — `title` is
    // NULL for those rows by construction, and reading it first would quietly
    // introduce the competition the write guard exists to prevent.
    if (session.offering) {
        return session.offering.title;
    }

    // Required at creation, so the fallback is for rows that predate the
    // column rather than for ordinary use.
    return session.title ?? 'Untitled event';
}

/**
 * A session belongs on the grid only if it HAS a placement, its day is one the
 * grid schedules, AND it fits within the day's blocks. A banked Session
 * (issue #22) fails the first test and belongs to neither this nor the
 * off-grid tray — `useScheduleData` partitions it out separately before
 * either bucket is computed, so in practice this only ever sees a real
 * placement or a banked Session explicitly excluded upstream; the check
 * stays here anyway so the function is correct on its own, not just as used.
 */
export function isOnGrid(grid: TimeGrid, session: ScheduleSession): boolean {
    return (
        isPlacedSession(session)
        && grid.activeDays.includes(session.dayOfWeek)
        && session.blockIndex >= 0
        && session.blockIndex + session.durationBlocks <= grid.blocksPerDay
    );
}

export function offGridReason(grid: TimeGrid, session: PlacedScheduleSession): string {
    if (!grid.activeDays.includes(session.dayOfWeek)) {
        return `${weekdayName(session.dayOfWeek)} is not a scheduled day on this grid`;
    }

    return `Runs past block ${grid.blocksPerDay} — the last block of the day`;
}

/** Sessions keyed by `${dayOfWeek}:${blockIndex}`, so a slot can hold several. */
export function groupBySlot(sessions: PlacedScheduleSession[]): Map<string, PlacedScheduleSession[]> {
    const map = new Map<string, PlacedScheduleSession[]>();

    for (const session of sessions) {
        const key = `${session.dayOfWeek}:${session.blockIndex}`;
        const list = map.get(key) ?? [];

        list.push(session);
        map.set(key, list);
    }

    return map;
}

export function violationsBySession(violations: Violation[]): Map<string, Violation[]> {
    const map = new Map<string, Violation[]>();

    for (const violation of violations) {
        // Offering-scoped violations have no session and belong to no chip.
        if (!violation.sessionId) {
            continue;
        }

        const list = map.get(violation.sessionId) ?? [];

        list.push(violation);
        map.set(violation.sessionId, list);
    }

    return map;
}

/** Violations that are about unplaced demand rather than a placed Session. */
export function offeringViolations(violations: Violation[]): Violation[] {
    return violations.filter((violation) => !violation.sessionId);
}

/** Turns a violation's structured detail into something a human can act on. */
export function describeViolation(violation: Violation, lookup: {
    room: (id: string) => string;
    person: (id: string) => string;
    group: (id: string) => string;
}): string {
    const detail = violation.detail as {
        reason?: string;
        roomIds?: string[];
        personIds?: string[];
        groupIds?: string[];
    };

    switch (detail.reason) {
        case 'room_double_booked':
            return `Room already booked at this time: ${(detail.roomIds ?? []).map(lookup.room).join(', ')}`;
        case 'person_double_booked':
            return `Already teaching at this time: ${(detail.personIds ?? []).map(lookup.person).join(', ')}`;
        case 'group_double_booked':
            return `Group already has a session: ${(detail.groupIds ?? []).map(lookup.group).join(', ')}`;
        default:
            return violation.constraint.name;
    }
}

/**
 * Side-by-side layout for anything whose block ranges overlap. Grouping by
 * identical start block is not enough: an item starting at block 1 overlaps one
 * that started at 0 and runs for two, and they land in intersecting grid areas.
 *
 * The ordinary calendar algorithm — transitively overlapping items form a cluster,
 * and each takes the first column free at its start block. Nothing is ever dropped:
 * an overlap is usually a defect the user is trying to SEE. How a cluster too
 * crowded to fan is PRESENTED is `clusterSlots`' decision, not this one.
 */
/** What the packer needs to know about an item; anything else is the caller's. */
export interface PackedSpan {
    /** Tie-break, so equal spans order deterministically across renders. */
    key: string;
    /** First occupied block. */
    start: number;
    /** How many blocks it occupies; at least 1. */
    span: number;
}

export interface Packed<T> {
    item: T;
    column: number;
    columns: number;
    /**
     * Identifies the overlap cluster this item belongs to — every member of a
     * cluster shares it. A presentation that wants to treat a crowded cluster
     * differently (the review grid collapses one past a legibility floor) needs
     * to address the cluster as a unit, and `columns` alone cannot name WHICH.
     */
    cluster: string;
}

/**
 * GENERIC BECAUSE THERE ARE TWO GRIDS: `ScheduleGrid` packs Sessions,
 * `ScheduleReviewGrid` packs ReviewPlacements, which have no Session id at all for
 * a new placement. That component used to fan everything sharing an exact
 * `day:blockIndex` key, so a multi-block placement overlapping a single-block one
 * was drawn on top of it — the same bug, reintroduced by a second implementation.
 */
export function packSpans<T>(items: T[], read: (item: T) => PackedSpan): Packed<T>[] {
    const spans = items.map((item) => ({ item, ...read(item) }));

    const ordered = [...spans].sort((a, b) => (
        a.start - b.start || b.span - a.span || a.key.localeCompare(b.key)
    ));

    const out: Packed<T>[] = [];

    let cluster: Packed<T>[] = [];
    let clusterEnd = -1;
    let clusterStart = -1;
    // Last occupied block per column, so a column can be reused once free.
    let columnEnds: number[] = [];

    const flush = () => {
        const columns = columnEnds.length || 1;
        const name = `c${clusterStart}`;

        for (const placement of cluster) {
            placement.columns = columns;
            placement.cluster = name;
        }

        out.push(...cluster);
        cluster = [];
        columnEnds = [];
        clusterEnd = -1;
        clusterStart = -1;
    };

    for (const entry of ordered) {
        const end = entry.start + Math.max(1, entry.span);

        // A gap with nothing running closes the cluster: what follows cannot
        // overlap anything in it, so it starts its own column count.
        if (cluster.length && entry.start >= clusterEnd) {
            flush();
        }

        if (!cluster.length) {
            clusterStart = entry.start;
        }

        let column = columnEnds.findIndex((occupiedUntil) => occupiedUntil <= entry.start);

        if (column === -1) {
            column = columnEnds.length;
        }

        columnEnds[column] = end;
        clusterEnd = Math.max(clusterEnd, end);
        cluster.push({ item: entry.item, column, columns: 1, cluster: '' });
    }

    if (cluster.length) {
        flush();
    }

    return out;
}

