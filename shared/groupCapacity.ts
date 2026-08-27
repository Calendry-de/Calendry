/**
 * How many people an Offering's attached Groups actually represent.
 *
 * `Offering.requiredCapacity` is nullable and both the schema comment and the form
 * promised to derive it from the assigned groups. Nothing did:
 * `assembleSolverInput` mapped `requiredCapacity ?? 0` and the solver's filter is
 * `room.capacity < offering.min_capacity`, so 0 meant EVERY room qualified.
 * Measured on the demo tenant: twelve Offerings of 96 attendees, all NULL, three
 * 24-seat rooms all eligible.
 *
 * In `shared/` because the solver input (what is possible) and the Offering form
 * (what leaving the field blank will do) must not drift. Kept PURE — rows in,
 * number out.
 *
 * A UNION, NOT A SUM. Summing per-Group counts double-counts a person reachable
 * more than once, in two independent ways: membership at a leaf AND an ancestor
 * (legal data), and an Offering carrying both a Group and its own descendant — "IT
 * Security" (48) plus "dIT22 S1" (24) sums to 72 where the truth is 48. So: union
 * of every attached Group's own-plus-descendants closure, then DISTINCT people.
 */

export interface CapacityGroup {
    id: string;
    parentGroupId: string | null;
    /** Manual estimate. Only consulted when the closure holds no real members. */
    expectedSize: number | null;
}

export interface CapacityMembership {
    groupId: string;
    personId: string;
}

/** Where the number came from — shown to humans, and used in the report. */
export type CapacityBasis =
    /** Distinct people actually enrolled somewhere in the closure. */
    | 'membership'
    /** No real membership anywhere; manual estimates summed instead. */
    | 'expected_size'
    /** Neither available — the caller must not treat this as "no requirement". */
    | 'none';

export interface DerivedCapacity {
    /** NULL when nothing could be derived. Never 0-as-"unknown". */
    capacity: number | null;
    basis: CapacityBasis;
    /** Groups in the walked closure, so a UI can say what the number covers. */
    closureSize: number;
    /**
     * What the `expectedSize` fallback WOULD have produced, computed even when
     * membership wins. NULL when no attached Group carries an estimate anywhere
     * in its closure.
     *
     * Kept so the two candidate answers can be COMPARED rather than one simply
     * replacing the other — which is the whole point of `partialEnrolment`.
     */
    estimate: number | null;
    /**
     * The real roll is materially smaller than the estimate, so enrolment looks
     * incomplete and this capacity is probably too low.
     *
     * Advisory. The real count still wins — an enrolment list is a fact — but a
     * tenant should learn that "4 against an expected 96" is the basis BEFORE a
     * room turns out to be catastrophically small, not after.
     */
    partialEnrolment: boolean;
}

/**
 * How much of the expected cohort must be enrolled before the roll counts as
 * complete. A roll is always slightly short, so flagging any shortfall would train
 * people to skip the report; ten percent absorbs churn but not a data-entry gap.
 *
 * The threshold decides only WHETHER to mention it — both numbers travel, so a
 * slightly wrong threshold degrades into noise rather than silence.
 */
export const ENROLMENT_COMPLETE_RATIO = 0.9;

/** Every id in `roots` plus everything beneath them, deduplicated. */
function closureOf(roots: string[], childrenOf: Map<string, string[]>): Set<string> {
    const out = new Set<string>();
    const stack = [...roots];

    while (stack.length) {
        const id = stack.pop()!;

        // Also the cycle guard. `group_closure` is trigger-maintained and a
        // cycle should be impossible, but an unbounded walk over tenant data is
        // not something to leave to that assumption.
        if (out.has(id)) {
            continue;
        }

        out.add(id);
        stack.push(...(childrenOf.get(id) ?? []));
    }

    return out;
}

/**
 * The estimate for one Group when no real membership exists.
 *
 * Its own `expectedSize` if set; otherwise the sum of its children's estimates,
 * so a parent that carries no number but whose cohorts do still produces one.
 * Recursion cannot revisit a node because it only ever descends.
 */
