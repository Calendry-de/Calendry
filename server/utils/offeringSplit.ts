/**
 * Wire identity for a per-group Offering series.
 *
 * WHY THIS EXISTS
 * ---------------
 * An Offering carrying TWO OR MORE Groups now means one independent Session
 * series PER GROUP, not one combined Session for the union. The solver needs no
 * change to express that: N wire Offerings are indistinguishable to it from N
 * hand-made rows, but each wire entry needs an id, and that id has to lead back
 * to `(real offering, one group)` unambiguously.
 *
 * WHY THE MAPPING IS ENCODED AND NOT HELD IN A SIDE MAP
 * ----------------------------------------------------
 * Timing. Assembly and materialization are separated by a human decision:
 * placements live in `solver_run.result` until someone applies the Generation,
 * which can be days later and across a restart. A side map would have to be
 * persisted alongside and could go missing, and the failure would be silent:
 * every placement unmappable, nothing written.
 *
 * A self-describing id survives persistence with no extra state, and the same
 * string that went out comes back in `PlacedSession.offering_id` and in
 * `ConstraintViolation.offering_ids`.
 *
 * This is the same class of risk as the tracked "violations naming Sessions the
 * solver invented" gap: a wire-level identity that must reverse. So reversal
 * happens in exactly ONE place, `parseWireOfferingId`, and anything that
 * fails to reverse is COUNTED, never quietly dropped.
 */

/**
 * Separator between the real Offering id and the Group id.
 *
 * Two colons because neither uuid7 nor this codebase's seeded ids
 * (`…-room-A101`, `…-class-A`) can contain one, so an unsplit id can never be
 * mistaken for a split one, which is what makes the round trip total rather
 * than merely usual.
 */
const SPLIT = '::';

export function wireOfferingId(offeringId: string, groupId: string): string {
    return `${offeringId}${SPLIT}${groupId}`;
}

export interface ParsedWireOfferingId {
    /** The real `offering.id`, always. */
    offeringId: string;
    /** The single Group this series is for, or null when the id was not split. */
    groupId: string | null;
    /**
     * The id carried more than one separator, so it cannot be reversed with
     * confidence. Reported rather than guessed: picking a side would attach
     * placements to the wrong Offering silently.
     */
    ambiguous: boolean;
}

export function parseWireOfferingId(wireId: string): ParsedWireOfferingId {
    const parts = wireId.split(SPLIT);

    if (parts.length === 1) {
        // An unsplit id reverses to itself. This is the identity case, and it
        // is why single-group and zero-group Offerings need no special handling
        // anywhere downstream.
        return { offeringId: wireId, groupId: null, ambiguous: false };
    }

    if (parts.length === 2) {
        return { offeringId: parts[0]!, groupId: parts[1]!, ambiguous: false };
    }

    return { offeringId: parts[0]!, groupId: null, ambiguous: true };
}

/** Whether this Offering's Groups make it a multi-series Offering. */
export function splitsIntoSeries(groupIds: string[]): boolean {
    return groupIds.length >= 2;
}
