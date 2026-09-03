/**
 * The room plan's geometry and paging, as pure functions.
 *
 * THE ROOM PLAN IS THE TRANSPOSED TIMETABLE: rooms across, the day down, drawn
 * on a wall for somebody walking past. `GET /api/screens/board` already answers
 * the question ("what is happening in the rooms around me"); this module is only
 * the arithmetic that turns that answer into a picture, kept out of the
 * component for the reason every other geometry decision in this repo is
 * (DECISIONS.md § "Grid geometry"): the numbers are testable and a component
 * mount, in this suite, is not.
 *
 * FOUR PROPERTIES IT SHARES WITH THE WEEK GRIDS, deliberately rather than
 * incidentally:
 *
 *  - **Minute-true at a CONSTANT scale.** A pixel is a fixed number of minutes
 *    for the whole plan, never a percentage of a column, so a busy room and a
 *    quiet one draw the same hour the same height.
 *  - **Nothing is hidden inside a column.** Two Sessions in one Room at one time
 *    is a real (wrong, but real) state of the data, and it splits the column
 *    into lanes rather than drawing one over the other: a display that hid the
 *    second booking would make the double-booking invisible on the one screen
 *    somebody could act on it from.
 *  - **The window covers every entry.** It comes from the TimeGrid where there
 *    is one, but it is WIDENED by anything outside it rather than clipping it.
 *  - **What paging hides, it SAYS it is hiding.** Rooms that do not fit are the
 *    one thing this plan does drop from view, so `roomPlanPageCount` is what the
 *    dots under the plan are drawn from, and the rotation brings each page back
 *    on a timer. A plan that silently drew the first eight of twenty rooms would
 *    be indistinguishable from an institution with eight rooms.
 */

/** The minimum an entry needs to be readable at all, in minutes of the axis. */
const MIN_ENTRY_MINUTES = 12;

export interface RoomPlanEntry {
    startMinute: number;
    endMinute: number;
}

export interface RoomPlanWindow {
    startMinute: number;
    endMinute: number;
}

/**
 * The knobs, and the bounds they are clamped into.
 *
 * `columnWidth` and `rotateSeconds` are read off the display's own URL
 * (`/screen?key=…&columnWidth=220&rotate=20`), because the address is the one
 * thing whoever mounts a screen on a wall actually configures: the page has no
 * chrome and nothing on it can be clicked. Both are CLAMPED rather than
 * trusted, so a typo produces a narrower plan and never a division by zero or a
 * 1px column.
 */
export const ROOM_PLAN_DEFAULTS = {
    /** Wide enough for a group code, a title and a lecturer at wall distance. */
    columnWidth: { min: 96, max: 640, default: 176 },
    /** `0` turns rotation off: a plan whose rooms all fit needs no carousel. */
    rotateSeconds: { min: 4, max: 600, default: 12 },
    /**
     * `default` is what SSR and the first paint draw with, before the viewport
     * has been measured; `min` is the floor below which the plan scrolls
     * instead of compressing an hour into an unreadable band.
     */
    hourHeight: { min: 28, default: 72 },
    /** Used only where there is no TimeGrid and no entry to learn from. */
    window: { startMinute: 8 * 60, endMinute: 18 * 60 },
} as const;

function clampInto(value: number, bounds: { min: number; max: number }): number {
    return Math.min(bounds.max, Math.max(bounds.min, value));
}

/** A finite integer, or null: `''`, `'abc'`, `NaN` and `Infinity` all fail. */
function readInteger(raw: unknown): number | null {
    const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);

    return Number.isFinite(value) ? Math.round(value) : null;
}

export function clampRoomPlanColumnWidth(raw: unknown): number {
    const value = readInteger(raw);

    return value === null ? ROOM_PLAN_DEFAULTS.columnWidth.default : clampInto(value, ROOM_PLAN_DEFAULTS.columnWidth);
}

/** `0` is preserved (rotation off); anything else is clamped into the bounds. */
export function clampRoomPlanRotateSeconds(raw: unknown): number {
    const value = readInteger(raw);

    if (value === null) {
        return ROOM_PLAN_DEFAULTS.rotateSeconds.default;
    }

    return value <= 0 ? 0 : clampInto(value, ROOM_PLAN_DEFAULTS.rotateSeconds);
}

/**
 * The day's vertical extent, on whole hours.
 *
 * TWO SOURCES, AND THEY ARE NOT THE SAME KIND OF FACT.
 *
 * `day` is DERIVED (the TimeGrid's first block start and last block end for the
 * weekday being drawn). It is a starting point, and every entry WIDENS it: an
 * entry outside the grid's own day is possible (a grid narrowed under an
 * existing Session, an event created off grid) and clipping it would delete a
 * lesson from the wall silently.
 *
 * `configured` is a STATED INTENT, from the screen's own `planStartMinute` /
 * `planEndMinute`, and it is AUTHORITATIVE for the end it sets: nothing widens
 * it. Somebody sets it precisely so the drawn hours get bigger, and a single
 * evening outlier that silently restored the whole day would make the setting
 * look broken. What falls outside it is CLIPPED and then NAMED
 * (`roomPlanOutsideWindow`), which is the same contract room paging keeps: the
 * plan may hide something, but never quietly.
 *
 * Each end is independent, so "start at 07:00, end wherever the timetable does"
 * is expressible.
 */
