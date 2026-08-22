import { describe, expect, it } from 'vitest';
import {
    assertClosedUnderParent,
    conflictClosure,
    referencedGroupIds,
} from '../server/utils/solverGroups';
import type { GroupNode } from '../server/utils/solverGroups';

/**
 * The reference-derived Group filter for `assembleSolverInput`.
 *
 * Before this, every tenant Group was sent on every run while Offerings and
 * Sessions were already narrowed to the Term — measured at 10 sent, 2
 * referenced. Filtering is easy; filtering WITHOUT changing the answer is the
 * part that needs proving, and this file is that proof.
 *
 * TWO PROPERTIES, AND THEY ARE NOT THE SAME CLAIM
 *
 *   1. COMPLETENESS — every Group an Offering or Session names is sent. If this
 *      fails, the input is internally inconsistent: an Offering references a
 *      `group_id` the solver was never given, and the solver has no way to know
 *      the app meant something else.
 *
 *   2. CLOSED UNDER PARENT — no sent Group points at an absent parent. The
 *      solver rebuilds `conflict = {g} ∪ ancestors(g) ∪ descendants(g)` from the
 *      `parent_id` values it receives (groups.rs), so a severed chain silently
 *      WEAKENS the propagation TAXONOMY.md §6 requires. Nothing errors; a cohort
 *      just quietly stops blocking its parent.
 *
 * Both are asserted over randomly generated hierarchies rather than one fixture,
 * because a single example proves a filter works on that example.
 */

/** Deterministic PRNG — a failing seed must be reproducible. */
function rng(seed: number) {
    let state = seed >>> 0;

    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;

        return state / 0x100000000;
    };
}

/** A random forest of `n` groups. Parents always precede children, so no cycles. */
function forest(n: number, next: () => number): GroupNode[] {
    const nodes: GroupNode[] = [];

    for (let i = 0; i < n; i += 1) {
        // ~30% roots, otherwise a parent chosen from those already created.
        const parent = i === 0 || next() < 0.3
            ? null
            : nodes[Math.floor(next() * i)]!.id;

        nodes.push({ id: `g${i}`, parentGroupId: parent });
    }

    return nodes;
}

/** The closure computed the slow, obvious way, as an independent oracle. */
function oracle(groups: GroupNode[], seeds: string[]): Set<string> {
    const parentOf = new Map(groups.map((g) => [g.id, g.parentGroupId]));
    const out = new Set<string>();

    const ancestors = (id: string) => {
        let cursor = parentOf.get(id) ?? null;

        while (cursor !== null) {
            out.add(cursor);
            cursor = parentOf.get(cursor) ?? null;
        }
    };

    // Descendants by repeated relaxation — deliberately not the same algorithm
    // as the implementation, so a shared bug cannot cancel out.
    const isDescendantOf = (candidate: string, root: string) => {
        let cursor = parentOf.get(candidate) ?? null;

        while (cursor !== null) {
            if (cursor === root) return true;
            cursor = parentOf.get(cursor) ?? null;
        }

        return false;
    };

    for (const seed of seeds) {
        if (!parentOf.has(seed)) continue;

        out.add(seed);
        ancestors(seed);

        for (const g of groups) {
            if (isDescendantOf(g.id, seed)) out.add(g.id);
        }
    }

    return out;
}

describe('the two properties, over many random hierarchies', () => {
    it('always contains every referenced Group (completeness)', () => {
        for (let seed = 1; seed <= 200; seed += 1) {
            const next = rng(seed);
            const groups = forest(1 + Math.floor(next() * 40), next);
            const refs = groups.filter(() => next() < 0.2).map((g) => g.id);
            const sent = conflictClosure(groups, refs);

            for (const ref of refs) {
                expect(sent.has(ref), `seed ${seed}: referenced ${ref} was filtered out`).toBe(true);
            }
        }
    });

    it('is always closed under parent (propagation cannot be severed)', () => {
        for (let seed = 1; seed <= 200; seed += 1) {
            const next = rng(seed);
            const groups = forest(1 + Math.floor(next() * 40), next);
            const refs = groups.filter(() => next() < 0.2).map((g) => g.id);
            const sent = conflictClosure(groups, refs);
            const rows = groups.filter((g) => sent.has(g.id));

            expect(() => assertClosedUnderParent(rows), `seed ${seed}`).not.toThrow();
        }
    });

    it('equals an independently computed closure', () => {
        // Neither property above pins the set's SIZE — "send everything" would
        // satisfy both. This is what stops the filter degenerating into a no-op
        // or over-narrowing.
        for (let seed = 1; seed <= 200; seed += 1) {
            const next = rng(seed);
            const groups = forest(1 + Math.floor(next() * 30), next);
            const refs = groups.filter(() => next() < 0.25).map((g) => g.id);

            expect([...conflictClosure(groups, refs)].sort(), `seed ${seed}`)
                .toEqual([...oracle(groups, refs)].sort());
        }
    });
});

