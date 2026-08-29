import { LockPolicy, SolveScope } from '@mindcollaps/calendry-proto';
import { createHash } from 'node:crypto';
import { REPAIR_MOVEMENT_WEIGHT } from '../../shared/solverMode';
import type { SolverMode } from '../../shared/solverMode';

/**
 * Turning a requested mode into the scope a run is stored with and sent with.
 *
 * PURE, AND SEPARATE FROM THE ROUTE, because it is where three things that look
 * independent have to stay consistent: which Offerings are in scope, which lock
 * policy governs everything else, and what a disturbance costs. Deriving them
 * inline meant `LOCK_POLICY_HARD` was written twice — once into the stored JSON
 * and once onto the wire — with nothing to notice if only one changed.
 */

/**
 * What `solver_run.scope` holds. A JSON column, so widening it is not a
 * migration; every existing reader takes `offeringIds` off it structurally and
 * is unaffected by the fields added here.
 */
export interface StoredScope {
    mode: SolverMode;
    /**
     * TWO SCOPES, and they are not interchangeable. `offeringIds` are REAL
     * database ids, compared later against `session.offering_id` by
     * `planMaterialization`. `wireOfferingIds` are what the SOLVER is told,
     * which for a split multi-group Offering are synthetic `offering::group`
     * ids.
     *
     * One list for both breaks in one direction or the other: wire ids stored
     * means no existing Session is ever in scope and nothing is deleted; real
     * ids sent means the split series are out of scope and nothing is placed.
     */
    offeringIds: string[];
    wireOfferingIds: string[];
    groupIds: string[];
    outsideScopePolicy: 'LOCK_POLICY_HARD' | 'LOCK_POLICY_MINIMIZE_MOVEMENT';
    minimizeMovementWeight: number;
}

export function resolveScope(options: {
    mode: SolverMode;
    /** Explicit narrowing from the caller. Absent is NOT the same as empty. */
    offeringIds?: string[];
    groupIds?: string[];
    /** Everything the assembled snapshot could place, in both languages. */
    assembled: { real: string[]; wire: string[] };
}): StoredScope {
    const { mode, offeringIds, groupIds, assembled } = options;

    /**
     * THE DEFAULT IS THE MODE. Omitting `offeringIds` means "everything" for a
     * rebuild and "nothing" for a repair, and those are the same sentence read
     * from either end: a rebuild places the whole term, a repair places nothing
     * and merely stops the term being illegal.
     *
     * An explicitly empty list is honoured as empty in both modes — `[] ?? x`
     * is `[]`, not `x` — so a caller can ask for a pure repair by name.
     */
    const fallback = mode === 'repair' ? { real: [], wire: [] } : assembled;

    return {
        mode,
        offeringIds: offeringIds ?? fallback.real,
        wireOfferingIds: offeringIds ?? fallback.wire,
        groupIds: groupIds ?? [],
        outsideScopePolicy: mode === 'repair'
            ? 'LOCK_POLICY_MINIMIZE_MOVEMENT'
            : 'LOCK_POLICY_HARD',
        // Sent as 0 under LOCK_POLICY_HARD, where the solver ignores it. Zero is
        // a legitimate value of this field ("track disturbance, do not steer"),
        // not a stand-in for absent — the proto is deliberate about that.
        minimizeMovementWeight: mode === 'repair' ? REPAIR_MOVEMENT_WEIGHT : 0,
    };
}

/** The stored scope as the solver's own message. Wire ids, never real ones. */
export function toWireScope(scope: StoredScope): SolveScope {
    return {
        offeringIds: scope.wireOfferingIds,
        groupIds: scope.groupIds,
        outsideScopePolicy: scope.outsideScopePolicy === 'LOCK_POLICY_MINIMIZE_MOVEMENT'
            ? LockPolicy.LOCK_POLICY_MINIMIZE_MOVEMENT
            : LockPolicy.LOCK_POLICY_HARD,
        minimizeMovementWeight: scope.minimizeMovementWeight,
    };
}

/**
 * Hash of the ENCODED scope, mirroring `hashInput` for the same reason: two
 * scopes that encode identically are the same request to the solver.
 *
 * WHY THE IDEMPOTENCY KEY NEEDS THIS AT ALL. The key was `<inputHash>:<seed>`,
 * and the input hash covers `SolverInput` — which does NOT carry the scope.
 * That held only while every run sent the same scope, which was true until a
 * repair existed. Without this, a rebuild and a repair of one unchanged term at
 * the same seed are the same key, and the solver's in-memory registry replays
 * the rebuild's answer for the repair. The user clicks "fix this clash" and is
 * handed a full rewrite of the term.
 */
export function hashScope(scope: SolveScope): string {
    return createHash('sha256').update(SolveScope.encode(scope).finish()).digest('hex');
}