export function roomPlanWindow(
    entries: readonly RoomPlanEntry[],
    day: { startMinute: number | null; endMinute: number | null },
    configured: { startMinute: number | null; endMinute: number | null } = { startMinute: null, endMinute: null },
): RoomPlanWindow {
    const starts = entries.map((entry) => entry.startMinute);
    const ends = entries.map((entry) => entry.endMinute);

    if (day.startMinute !== null) {
        starts.push(day.startMinute);
    }

    if (day.endMinute !== null) {
        ends.push(day.endMinute);
    }

    // Neither a grid, a configured end, nor a single Session: an unconfigured
    // tenant, or the summer. The fallback is a plausible working day, and the
    // page's own "no term is running" note explains the emptiness in it.
    const derivedStart = starts.length
        ? Math.floor(Math.min(...starts) / 60) * 60
        : ROOM_PLAN_DEFAULTS.window.startMinute;
    const derivedEnd = ends.length
        ? Math.ceil(Math.max(...ends) / 60) * 60
        : ROOM_PLAN_DEFAULTS.window.endMinute;

    const startMinute = configured.startMinute ?? derivedStart;
    const endMinute = configured.endMinute ?? derivedEnd;

    // One hour is the smallest picture that still reads as a day rather than as
    // a broken axis: zero-length would divide by zero downstream. Reachable
    // from a configured end alone (`end` set before the grid's day starts),
    // which the CHECK on the column cannot catch, because it does not know
    // the grid.
    return { startMinute, endMinute: Math.max(endMinute, startMinute + 60) };
}

/**
 * How many entries the window does not show whole.
 *
 * ONLY A CONFIGURED WINDOW CAN PRODUCE ONE, since a derived window widens to
 * fit everything, and that is exactly why this exists: a stated window is
 * allowed to crop the day, and the plan then has to say how much it is
 * cropping. Counted for entries that START before or END after the window, so
 * a lesson that merely overhangs the edge counts too: it is drawn, but its
 * time is not readable, and "the 16:30 lab looks like it ends at four" is the
 * kind of quiet wrongness a wall display must not produce.
 */
export function roomPlanOutsideWindow(entries: readonly RoomPlanEntry[], window: RoomPlanWindow): number {
    return entries.filter((entry) => (
        entry.startMinute < window.startMinute || entry.endMinute > window.endMinute
    )).length;
}

/** Every whole hour inside the window, the axis labels and the gridlines. */
export function roomPlanHourMarks(window: RoomPlanWindow): number[] {
    const marks: number[] = [];

    for (let minute = window.startMinute; minute < window.endMinute; minute += 60) {
        marks.push(minute);
    }

    return marks;
}

/**
 * How tall an hour is drawn, given the space there is for the whole day.
 *
 * FILLS THE VIEWPORT where it can, because a wall display cannot be scrolled by
 * anybody: a plan that used a fixed hour height would leave a third of a 4K
 * screen blank, or push 19:00 below the bezel. Below `hourHeight.min` it stops
 * compressing and the plan scrolls instead, which is at least still legible for
 * the signed-in preview.
 */
export function roomPlanHourHeight(viewportHeight: number, window: RoomPlanWindow): number {
    const hours = (window.endMinute - window.startMinute) / 60;

    if (!viewportHeight || hours <= 0) {
        return ROOM_PLAN_DEFAULTS.hourHeight.default;
    }

    return Math.max(ROOM_PLAN_DEFAULTS.hourHeight.min, viewportHeight / hours);
}

/**
 * How many room columns fit at the configured width.
 *
 * `viewportWidth === 0` means "not measured yet" (SSR, and the first frame
 * before the ResizeObserver fires) and answers with EVERY room rather than a
 * guess: the first paint then shows the whole institution slightly cramped, and
 * paging takes over a frame later. Guessing a page size server-side would drop
 * rooms from the SSR output for reasons the client cannot reconstruct.
 */
export function roomPlanColumnsPerPage(viewportWidth: number, columnWidth: number, roomCount: number): number {
    const rooms = Math.max(1, roomCount);

    if (!viewportWidth || columnWidth <= 0) {
        return rooms;
    }

    return Math.max(1, Math.min(rooms, Math.floor(viewportWidth / columnWidth)));
}

export function roomPlanPageCount(roomCount: number, columnsPerPage: number): number {
    if (roomCount <= 0 || columnsPerPage <= 0) {
        return 1;
    }

    return Math.ceil(roomCount / columnsPerPage);
}

