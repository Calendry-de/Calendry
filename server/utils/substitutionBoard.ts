import type { Prisma, SessionEventType } from '@prisma/client';
import { addDays, isoDate, isoWeekday, weekIndexOf } from '../../shared/academicCalendar';
import { LECTURER_ROLE_KEY } from '../../shared/roles';
import type { BlockGrid } from '../../shared/timeGrid';
import { blockSpan } from '../../shared/timeGrid';
import { descendantGroupIds } from './groupClosure';
import type { Tx } from './tenantDb';

/**
 * The Vertretungsplan (issue #31): what changed about a day's lessons, as
 * opposed to what the day's lessons are.
 *
 * WHY IT READS THREE SOURCES AND NOT THE TIMETABLE. A substitution board is a
 * DIFF, and the three ways this app records one are three different tables:
 *
 *  1. COVERED — a `session_substitution` row. An overlay on one occurrence,
 *     deliberately not an edit of `session_person` (issue #30), which is what
 *     makes "Frau Müller's lesson, covered by Herr Schmidt" expressible at all.
 *     The ticket is explicit that reading edited lecturer assignments instead
 *     would make this display the only place the distinction between "covered"
 *     and "reassigned" is visible, which is backwards.
 *  2. CANCELLED — a `BANK` event (issue #22). Banking NULLS the placement, so
 *     the day the lesson was on survives ONLY in the event's payload. There is
 *     no other record of it, and a query over `session` alone cannot see a
 *     cancellation at all.
 *  3. MOVED — a `MOVE` event, whose payload carries both ends. A lesson moved
 *     onto today is already in the timetable at its new slot; what the board
 *     adds is that it is not where anybody expects it.
 *
 * WHY THE LATEST EVENT PER SESSION, not every event. A lesson banked and then
 * restored is not cancelled; one moved twice is at its second destination. The
 * log is append-only, so "what happened to this lesson" is the last entry, and
 * reducing to it before interpreting is what keeps a busy week's history from
 * reading as a hundred separate announcements.
 */

/** ISO weekday plus the clock range a placement occupies. Null grid = unknown. */
export interface SlotSpan {
    isoWeekday: number;
    blockIndex: number;
    startMinute: number;
    endMinute: number;
}

export type SubstitutionChange = 'covered' | 'cancelled' | 'moved-in' | 'moved-away';

export interface SubstitutionEntry {
    /** The Session this is about. Stable, so a client can key on it. */
    sessionId: string;
    change: SubstitutionChange;
    title: string;
    kind: string;
    groups: string[];
    rooms: string[];
    /**
     * Who was down to teach it: the people attached with the tenant's
     * `lecturer` Role. Never emptied by a substitution, which is the point of
     * the overlay.
     */
    originalLecturers: string[];
    /** Who is covering, when a `session_substitution` row exists. */
    coveringLecturer: string | null;
    reason: string | null;
    /** Where the lesson sits on THIS day, absent for one that has left it. */
    slot: SlotSpan | null;
    /** Where it was before, for a move or a cancellation. */
    movedFrom: SlotSpan | null;
    /** Where it went, for a lesson that has left this day. */
    movedTo: SlotSpan | null;
    /**
     * Decided SERVER-side, from the same clock that chose the term week, and
     * only ever true for today. A display left running for a term would
     * otherwise drift against the schedule it draws with nothing on screen to
     * say so.
     */
    isNow: boolean;
}

/**
 * Why a day has nothing to show. EVERY ONE OF THESE IS NAMED, and that is the
 * requirement rather than a nicety: a day with no substitutions is the COMMON
 * case, and an empty list rendered as emptiness is indistinguishable from a
 * fetch that failed (CLAUDE.md, "If 'no data' and 'fetch failed' render
 * identically, the bug is invisible"). The room board learned this the
 * expensive way, returning `rooms: []` between terms and looking broken for two
 * months of the year.
 */
export type DayState =
    /** Substitutions exist and are listed. */
    | 'ok'
    /** A teaching day, in a running term, with nothing changed. The common case. */
    | 'no-substitutions'
    /** No Term covers this date: the summer between two, or a gap. */
    | 'no-term'
    /** In a Term, but not a day the TimeGrid teaches on: a weekend. */
    | 'not-a-teaching-day';