describe('the specific shapes the closure exists for', () => {
    const tree: GroupNode[] = [
        { id: 'programme', parentGroupId: null },
        { id: 'cohortA', parentGroupId: 'programme' },
        { id: 'cohortB', parentGroupId: 'programme' },
        { id: 'seminarA1', parentGroupId: 'cohortA' },
        { id: 'unrelated', parentGroupId: null },
    ];

    it('pulls in the ancestor chain, so parent-blocks-child still propagates', () => {
        expect([...conflictClosure(tree, ['seminarA1'])].sort())
            .toEqual(['cohortA', 'programme', 'seminarA1']);
    });

    it('pulls in descendants, so child-blocks-parent still propagates', () => {
        // `programme` is here too, as cohortA's ancestor — the closure is
        // {g} u ancestors u descendants in one step, not two separate walks.
        expect([...conflictClosure(tree, ['cohortA'])].sort())
            .toEqual(['cohortA', 'programme', 'seminarA1']);
    });

    it('does NOT pull in a sibling branch', () => {
        // cohortB is a descendant of programme, which IS in the set — but it can
        // only matter if something places on it, and anything placing on it is
        // itself a referenced seed. Including it would undo the whole saving:
        // one referenced cohort would drag in every other cohort of the degree.
        expect([...conflictClosure(tree, ['cohortA'])]).not.toContain('cohortB');
    });

    it('omits an entirely unrelated group', () => {
        expect([...conflictClosure(tree, ['cohortA'])]).not.toContain('unrelated');
    });

    it('skips a reference to a Group that does not exist', () => {
        // Seeding a phantom node would put a dangling id into the very input
        // this function exists to keep consistent.
        expect([...conflictClosure(tree, ['ghost'])]).toEqual([]);
    });

    it('terminates on a cycle rather than hanging the request', () => {
        // The database has a reparent guard; this must not depend on it holding.
        const cyclic: GroupNode[] = [
            { id: 'a', parentGroupId: 'b' },
            { id: 'b', parentGroupId: 'a' },
        ];

        expect([...conflictClosure(cyclic, ['a'])].sort()).toEqual(['a', 'b']);
    });
});

describe('referencedGroupIds reads BOTH sources', () => {
    it('collects from Offerings and Sessions alike', () => {
        // A Session can carry a Group its Offering does not — one added to a
        // single occurrence. Seeding from Offerings alone would drop it from the
        // input while the Session still referenced it: precisely the
        // inconsistency this module exists to prevent.
        const ids = referencedGroupIds(
            [{ groups: [{ groupId: 'fromOffering' }] }],
            [{ groups: [{ groupId: 'fromSession' }] }],
        );

        expect([...ids].sort()).toEqual(['fromOffering', 'fromSession']);
    });
});

describe('the guard actually fires', () => {
    it('throws when a sent Group points at an absent parent', () => {
        // Falsification: without this, `assertClosedUnderParent` could be a
        // no-op and every test above would still pass.
        expect(() => assertClosedUnderParent([
            { id: 'child', parentGroupId: 'missing' },
        ])).toThrow(/parent 'missing' was filtered out/);
    });

    it('accepts a set whose parents are all present', () => {
        expect(() => assertClosedUnderParent([
            { id: 'root', parentGroupId: null },
            { id: 'child', parentGroupId: 'root' },
        ])).not.toThrow();
    });
});