export function roomPlanPage<T>(rooms: readonly T[], page: number, columnsPerPage: number): T[] {
    if (columnsPerPage <= 0) {
        return [...rooms];
    }

    const first = Math.max(0, page) * columnsPerPage;

    return rooms.slice(first, first + columnsPerPage);
}

/** 1-based, inclusive, for the accessible name of a page dot. */
export function roomPlanPageRange(page: number, columnsPerPage: number, roomCount: number): { from: number; to: number } {
    const from = Math.max(0, page) * columnsPerPage + 1;

    return { from, to: Math.min(roomCount, from + columnsPerPage - 1) };
}

export interface RoomPlanLane<T> {
    entry: T;
    /** 0-based position across the column. */
    lane: number;
    /** How many lanes this entry's overlap cluster needs. */
    lanes: number;
}

/**
 * Side-by-side lanes for entries that overlap in one room.
 *
 * A Room with two Sessions at one time is a double booking: wrong, and exactly
 * the thing a corridor display is in a position to reveal. Lanes are counted
 * PER OVERLAP CLUSTER rather than per column, so one clash at 09:00 does not
 * halve the width of every other Session in that room for the whole day.
 */
export function roomPlanLanes<T extends RoomPlanEntry>(entries: readonly T[]): RoomPlanLane<T>[] {
    const ordered = [...entries].sort((a, b) => (
        a.startMinute - b.startMinute || a.endMinute - b.endMinute
    ));

    const out: RoomPlanLane<T>[] = [];
    /** Indices into `out` for the cluster being accumulated. */
    let cluster: number[] = [];
    /** The end time of each open lane in the current cluster. */
    let laneEnds: number[] = [];
    let clusterEnd = -1;

    const closeCluster = () => {
        for (const index of cluster) {
            out[index]!.lanes = laneEnds.length;
        }

        cluster = [];
        laneEnds = [];
        clusterEnd = -1;
    };

    for (const entry of ordered) {
        // `>=` so back-to-back Sessions (one ends exactly as the next starts)
        // are NOT an overlap: they share a boundary, not a minute.
        if (cluster.length && entry.startMinute >= clusterEnd) {
            closeCluster();
        }

        let lane = laneEnds.findIndex((end) => end <= entry.startMinute);

        if (lane === -1) {
            lane = laneEnds.length;
        }

        laneEnds[lane] = entry.endMinute;
        clusterEnd = Math.max(clusterEnd, entry.endMinute);
        cluster.push(out.length);
        out.push({ entry, lane, lanes: laneEnds.length });
    }

    if (cluster.length) {
        closeCluster();
    }

    return out;
}

/**
 * Past, now or still to come, from the TENANT's minute.
 *
 * The caller's `minuteNow` is the server's tenant-local minute plus the seconds
 * since it was fetched, never a bare device clock: a display left running for a
 * term would otherwise grey out a Session because the machine behind the screen
 * disagrees with the institution about what time it is.
 */
export function roomPlanEntryPhase(entry: RoomPlanEntry, minuteNow: number): 'past' | 'now' | 'future' {
    if (entry.endMinute <= minuteNow) {
        return 'past';
    }

    return entry.startMinute <= minuteNow ? 'now' : 'future';
}

/** Pixels from the top of the plan, and the height, at a constant scale. */
export function roomPlanPlacement(
    entry: RoomPlanEntry,
    window: RoomPlanWindow,
    hourHeight: number,
): { top: number; height: number } {
    const perMinute = hourHeight / 60;
    const minutes = Math.max(MIN_ENTRY_MINUTES, entry.endMinute - entry.startMinute);

    return {
        top: (entry.startMinute - window.startMinute) * perMinute,
        height: minutes * perMinute,
    };
}

/**
 * Where the now line goes, or null when now is outside the drawn day.
 *
 * NULL RATHER THAN CLAMPED: a line pinned to the top edge at 06:00 would claim
 * the day had started, and the same line at the bottom edge all evening would
 * claim it was still ending. Absent is the honest answer, and the header's
 * clock is what says what time it is.
 */
export function roomPlanNowOffset(minuteNow: number, window: RoomPlanWindow, hourHeight: number): number | null {
    if (minuteNow < window.startMinute || minuteNow > window.endMinute) {
        return null;
    }

    return (minuteNow - window.startMinute) * (hourHeight / 60);
}

/**
 * One Session as the room plan draws it: `GET /api/screens/board`'s entry
 * shape, declared here rather than in the component so the page that fetches
 * it and the component that draws it cannot describe it differently. Extending
 * `RoomPlanEntry` is what makes it placeable by every function above.
 */
export interface RoomPlanSession extends RoomPlanEntry {
    id: string;
    title: string;
    /** Tenant-managed SessionKind key: open vocabulary, never matched on. */
    kind: string;
    groups: string[];
    lecturers: string[];
    /** Issue #30: who is actually there, if it is not the lecturer named above. */
    coveringLecturer: string | null;
}

export interface RoomPlanRoom {
    id: string;
    name: string;
    isVirtual: boolean;
    entries: RoomPlanSession[];
}
