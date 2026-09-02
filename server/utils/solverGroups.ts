/**
 * Which Groups a term's solve actually needs.
 *
 * `assembleSolverInput` sent EVERY tenant Group for every run, while Offerings
 * and Sessions were already narrowed to the Term. Measured on the demo tenant:
 * 10 Groups sent, 2 referenced.
 *
 * WHY THIS FILTERS BY REFERENCE AND NOT BY `group_term` SCOPE
 * ----------------------------------------------------------
 * There is now a `group_term` table saying which Terms a Group is available in,
 * and filtering on it would be the obvious move. It is the wrong one.
 *
 * That table is TENANT CONFIGURATION: a human sets it, no-rows means "every
 * Term", and nothing forces it to agree with what the Offerings actually
 * reference. Filter the solver's Groups by it and a mis-scoped Group produces
 * an input where an Offering names a `group_id` the solver was never given:
 * internally inconsistent, and the solver has no way to detect that the app
 * meant something else. Reference-derivation cannot fail that way, because the
 * references ARE the source.
 *
 * WHY THE FULL CONFLICT CLOSURE, NOT JUST THE REFERENCED IDS
 * ----------------------------------------------------------
 * The solver builds `conflict = {g} ∪ ancestors(g) ∪ descendants(g)` from the
 * `parent_id` values it is sent (groups.rs), and marks every member of that set
 * busy when a placement lands. So the sent set has to contain everything that
 * could appear in the conflict expansion of any placement in this Term, or the
 * propagation TAXONOMY.md §6 requires would silently weaken.
 *
 * Taking the conflict closure of the referenced ids is exactly that set, and it
 * is also closed under `parent`, which is the property that makes the result a
 * well-formed forest rather than one with dangling parent pointers:
 *
 *   - a descendant D of a referenced X has its parent on the path X→D: that
 *     parent is D's ancestor and X's descendant, and is therefore in the set;
 *   - an ancestor A of X has as parent another ancestor of X, itself in the
 *     set, or A is a root and has none.
 *
 * So no sent Group can point at an absent parent. Proven by construction rather
 * than asserted, and pinned by `assertClosedUnderParent` below plus a test that
 * cross-checks against every Offering's own group references.
 *
 * A sibling branch (some other child of an ancestor A) is deliberately NOT
 * pulled in. It can only matter if something places on it, and anything that
 * places on it in this Term is itself a referenced id and therefore already a
 * seed.
 */

/** The subset of a Group row this needs. */
export interface GroupNode {
    id: string;
    parentGroupId: string | null;
}

/**
 * `{seeds} ∪ ancestors(seeds) ∪ descendants(seeds)`.
 *
 * Computed in memory from the `parent_id` values already fetched, rather than
 * queried from `group_closure`. Two reasons: it costs no extra round trip, and
 * more importantly it derives the closure from the SAME data the solver will:
 * reading the closure table instead would introduce a second source of truth
 * that could disagree with `parent_id` if a trigger ever lagged.
 */
export function conflictClosure(groups: GroupNode[], seeds: Iterable<string>): Set<string> {
    const parentOf = new Map(groups.map((g) => [g.id, g.parentGroupId]));
    const childrenOf = new Map<string, string[]>();

    for (const g of groups) {
        if (g.parentGroupId !== null) {
            const siblings = childrenOf.get(g.parentGroupId);

            if (siblings) {
                siblings.push(g.id);
            } else {
                childrenOf.set(g.parentGroupId, [g.id]);
            }
        }
    }

    const out = new Set<string>();

    for (const seed of seeds) {
        // A reference to a Group that does not exist is skipped rather than
        // seeded: it cannot be sent, and inventing a node for it would put a
        // dangling id into the input this function exists to keep consistent.
        if (!parentOf.has(seed)) {
            continue;
        }

        out.add(seed);

        // Upward: the parent chain. Guarded by `seen` because a cycle in the
        // data would otherwise hang the request; the database has a
        // reparent guard, but this must not depend on it holding.
        const seen = new Set<string>([seed]);
        let cursor = parentOf.get(seed) ?? null;

        while (cursor !== null && !seen.has(cursor)) {
            seen.add(cursor);
            out.add(cursor);
            cursor = parentOf.get(cursor) ?? null;
        }

        // Downward: the whole subtree.
        const stack = [seed];

        while (stack.length) {
            const current = stack.pop()!;

            for (const child of childrenOf.get(current) ?? []) {
                if (!out.has(child)) {
                    out.add(child);
                    stack.push(child);
                }
            }
        }
    }

    return out;
}

/**
 * Every Group id a Term's Offerings and Sessions actually name.
 *
 * BOTH sources, not just Offerings: a Session can carry a Group its Offering
 * does not (one added to a single occurrence), and seeding from Offerings alone
 * would drop it from the input while the Session still referenced it, exactly
 * the inconsistency this module exists to prevent.
 */
export function referencedGroupIds(
    offerings: { groups: { groupId: string }[] }[],
    sessions: { groups: { groupId: string }[] }[],
): Set<string> {
    const ids = new Set<string>();

    for (const offering of offerings) {
        for (const link of offering.groups) {
            ids.add(link.groupId);
        }
    }

    for (const session of sessions) {
        for (const link of session.groups) {
            ids.add(link.groupId);
        }
    }

    return ids;
}

/**
 * Fail loudly if the filtered set is not closed under `parent`.
 *
 * The proof above says this cannot happen. That is exactly why it is asserted:
 * a guard whose failure mode is a silently weakened conflict propagation is the
 * shape this codebase keeps getting bitten by, and the check is O(n) on a list
 * already in memory. If the closure construction is ever changed, this is what
 * turns a subtle scheduling bug into a refused run.
 */
export function assertClosedUnderParent(sent: GroupNode[]): void {
    const present = new Set(sent.map((g) => g.id));

    for (const group of sent) {
        if (group.parentGroupId !== null && !present.has(group.parentGroupId)) {
            throw new Error(
                `solver input would contain group '${group.id}' whose parent `
                + `'${group.parentGroupId}' was filtered out; conflict propagation `
                + 'would be silently weakened',
            );
        }
    }
}
