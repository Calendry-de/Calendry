/**
 * WHICH ROOMS AN OFFERING MAY USE — the one place the two narrowings compose.
 *
 * Issue #123 landed two asks that resolve to the same question, and they write
 * the SAME wire field (`Offering.allowed_room_ids`):
 *
 *   A. a ROOM PIN (`offering_room`): "only these Rooms may host it";
 *   B. `Offering.onlineMode = REQUIRED`: "this must happen online", which the
 *      proto cannot state directly and which is therefore expressed as an
 *      allow-list of the tenant's virtual Rooms.
 *
 * THE TWO COMPOSITION RULES LIVE HERE, AND NOWHERE ELSE:
 *
 *   1. REQUIRED **plus** an explicit pin list INTERSECT. Not "pin wins", not
 *      "online wins". An Offering pinned to two lecture halls and marked
 *      required-online is a contradiction the administrator typed, and the
 *      honest answer is an empty intersection, not a silent choice between the
 *      two things they said.
 *
 *   2. AN EMPTY RESULT IS AN ERROR, NEVER AN EMPTY WIRE LIST. Empty means "any
 *      eligible Room" on the wire, so the naive mapping turns "must be online"
 *      into "anywhere at all" and places every Session in a physical room with
 *      nobody told. This is the sharpest trap in the feature and the exact
 *      shape CLAUDE.md names: "no data" and "fetch failed" rendering
 *      identically. An unsatisfiable restriction ships as
 *      `[NO_ELIGIBLE_ROOM_ID]` — a non-empty list matching no Room — so the
 *      solver returns the Offering unplaced, and the caller REPORTS why.
 *
 * IN ITS OWN MODULE, not inside `solverInput.ts`, because `violations.ts` has
 * to answer the same question about a single manual placement and must not be
 * able to answer it differently. `solverInput.ts` calls this from exactly one
 * place; importing it the other way would drag the proto encoder into every
 * route that edits a Session.
 *
 * NOTHING HERE IS PERSISTED. The virtual-Room half is derived from
 * `Room.isVirtual` on EVERY run: persist it and a virtual Room created next
 * week is silently excluded from every Offering that already asked for
 * "online", which is unobservable until somebody counts placements.
 */

/** The three answers `Offering.onlineMode` has. Mirrors the Prisma enum. */
export type OnlineMode = 'FORBIDDEN' | 'ALLOWED' | 'REQUIRED';

/**
 * A wire `allowed_room_ids` entry that matches no Room, ever.
 *
 * `convert.rs` does NOT resolve the ids in `allowed_room_ids` against the sent
 * Rooms (unlike `group_ids` or `candidate_lecturer_ids`, which it refuses the
 * whole input over): an unknown id simply never matches, so the Offering ends
 * up with an empty eligible-room set and comes back as hard violations. That
 * is exactly the behaviour rule 2 wants, and it is the only way to say "no Room
 * qualifies" in a field whose empty value means the opposite.
 *
 * Room ids are UUIDv7, so this can never collide with a real one.
 */
export const NO_ELIGIBLE_ROOM_ID = '__calendry_no_eligible_room__';

/** The only two facts about a Room this resolution depends on. */
export interface RoomFacts {
    id: string;
    isVirtual: boolean;
}

/** Why a stated restriction cannot be met by any Room in the snapshot. */
export type RoomRestrictionFailure =
    /**
     * `REQUIRED` and the snapshot holds no virtual Room at all. The likeliest
     * cause in practice: nobody has created one, and "online" was set on the
     * Offering by somebody who assumed it existed.
     */
    | 'no_virtual_rooms'
    /**
     * Every pinned Room is missing from the snapshot: inactive, deleted, or
     * federation-owned and not visible to this tenant. Dropping them silently
     * would shrink the allow-list to zero, which on the wire means "any Room".
     */
    | 'pinned_rooms_absent'
    /**
     * The pinned Rooms are present but disjoint from what the online mode
     * allows: rule 1's honest answer to a contradiction.
     */
    | 'empty_intersection';

export interface ResolvedRoomRestriction {
    /**
     * Every Room a placement of this Offering may use, `null` when there is no
     * restriction at all ("any eligible Room", today's behaviour for every
     * Offering that states neither a pin nor an online mode of its own).
     *
     * DIFFERENT FROM `allowedRoomIds` in exactly one case, and deliberately:
     * `FORBIDDEN` with no pin restricts a manual placement (a virtual Room is
     * not allowed) while carrying nothing in the wire's allow-list, because the
     * wire says that with `allow_online = false` instead. `violations.ts` reads
     * this field; `solverInput.ts` reads the two below.
     */
    permittedRoomIds: string[] | null;
    /** Exactly what belongs in the wire's `Offering.allowed_room_ids`. */
    allowedRoomIds: string[];
    /** Exactly what belongs in the wire's `Offering.allow_online`. */
    allowOnline: boolean;
    /**
     * Non-null when the Offering states a restriction no sent Room satisfies.
     * `allowedRoomIds` is `[NO_ELIGIBLE_ROOM_ID]` whenever this is set: rule 2.
     */
    failure: {
        reason: RoomRestrictionFailure;
        /** Pinned Rooms actually present in the snapshot. */
        pinnedInSnapshot: number;
        /** Pinned Rooms named by the Offering, present or not. */
        pinnedStored: number;
        /** Virtual Rooms in the snapshot. */
        virtualInSnapshot: number;
    } | null;
}