export interface SubstitutionDay {
    /** Tenant-local calendar date, `YYYY-MM-DD`. */
    date: string;
    isoWeekday: number;
    /** 0 = today, 1 = tomorrow. What the caption says, without date arithmetic. */
    offset: number;
    state: DayState;
    termName: string | null;
    entries: SubstitutionEntry[];
}

export interface SubstitutionPayload {
    /**
     * ALWAYS TWO DAYS, today and tomorrow, each with its own named state.
     *
     * THE WINDOW IS A DECISION, not a default. German schools post both halves
     * and "tomorrow" is the one people stop to read, because it is the only
     * half they can still act on: a pupil learning at 08:05 that period 1 is
     * cancelled has learned it too late, and a lecturer learning at 16:00 that
     * they are covering period 2 tomorrow has learned it in time. Today alone
     * would also make the board go quiet every afternoon, when the day's
     * changes are spent, at exactly the hour the corridor is busiest.
     *
     * Both days are always PRESENT even when both are empty, so "tomorrow is a
     * Saturday" and "the fetch only returned one day" cannot look alike.
     */
    days: SubstitutionDay[];
}

/** How many days ahead the board shows, today inclusive. See `days` above. */
export const SUBSTITUTION_WINDOW_DAYS = 2;

/**
 * The Group scope, expanded DOWN the nesting closure.
 *
 * EMPTY IN, EMPTY OUT, and empty means EVERY group (fail-open, matching
 * `screen_room` and `group_term`). The expansion direction is the subtlety:
 * attendance flows DOWN (TAXONOMY.md §6), so a board scoped to "Jahrgang 7"
 * must show the Sessions of every class beneath it. `conflictGroupIds()` would
 * additionally drag in every ANCESTOR and put the whole school's substitutions
 * on a year group's wall.
 */
export async function expandScreenGroupScope(tx: Tx, groupIds: string[]): Promise<string[]> {
    return groupIds.length ? descendantGroupIds(tx, groupIds) : [];
}

/** A placement as an event payload records it. Every field may be absent. */
interface PlacementSnapshot {
    termId: string | null;
    termWeek: number | null;
    dayOfWeek: number | null;
    blockIndex: number | null;
    durationBlocks: number | null;
}

/**
 * One end of a `MOVE`/`BANK` payload, or null when it is not a placement.
 *
 * NARROWED RATHER THAN CAST. `payload` is a `Json` column, so its type is
 * genuinely unknown at the boundary (CLAUDE.md: a JSON column is typed
 * `unknown` and narrowed immediately). An `as` here would turn a payload
 * written by an older version of `move.post.ts` into a confident wrong answer
 * instead of a skipped entry.
 */
function placementAt(payload: Prisma.JsonValue, key: 'from' | 'to'): PlacementSnapshot | null {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return null;
    }

    const side: unknown = (payload as Record<string, unknown>)[key];

    if (typeof side !== 'object' || side === null || Array.isArray(side)) {
        return null;
    }

    const record = side as Record<string, unknown>;
    const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);

    return {
        termId: typeof record.termId === 'string' ? record.termId : null,
        termWeek: num(record.termWeek),
        dayOfWeek: num(record.dayOfWeek),
        blockIndex: num(record.blockIndex),
        durationBlocks: num(record.durationBlocks),
    };
}

/** Does a payload placement land on this exact (term, week, weekday)? */
function isOnDay(
    placement: PlacementSnapshot | null,
    day: { termId: string; termWeek: number; dayOfWeek: number },
): boolean {
    if (!placement || placement.termWeek === null || placement.dayOfWeek === null) {
        return false;
    }

    // `termId` is compared only when the payload carries one: it always does
    // today (`placementOf` writes it), and a payload predating that field must
    // not be silently dropped from a board it belongs on.
    if (placement.termId !== null && placement.termId !== day.termId) {
        return false;
    }

    return placement.termWeek === day.termWeek && placement.dayOfWeek === day.dayOfWeek;
}

