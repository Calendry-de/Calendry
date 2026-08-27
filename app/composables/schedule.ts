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
    termWeek: number;
    dayOfWeek: number;
    blockIndex: number;
    durationBlocks: number;
    isLocked: boolean;
    groups: { groupId: string }[];
    people: { personId: string; roleId: string | null; role: { key: string } | null }[];
    rooms: { roomId: string }[];
    /** `color` is nullable and null means INHERIT — see `shared/sessionColor.ts`. */
    offering: { id: string; title: string; code: string | null; color?: string | null } | null;
    kind: { id: string; key: string; name: string; color: string | null } | null;
}

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
 * Clock label for a block index, derived from the grid rather than assumed.
 *
 * Blocks are laid end to end with the grid's default gap between them, unless a
 * named break override replaces it at that position — so this walks cumulative
 * boundaries rather than multiplying by a stride. The walk is shared with
 * `blockOfMinute()`, which asks the inverse question; see `shared/timeGrid.ts`.
 *
 * `dayOfWeek` matters once a grid has a day-specific override. It defaults to
 * "no particular day", which sees only universal ones.
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
 * What to call a Session on screen.
 *
 * ONE definition, five consumers — the chip, the inspector, the off-grid tray,
 * the placement banner and the violations panel. It was previously inlined at
 * each of them as `session.offering?.title ?? …`, with THREE different
 * fallbacks: two said "Untitled session", one said "Session", and the banner
 * had none at all, so it rendered "Pick a slot for ." for every Event.
 *
 * The rule: an Event is called what someone named it; anything else is called
 * after its Offering. The two never compete, which is why the create route
 * refuses a title alongside an offeringId.
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
 * A session belongs on the grid only if its day is one the grid schedules AND
 * it fits within the day's blocks. Anything else is real data the grid cannot
 * position — it goes to the off-grid tray rather than vanishing.
 */
export function isOnGrid(grid: TimeGrid, session: ScheduleSession): boolean {
    return (
        grid.activeDays.includes(session.dayOfWeek)
        && session.blockIndex >= 0
        && session.blockIndex + session.durationBlocks <= grid.blocksPerDay
    );
}

export function offGridReason(grid: TimeGrid, session: ScheduleSession): string {
    if (!grid.activeDays.includes(session.dayOfWeek)) {
        return `${weekdayName(session.dayOfWeek)} is not a scheduled day on this grid`;
    }

    return `Runs past block ${grid.blocksPerDay} — the last block of the day`;
}

/** Sessions keyed by `${dayOfWeek}:${blockIndex}`, so a slot can hold several. */
export function groupBySlot(sessions: ScheduleSession[]): Map<string, ScheduleSession[]> {
    const map = new Map<string, ScheduleSession[]>();

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
 * Side-by-side layout for anything whose block ranges overlap.
 *
 * Grouping by identical start block is not enough: an item starting at block 1
 * overlaps one that started at block 0 and runs for two blocks, and the two land
 * in different grid areas that intersect — so they stack, and the upper chip's
 * hover lift reveals the one underneath.
 *
 * This is the ordinary calendar algorithm. Items that transitively overlap form
 * a cluster; within a cluster each takes the first column free at its start
 * block. Nothing is ever dropped from a cluster: in a timetabling tool an
 * overlap is usually a defect the user is trying to SEE, and on the review
 * screen it is a placement someone is being asked to accept. How a cluster too
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
 * The packing itself, over anything that occupies a block range.
 *
 * GENERIC BECAUSE THERE ARE TWO GRIDS. `ScheduleGrid` packs Sessions for the
 * live schedule; `ScheduleReviewGrid` packs ReviewPlacements, which have no
 * Session id at all when the solver proposes a NEW placement. That component
 * previously fanned everything sharing an exact `day:blockIndex` key and split
 * the width evenly, which meant a multi-block placement overlapping a
 * single-block one was drawn on top of it rather than beside it — the very bug
 * described above, reintroduced by a second implementation. One algorithm, two
 * callers, no third copy.
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