function estimateOf(id: string, byId: Map<string, CapacityGroup>, childrenOf: Map<string, string[]>): number {
    const own = byId.get(id)?.expectedSize;

    if (own !== null && own !== undefined) {
        return own;
    }

    return (childrenOf.get(id) ?? []).reduce((sum, child) => sum + estimateOf(child, byId, childrenOf), 0);
}

export function deriveCapacity(
    attachedGroupIds: string[],
    groups: CapacityGroup[],
    memberships: CapacityMembership[],
): DerivedCapacity {
    if (attachedGroupIds.length === 0) {
        return { capacity: null, basis: 'none', closureSize: 0, estimate: null, partialEnrolment: false };
    }

    const byId = new Map(groups.map((g) => [g.id, g]));
    const childrenOf = new Map<string, string[]>();

    for (const group of groups) {
        if (group.parentGroupId) {
            childrenOf.set(group.parentGroupId, [...(childrenOf.get(group.parentGroupId) ?? []), group.id]);
        }
    }

    // Only ids this tenant actually has. A dangling reference must not silently
    // shrink the answer, but it also must not be walked.
    const attached = attachedGroupIds.filter((id) => byId.has(id));

    const closure = closureOf(attached, childrenOf);

    // REAL MEMBERSHIP WINS whenever it exists anywhere in the closure: an
    // enrolment list is a fact and `expectedSize` is a guess someone typed once.
    const people = new Set<string>();

    for (const link of memberships) {
        if (closure.has(link.groupId)) {
            people.add(link.personId);
        }
    }

    /**
     * Computed even when membership wins, so the two can be COMPARED: the real
     * count is still the answer, but "4 people where 96 were expected" is a fact
     * about that answer which was invisible until a room turned out too small.
     *
     * Only MAXIMAL attached Groups contribute to the estimate — one with another
     * attached Group above it is already represented by that ancestor — which is
     * the same double-count the union avoids.
     */
    const attachedSet = new Set(attached);

    const isCoveredByAnotherAttached = (id: string) => {
        let cursor = byId.get(id)?.parentGroupId ?? null;
        const seen = new Set<string>();

        while (cursor && !seen.has(cursor)) {
            if (attachedSet.has(cursor)) {
                return true;
            }

            seen.add(cursor);
            cursor = byId.get(cursor)?.parentGroupId ?? null;
        }

        return false;
    };

    const maximal = attached.filter((id) => !isCoveredByAnotherAttached(id));
    const summed = maximal.reduce((sum, id) => sum + estimateOf(id, byId, childrenOf), 0);

    // NULL, not 0: "nobody wrote an estimate" is not "the estimate is nobody".
    // Only the first can be compared against a roll, and only the second would
    // make every partial roll look complete.
    const estimate = summed > 0 ? summed : null;

    if (people.size > 0) {
        return {
            capacity: people.size,
            basis: 'membership',
            closureSize: closure.size,
            estimate,
            /**
             * Advisory only — the roll still wins. Requires an estimate to
             * compare against: absence of one is not evidence of completeness,
             * and inventing a comparison would be the silent-narrowing failure
             * this whole derivation exists to end, one level up.
             */
            partialEnrolment: estimate !== null && people.size < estimate * ENROLMENT_COMPLETE_RATIO,
        };
    }

    if (estimate !== null) {
        // No roll at all, so nothing to be partial about.
        return {
            capacity: estimate,
            basis: 'expected_size',
            closureSize: closure.size,
            estimate,
            partialEnrolment: false,
        };
    }

    /**
     * Nothing derivable. Returned as NULL rather than 0 on purpose: 0 is a
     * meaningful capacity requirement ("any room will do") and this is the
     * absence of a requirement anyone stated. Callers that must emit a number
     * have to decide what to send AND say so — see
     * `report.offeringsWithNoDerivableCapacity`.
     */
    return { capacity: null, basis: 'none', closureSize: closure.size, estimate: null, partialEnrolment: false };
}