/** The blocks a grid gives a span, or null when the grid cannot place it. */
function spanOf(
    grid: BlockGrid,
    placement: { blockIndex: number | null; durationBlocks: number | null; dayOfWeek: number | null },
): SlotSpan | null {
    if (placement.blockIndex === null || placement.dayOfWeek === null) {
        return null;
    }

    const duration = placement.durationBlocks ?? 1;
    const first = blockSpan(grid, placement.blockIndex, placement.dayOfWeek);
    const last = blockSpan(grid, placement.blockIndex + duration - 1, placement.dayOfWeek);

    return {
        isoWeekday: placement.dayOfWeek,
        blockIndex: placement.blockIndex,
        startMinute: first.start,
        endMinute: last.end,
    };
}

/** Ranked so a lesson that is BOTH covered and moved reports the larger fact. */
const CHANGE_RANK: Record<SubstitutionChange, number> = {
    cancelled: 3,
    'moved-away': 2,
    'moved-in': 1,
    covered: 0,
};

const CHANGE_EVENT_TYPES: SessionEventType[] = ['MOVE', 'BANK'];

type SessionForBoard = Prisma.SessionGetPayload<{
    include: {
        offering: { select: { title: true } };
        kind: { select: { key: true; name: true } };
        substitution: { include: { coveringPerson: { select: { givenName: true; familyName: true } } } };
        rooms: { include: { room: { select: { name: true } } } };
        groups: { select: { groupId: true; group: { select: { name: true } } } };
        people: { select: { roleId: true; person: { select: { givenName: true; familyName: true } } } };
    };
}>;

const SESSION_INCLUDE = {
    offering: { select: { title: true } },
    kind: { select: { key: true, name: true } },
    substitution: { include: { coveringPerson: { select: { givenName: true, familyName: true } } } },
    rooms: { include: { room: { select: { name: true } } } },
    groups: { select: { groupId: true, group: { select: { name: true } } } },
    people: { select: { roleId: true, person: { select: { givenName: true, familyName: true } } } },
} as const;

function personName(person: { givenName: string; familyName: string }): string {
    return `${person.givenName} ${person.familyName}`.trim();
}

export interface SubstitutionBoardOptions {
    tenantId: string;
    /** Already expanded through the closure. EMPTY MEANS EVERY GROUP. */
    scopedGroupIds: string[];
    /** UTC-midnight Date of the tenant's local calendar day. */
    localDate: Date;
    /** Minutes since tenant-local midnight, for `isNow`. */
    localMinutes: number;
}

export async function buildSubstitutionPayload(
    tx: Tx,
    options: SubstitutionBoardOptions,
): Promise<SubstitutionPayload> {
    /*
     * Resolved ONCE for the whole window rather than per entry: `lecturer` is
     * the single Role key this repo is allowed to know (shared/roles.ts,
     * `isSystem`), and a tenant that has never provisioned one simply has no
     * lecturer names to print. Absent is answered with an empty list, never
     * with "every attached Person", which would put a class's pupils on the
     * wall under the heading "instead of".
     */
    const lecturerRole = await tx.role.findFirst({
        where: { tenantId: options.tenantId, key: LECTURER_ROLE_KEY },
        select: { id: true },
    });

    const days: SubstitutionDay[] = [];

    for (let offset = 0; offset < SUBSTITUTION_WINDOW_DAYS; offset += 1) {
        days.push(await buildDay(tx, options, {
            offset,
            date: addDays(options.localDate, offset),
            lecturerRoleId: lecturerRole?.id ?? null,
        }));
    }

    return { days };
}

