import type { SolverOutput } from '@calendry-de/calendry-proto';
import { parseWireOfferingId } from './offeringSplit';

/**
 * What the app ASKED the solver to place, and whether the answer covered it.
 *
 * WHY THIS EXISTS
 * ---------------
 * `planMaterialization()` reads a Session's absence from the output as a
 * decision: the solver was asked about this Offering, said nothing about this
 * Session, therefore it refused to place it, therefore the apply deletes it.
 * That inference is only sound while the output is COMPLETE: while every
 * in-scope Offering comes back carrying its full `required_session_count`.
 *
 * On 2026-09-01 it was not. A `converged` run (45.8M moves, not budget-bound)
 * against 208 in-scope wire Offerings, each asking for exactly one Session and
 * each already carrying one, returned 197 placements. The eleven Sessions the
 * solver dropped from its answer were then deleted by the apply as orphans,
 * with the event reason `not_returned_by_solver`. Every applied Generation in
 * that tenant had done the same: the delete count equalled the run's shortfall
 * exactly, run after run, 127 DELETE events deep, and each run dropped a
 * DIFFERENT set, so the next run recreated them and the timetable churned
 * forever while the Session count stayed flat.
 *
 * The solver bug is filed separately and is not fixable here. What is fixable
 * here is the inference: silence about an Offering whose answer is provably
 * short is not evidence of anything, and must not authorise a delete.
 *
 * WHY THE LEDGER IS RECORDED RATHER THAN RECOMPUTED
 * ------------------------------------------------
 * Apply happens whenever a human decides, which can be days after the run and
 * across a restart. Re-deriving "what did we ask for" from `Offering.frequency`
 * at that point would answer a question about the Offering as it is NOW, not as
 * it was sent, and an Offering whose frequency changed in between would make
 * the reconciliation silently wrong in the one direction that matters. The
 * ledger is written once by `assembleSolverInput()`, travels in
 * `solver_run.meta.report`, and is read back verbatim. Same reasoning as the
 * self-describing wire Offering id in `offeringSplit.ts`.
 */

/** One wire Offering, as it was put on the wire. */
export interface DemandEntry {
    /**
     * The id the SOLVER was given: a synthetic `offering::group` id for a
     * split multi-group Offering, the real id otherwise.
     */
    wireOfferingId: string;
    /**
     * The real `offering.id` behind it. This is what `session.offering_id`
     * carries and therefore the only id the reconciliation below can compare
     * against a database row.
     */
    offeringId: string;
    /** `Offering.required_session_count` as sent, after the banked subtraction. */
    requiredSessionCount: number;
    /** Placed Sessions sent for this series as reusable occupancy. */
    existingSessionsSent: number;
}

/** One Offering whose answer came back short. */
export interface DemandShortfall {
    required: number;
    returned: number;
}

export interface DemandReconciliation {
    /**
     * FALSE MEANS NOTHING WAS CHECKED, and it is a distinct state from "checked
     * and found complete": a run started before the ledger existed carries no
     * record of what it asked for, so its deletes can be neither justified nor
     * withheld on this evidence. `planMaterialization()` reports that count
     * separately rather than picking a side, which is the same rule
     * `isReproducible()` follows for a missing termination reason: an unknown
     * is reported as unknown, never rounded to the reassuring answer.
     */
    known: boolean;
    totalRequired: number;
    totalReturned: number;
    /**
     * Keyed by REAL Offering id, never the wire id.
     *
     * The reconciliation is deliberately per-Offering rather than per-series
     * even though the ledger is per-series: deciding which SERIES an existing
     * Session belongs to means re-deriving the split from its Groups at apply
     * time, and the Groups may have changed since the run. An Offering whose
     * answer is short in any of its series therefore protects all of its
     * Sessions: coarser, and the honest reading of "the solver returned fewer
     * placements for this Offering than were asked of it, so which of its
     * Sessions it meant to drop is not knowable".
     */
    short: Map<string, DemandShortfall>;
}

/** The empty reconciliation: nothing recorded, nothing checkable. */
function unknownDemand(): DemandReconciliation {
    return { known: false, totalRequired: 0, totalReturned: 0, short: new Map() };
}

/**
 * The ledger off a stored `solver_run.meta`, or null when the run predates it.
 *
 * `meta` is a JSON column, so this is a genuine unknown boundary and is narrowed
 * structurally rather than asserted. Anything malformed reads as absent: a
 * half-parsed ledger would under-report demand, which is exactly the direction
 * that silently authorises the deletes this whole module exists to withhold.
 */
export function demandLedgerFrom(meta: unknown): DemandEntry[] | null {
    if (typeof meta !== 'object' || meta === null || !('report' in meta)) {
        return null;
    }

    const report: unknown = (meta as { report: unknown }).report;

    if (typeof report !== 'object' || report === null || !('demand' in report)) {
        return null;
    }

    const demand: unknown = (report as { demand: unknown }).demand;

    if (!Array.isArray(demand)) {
        return null;
    }

    const entries: DemandEntry[] = [];

    for (const row of demand) {
        if (typeof row !== 'object' || row === null) {
            return null;
        }

        const candidate = row as Record<string, unknown>;

        if (
            typeof candidate.wireOfferingId !== 'string'
            || typeof candidate.offeringId !== 'string'
            || typeof candidate.requiredSessionCount !== 'number'
            || typeof candidate.existingSessionsSent !== 'number'
        ) {
            return null;
        }

        entries.push({
            wireOfferingId: candidate.wireOfferingId,
            offeringId: candidate.offeringId,
            requiredSessionCount: candidate.requiredSessionCount,
            existingSessionsSent: candidate.existingSessionsSent,
        });
    }

    return entries;
}

/**
 * What the run asked for, against what it answered.
 *
 * Counted over the placements the output actually carries, resolved to real
 * Offering ids the same way `planMaterialization()` resolves them: via
 * `parseWireOfferingId`, with an ambiguous id counting for nobody. A placement
 * naming an Offering absent from the ledger is ignored rather than credited:
 * it cannot pay off demand nothing recorded asking for.
 */
export function reconcileDemand(
    ledger: DemandEntry[] | null,
    output: Pick<SolverOutput, 'sessions'>,
): DemandReconciliation {
    if (!ledger) {
        return unknownDemand();
    }

    const required = new Map<string, number>();

    for (const entry of ledger) {
        required.set(
            entry.offeringId,
            (required.get(entry.offeringId) ?? 0) + entry.requiredSessionCount,
        );
    }

    const returned = new Map<string, number>();

    for (const placed of output.sessions) {
        const parsed = parseWireOfferingId(placed.offeringId);

        if (parsed.ambiguous || !required.has(parsed.offeringId)) {
            continue;
        }

        returned.set(parsed.offeringId, (returned.get(parsed.offeringId) ?? 0) + 1);
    }

    const short = new Map<string, DemandShortfall>();
    let totalRequired = 0;
    let totalReturned = 0;

    for (const [offeringId, count] of required) {
        const answered = returned.get(offeringId) ?? 0;

        totalRequired += count;
        totalReturned += answered;

        if (answered < count) {
            short.set(offeringId, { required: count, returned: answered });
        }
    }

    return { known: true, totalRequired, totalReturned, short };
}