export interface RoomRestrictionInput {
    onlineMode: OnlineMode;
    /** `offering_room` as stored. Empty = any eligible Room, verbatim. */
    pinnedRoomIds: readonly string[];
}

/**
 * Compose the pin and the online mode into one Room restriction.
 *
 * `sentRooms` is the snapshot the answer is about: for the solver, the Rooms
 * actually put on the wire (tenant-owned plus federation-shared, active only);
 * for `violations.ts`, the Rooms a manual placement could name. Passing a wider
 * set than the consumer will really see is the one way to get a wrong answer
 * here, which is why it is a parameter rather than a query inside.
 */
export function resolveRoomRestriction(
    offering: RoomRestrictionInput,
    sentRooms: readonly RoomFacts[],
): ResolvedRoomRestriction {
    const allowOnline = offering.onlineMode !== 'FORBIDDEN';
    const byId = new Map(sentRooms.map((room) => [room.id, room]));
    const virtualInSnapshot = sentRooms.filter((room) => room.isVirtual).length;

    /**
     * What the ONLINE MODE alone permits. `ALLOWED` adds virtual Rooms to the
     * physical ones rather than preferring either, which is what makes it a
     * permission and not an instruction.
     */
    const modeAllows = (room: RoomFacts) => {
        switch (offering.onlineMode) {
            case 'REQUIRED': return room.isVirtual;
            case 'FORBIDDEN': return !room.isVirtual;
            case 'ALLOWED': return true;
        }
    };

    // The pin, narrowed to Rooms that exist in this snapshot. Deduplicated
    // because the composite PK guarantees it in the database but not in a
    // caller-supplied list.
    const pinnedInSnapshot = [...new Set(offering.pinnedRoomIds)]
        .map((id) => byId.get(id))
        .filter((room): room is RoomFacts => room !== undefined);

    const stated = offering.pinnedRoomIds.length > 0 || offering.onlineMode === 'REQUIRED';

    // NO RESTRICTION STATED. `FORBIDDEN` still narrows what a manual placement
    // may do (no virtual Room), which is why `permittedRoomIds` is computed
    // below rather than left null for it, but the WIRE carries that as
    // `allow_online = false` and must keep sending an empty allow-list: this is
    // the case every Offering in the product was in before this feature, and
    // changing what it sends would change every existing timetable.
    if (!stated) {
        return {
            permittedRoomIds: offering.onlineMode === 'FORBIDDEN'
                ? sentRooms.filter((room) => !room.isVirtual).map((room) => room.id)
                : null,
            allowedRoomIds: [],
            allowOnline,
            failure: null,
        };
    }

    /*
     * RULE 1, and it is one line because it has to be unambiguous: a pin and a
     * required-online mode INTERSECT. `pinnedInSnapshot` is already the pin ∩
     * snapshot; filtering it by `modeAllows` is the second half. With no pin
     * (so `REQUIRED` alone), the mode's own set IS the restriction.
     */
    const permitted = (offering.pinnedRoomIds.length > 0 ? pinnedInSnapshot : sentRooms)
        .filter(modeAllows)
        .map((room) => room.id);

    if (permitted.length > 0) {
        return {
            permittedRoomIds: permitted,
            allowedRoomIds: permitted,
            allowOnline,
            failure: null,
        };
    }

    /*
     * RULE 2. The restriction is real and nothing satisfies it. The reasons are
     * distinguished because they have different fixes and the run's output
     * names none of them: create a virtual Room, reactivate the pinned Room, or
     * stop asking for two contradictory things.
     */
    const reason: RoomRestrictionFailure = offering.onlineMode === 'REQUIRED' && virtualInSnapshot === 0
        ? 'no_virtual_rooms'
        : offering.pinnedRoomIds.length > 0 && pinnedInSnapshot.length === 0
            ? 'pinned_rooms_absent'
            : 'empty_intersection';

    return {
        // Not `[]`: an empty permitted set means "no Room may host this", and
        // `null` here would mean the opposite to every reader.
        permittedRoomIds: [],
        allowedRoomIds: [NO_ELIGIBLE_ROOM_ID],
        allowOnline,
        failure: {
            reason,
            pinnedInSnapshot: pinnedInSnapshot.length,
            pinnedStored: offering.pinnedRoomIds.length,
            virtualInSnapshot,
        },
    };
}