async function buildDay(
    tx: Tx,
    options: SubstitutionBoardOptions,
    day: { offset: number; date: Date; lecturerRoleId: string | null },
): Promise<SubstitutionDay> {
    const dayOfWeek = isoWeekday(day.date);
    const base = { date: isoDate(day.date), isoWeekday: dayOfWeek, offset: day.offset };

    /*
     * Resolved PER DAY, not once for the window. Tomorrow can legitimately be
     * in a different Term (or in none) when today is the last day of one, and
     * carrying today's Term across the boundary would date tomorrow's week
     * number against the wrong start.
     *
     * Date-only columns compare against the tenant-local calendar day, so the
     * first and last days of a Term count as inside it in the institution's
     * own zone.
     */
    const term = await tx.term.findFirst({
        where: { startDate: { lte: day.date }, endDate: { gte: day.date } },
        include: { timeGrid: { include: { breaks: true } } },
        orderBy: { startDate: 'asc' },
    });

    if (!term?.timeGrid) {
        return { ...base, state: 'no-term', termName: term?.name ?? null, entries: [] };
    }

    const grid = term.timeGrid;

    if (!grid.activeDays.includes(dayOfWeek)) {
        /*
         * A Saturday inside a running term. NAMED rather than reported as "no
         * substitutions", which would be true and misleading: a board that says
         * "nothing changed today" on a day with no lessons invites somebody to
         * conclude the plan is broken when Monday's changes fail to appear.
         */
        return { ...base, state: 'not-a-teaching-day', termName: term.name, entries: [] };
    }

    // `weekIndexOf` is 0-based; `session.term_week` is 1-based.
    const termWeek = weekIndexOf(term.startDate, day.date) + 1;
    const slotKey = { termId: term.id, termWeek, dayOfWeek };

    const entries = new Map<string, SubstitutionEntry>();
    const inScope = (session: SessionForBoard): boolean => options.scopedGroupIds.length === 0
        || session.groups.some((link) => options.scopedGroupIds.includes(link.groupId));

    const record = (entry: SubstitutionEntry): void => {
        const existing = entries.get(entry.sessionId);

        if (!existing) {
            entries.set(entry.sessionId, entry);

            return;
        }

        /*
         * One row per lesson, never two. A Session can be BOTH covered and
         * moved, and a board printing it twice reads as two separate changes to
         * two separate lessons. The larger fact wins the headline
         * (`CHANGE_RANK`) and the smaller one is merged into the same row, so
         * "moved to period 4, covered by Herr Schmidt" stays one announcement.
         */
        const winner = CHANGE_RANK[entry.change] > CHANGE_RANK[existing.change] ? entry : existing;
        const other = winner === entry ? existing : entry;

        entries.set(entry.sessionId, {
            ...winner,
            coveringLecturer: winner.coveringLecturer ?? other.coveringLecturer,
            reason: winner.reason ?? other.reason,
            movedFrom: winner.movedFrom ?? other.movedFrom,
            movedTo: winner.movedTo ?? other.movedTo,
            slot: winner.slot ?? other.slot,
        });
    };

    const describe = (session: SessionForBoard) => ({
        sessionId: session.id,
        title: session.offering?.title ?? session.title ?? session.kind.name,
        kind: session.kind.key,
        groups: session.groups.map((link) => link.group.name),
        rooms: session.rooms.map((link) => link.room.name),
        originalLecturers: day.lecturerRoleId === null
            ? []
            : session.people
                .filter((link) => link.roleId === day.lecturerRoleId)
                .map((link) => personName(link.person)),
        coveringLecturer: session.substitution
            ? personName(session.substitution.coveringPerson)
            : null,
        reason: session.substitution?.reason ?? null,
    });

    /** True only for today, and only inside the span. `offset > 0` is never now. */
    const nowWithin = (span: SlotSpan | null): boolean => day.offset === 0
        && span !== null
        && options.localMinutes >= span.startMinute
        && options.localMinutes < span.endMinute;

    // --- 1. COVERED -------------------------------------------------------
    const covered = await tx.session.findMany({
        where: { termId: term.id, termWeek, dayOfWeek, substitution: { isNot: null } },
        include: SESSION_INCLUDE,
    });

    for (const session of covered) {
        if (!inScope(session)) {
            continue;
        }

        const slot = spanOf(grid, session);

        record({
            ...describe(session),
            change: 'covered',
            slot,
            movedFrom: null,
            movedTo: null,
            isNow: nowWithin(slot),
        });
    }

    /*
     * --- 2 & 3. CANCELLED AND MOVED ---------------------------------------
     *
     * ONE QUERY AND ONE REDUCE for both, because they are the same question:
     * what last happened to this lesson. Fetching them separately would let a
     * Session banked and then re-placed appear as cancelled, since its BANK
     * event is still in the log and always will be.
     *
     * BOUNDED BY THE TERM, in the relational `where`, rather than by a JSON
     * path match on the payload. A JSON filter would be cheaper and is exactly
     * the guard CLAUDE.md warns about: "a condition that can both correctly
     * find nothing and match nothing because of a bug." The day match is done
     * below in TypeScript, where a payload shape that has drifted is a skipped
     * entry with a readable cause rather than a silently empty board.
     */
    const events = await tx.sessionEvent.findMany({
        where: { type: { in: CHANGE_EVENT_TYPES }, session: { termId: term.id } },
        orderBy: [{ createdAt: 'desc' }, { seq: 'desc' }],
        select: { type: true, payload: true, sessionId: true, reason: true },
    });

    const latest = new Map<string, (typeof events)[number]>();

    for (const event of events) {
        if (event.sessionId !== null && !latest.has(event.sessionId)) {
            latest.set(event.sessionId, event);
        }
    }

    const changedIds = [...latest.keys()];
    const changed = changedIds.length
        ? await tx.session.findMany({ where: { id: { in: changedIds } }, include: SESSION_INCLUDE })
        : [];

    for (const session of changed) {
        const event = latest.get(session.id);

        if (!event || !inScope(session)) {
            continue;
        }

        const detail = describe(session);
        const from = placementAt(event.payload, 'from');
        const wasHere = isOnDay(from, slotKey);
        const movedFrom = from ? spanOf(grid, from) : null;

        if (event.type === 'BANK') {
            /*
             * A cancellation only counts while the lesson is still banked: a
             * BANK followed by a MOVE is a restoration, and the MOVE is what
             * `latest` holds in that case, so reaching here already means the
             * bank is the last word. `termWeek === null` re-checks the row
             * itself, because the two could only disagree if something wrote
             * around the event log.
             */
            if (wasHere && session.termWeek === null) {
                record({
                    ...detail,
                    // THE EVENT'S reason, not the substitution's: "why is this
                    // lesson not happening" is what the person who cancelled it
                    // typed, and a stale substitution note on a cancelled
                    // lesson would answer a question nobody asked.
                    reason: event.reason ?? detail.reason,
                    change: 'cancelled',
                    slot: movedFrom,
                    movedFrom,
                    movedTo: null,
                    isNow: nowWithin(movedFrom),
                });
            }

            continue;
        }

        const to = placementAt(event.payload, 'to');
        const isHereNow = isOnDay(to, slotKey);
        const movedTo = to ? spanOf(grid, to) : null;

        if (isHereNow) {
            // Arrived on this day, INCLUDING a move within it: a lesson shifted
            // from period 1 to period 4 is the single most common entry on a
            // real Vertretungsplan, and both ends are on the same date.
            record({
                ...detail,
                reason: event.reason ?? detail.reason,
                change: 'moved-in',
                slot: movedTo,
                movedFrom,
                movedTo: null,
                isNow: nowWithin(movedTo),
            });
        } else if (wasHere) {
            record({
                ...detail,
                reason: event.reason ?? detail.reason,
                change: 'moved-away',
                slot: null,
                movedFrom,
                movedTo,
                isNow: false,
            });
        }
    }

    const rows = [...entries.values()].sort((a, b) => {
        const left = a.slot?.startMinute ?? a.movedFrom?.startMinute ?? 0;
        const right = b.slot?.startMinute ?? b.movedFrom?.startMinute ?? 0;

        return left - right || a.title.localeCompare(b.title);
    });

    return {
        ...base,
        // The NAMED empty state, and the one this board exists to get right: a
        // day with no substitutions is the normal outcome, so it says so
        // instead of returning a list nobody can distinguish from a failure.
        state: rows.length ? 'ok' : 'no-substitutions',
        termName: term.name,
        entries: rows,
    };
}
