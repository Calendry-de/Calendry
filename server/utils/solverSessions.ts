import type { Session as WireSession } from '@calendry-de/calendry-proto';
import { MAX_WIRE_ROOMS_PER_SESSION } from '../../shared/solverBudget';

/**
 * Stage 3c — already-placed Sessions.
 *
 * EVERY Session in the term goes over the wire, not just the ones being
 * re-placed: locked Sessions, past Sessions and out-of-scope Sessions are all
 * occupancy the solver must respect. Sending only the in-scope ones would let
 * it place a lecture on top of a locked one and report no violation, because
 * from its side the slot was empty.
 *
 * Scope membership is NOT expressed here — it travels in `SolveScope`. The only
 * per-Session flag is `is_locked`, which the proto describes as absolute: never
 * relaxed, distinct from merely being out of scope.
 */

/** Shape this needs from Prisma. Kept explicit so the query and the mapper agree. */
export interface AppSessionRow {
    id: string;
    /**
     * Nullable since Stage 7c, like Room/Equipment/Offering: exactly one of
     * these is set, enforced by the `session_one_owner` CHECK. A
     * federation-owned Session is a shared event no member tenant owns.
     */
    tenantId: string | null;
    federationId?: string | null;
    /**
     * NULL for an EVENT — a Session with no recurring demand behind it
     * (TAXONOMY.md §2). See `toWireSession` for what that means on the wire.
     */
    offeringId: string | null;
    kindId: string;
    termWeek: number;
    dayOfWeek: number;
    blockIndex: number;
    durationBlocks: number;
    isLocked: boolean;
    /** Resolved kind KEY, not the id — the wire carries tenant vocabulary. */
    kindKey: string;
    roomIds: string[];
    /** People holding the tenant's `lecturer` role on this Session. */
    lecturerIds: string[];
    /** Everyone else directly assigned. */
    personIds: string[];
    groupIds: string[];
}

/**
 * THE OFF-BY-ONE. `Session.termWeek` is 1-BASED ("1-based week within the
 * Term", schema.prisma). The wire `SlotRef.week` is a 0-BASED INDEX into
 * `AcademicCalendar.weeks`. Every Session shifts by one, in this one place.
 *
 * Getting it wrong does not crash: it silently moves the entire timetable a
 * week, which still renders as a perfectly plausible schedule. Asserted in
 * tests rather than trusted.
 */
export function toWireWeek(termWeek: number): number {
    return termWeek - 1;
}

/** And back, for reading solver output in Stage 5. */
export function fromWireWeek(week: number): number {
    return week + 1;
}

/*
 * NO `as WireSession` ON THE RETURN, deliberately — see the same note on
 * `rooms` in solverInput.ts. The cast this replaces asserted the shape instead
 * of checking it, so v0.10.0's new `room_ids` compiled clean and threw
 * "roomIds is not iterable" from `Session.encode` at runtime.
 */
export function toWireSession(row: AppSessionRow): WireSession {
    return {
        id: row.id,
        // The oneof owner is now a real choice: tenant-owned or shared.
        tenantId: row.tenantId ?? '',
        federationId: row.federationId ?? '',
        /**
         * An EVENT has no Offering. The wire field is a plain string, so the
         * empty string is what "no offering" looks like to the solver — the
         * same convention `tenantId`/`federationId`/`roomId` already use above.
         *
         * The solver never places an Event: it has no Offering, so no demand
         * references it and nothing asks for it to be scheduled. It arrives
         * purely as OCCUPANCY — a room and a slot that are already taken — which
         * is exactly the role `existingSessions` documents for federation-owned
         * Sessions.
         */
        offeringId: row.offeringId ?? '',
        kind: row.kindKey,
        startSlot: {
            week: toWireWeek(row.termWeek),
            day: row.dayOfWeek,
            block: row.blockIndex,
        },
        durationBlocks: row.durationBlocks,
        // A Session may have several rooms in the app's join table but the wire
        // carries one. The first is sent and the rest are reported as dropped by
        // the caller rather than silently discarded here.
        roomId: row.roomIds[0] ?? '',
        /*
         * EMPTY FOR AN ORDINARY SESSION, and that is the wire's own convention
         * rather than a withheld value: `room_id` above is already the complete
         * answer for one Room, so a one-element echo here would be redundant
         * duplication. `partition_sessions` reads this as the AUTHORITATIVE set
         * when non-empty and derives its extras by filtering out `room_id`.
         *
         * Sent in full for a genuine multi-Room Session, which is the gap this
         * closes: the solver used to reason about a Session occupying less room
         * than it really did, and would happily place something else in the Room
         * the app had dropped.
         */
        roomIds: row.roomIds.length > 1 ? row.roomIds : [],
        lecturerIds: row.lecturerIds,
        groupIds: row.groupIds,
        personIds: row.personIds,
        /**
         * A federation-shared Session is ALWAYS immovable to a member tenant.
         *
         * The RLS write policy already refuses to let this tenant change it, so
         * a solver that "moved" one would produce a placement the app could
         * never apply — and `materializeGeneration` would then either fail or,
         * worse, silently skip it. Sending it locked makes the constraint the
         * solver reasons with match the constraint the database enforces.
         *
         * The proto anticipates exactly this: existingSessions is documented as
         * carrying "Federation-owned Sessions that act purely as occupancy".
         */
        /**
         * Immovable in two cases, for the same underlying reason: the app could
         * not apply a move the solver proposed.
         *
         *  - a federation-shared Session (`tenantId === null`) — RLS refuses
         *    the write;
         *  - an EVENT (`offeringId === null`) — it is in no solve's scope, so
         *    `planMaterialization()` would never write the placement back, and
         *    a solver that moved it would be reasoning about a timetable the
         *    apply then silently declines to produce.
         *
         * Sending both locked makes the constraint the solver reasons with match
         * the constraint the app actually enforces.
         */
        isLocked: row.isLocked || row.tenantId === null || row.offeringId === null,
    };
}

/**
 * Sessions carrying more Rooms than the wire can express.
 *
 * THE REPORT MOVED RATHER THAN RETIRED. This replaced `multiRoomSessionIds`,
 * which named every Session with more than one Room, because that gap is now
 * closed — `Session.room_ids` carries the full set and the solver honours it.
 *
 * The reason to report has narrowed to the cap: `convert.rs` keeps `room_id`
 * plus `MAX_ADDITIONAL_ROOMS` extras and TRUNCATES the rest, warn-and-allow,
 * with nothing on the wire saying it did. Truncation puts the solver back to
 * reasoning about a Session that occupies less Room than it really does — the
 * exact failure the plural field exists to fix — so the app names it here or
 * nobody ever learns of it.
 */
export function sessionsOverRoomCap(rows: AppSessionRow[]): string[] {
    return rows.filter((row) => row.roomIds.length > MAX_WIRE_ROOMS_PER_SESSION).map((row) => row.id);
}
