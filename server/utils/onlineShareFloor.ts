/**
 * WHEN THE ONLINE-SHARE CAP CANNOT BE MET NO MATTER WHERE ANYTHING IS PLACED.
 *
 * `max_online_ratio_per_group` is HARD, and the solver reports a residual
 * `MaxOnlineShare` violation for every group cell over its cap. That is the
 * right answer for a breach somebody can act on by moving a Session onto
 * campus. It is a misleading one for the breach this module names: an Offering
 * with `onlineMode = REQUIRED` (or pinned to virtual Rooms alone) has no
 * on-site placement to be moved to, so once enough of a group's teaching is
 * forced online the cap is arithmetically unreachable and every placement the
 * solver returns is as good as any other.
 *
 * The solver cannot tell the two apart: `MaxOnlineShare` reaches it as
 * `max_ratio` plus a window and nothing else, and the violation it reports
 * back names no Session and no Offering (see `constraints::aggregates` in
 * calendry-solver) — only a prose sentence naming the group. So the
 * distinction is drawn HERE, at assembly, where the Offerings' room
 * restrictions and their demand are both in hand, and reported as a warning
 * that names the groups and the Offerings responsible.
 *
 * REPORTED, NEVER NARROWED. The rule still crosses the wire exactly as
 * configured and the run still comes back with its hard violation: this says
 * why that violation is there, it does not suppress it. Silently dropping the
 * cap for a group whose forced-online demand is over it would be the same
 * class of mistake as sending an empty `allowed_room_ids` for "must be
 * online" — the tenant's instruction discarded with nobody told.
 *
 * ONLY A DEFINITE, UNFIXABLE BREACH IS REPORTED. A cell that merely *might*
 * end up over its cap is the solver's job to price; a false alarm here trains
 * people to ignore the whole report, the same reasoning
 * `offeringsWithNoSuitablePinnedRoom` follows in `solverInput.ts`.
 */

/** One `max_online_ratio_per_group` rule, exactly as it crossed the wire. */
export interface ShareCapRule {
    /** The app's own Constraint row id, sent as `ConstraintConfig.id`. */
    constraintId: string;
    /** 0.0–1.0, already converted from the tenant's 0–100. */
    maxRatio: number;
    /** `SHARE_WINDOW_PER_WEEK`; false is `SHARE_WINDOW_PER_TERM`. */
    perWeek: boolean;
    /** `ConstraintConfig.applies_to_kinds`. EMPTY MEANS EVERY KIND. */
    appliesToKinds: readonly string[];
}

/** One wire Offering — a SERIES, after the per-group split. */
export interface ShareCapOffering {
    /** The wire id, which for a split Offering is `offering::group`. */
    id: string;
    title: string;
    /** The kind KEY, what `applies_to_kinds` is matched against. */
    kind: string;
    /** The series' own Groups, exactly as sent. */
    groupIds: readonly string[];
    /** Total placements the solver was asked for, banked ones already subtracted. */
    requiredSessionCount: number;
    /**
     * Every placement of this series MUST land in a virtual Room, so every one
     * of them counts online whatever the solver does with it.
     */
    forcedOnline: boolean;
}

/** One sent Group. `parentId` is the wire's `''`-for-none convention. */
export interface ShareCapGroup {
    id: string;
    name: string;
    parentId: string;
}

/** One group cell whose cap is unreachable, and the Offerings that make it so. */
export interface ForcedOnlineOverCap {
    constraintId: string;
    groupId: string;
    groupName: string;
    window: 'PER_TERM' | 'PER_WEEK';
    /** 0.0–1.0, as sent. */
    maxRatio: number;
    /** Sessions of this group that cannot be anything but online. */
    forcedOnline: number;
    /** Every session counted into this group's cell over the whole term. */
    total: number;
    /**
     * What the cap permits at that total, `floor()`ed exactly as
     * `ShareInstance::allowance` does. A term-level figure in both windows: a
     * per-week cell has its own smaller total, and this is what the pigeonhole
     * argues from, not a per-week allowance.
     */
    allowance: number;
    /** The forced-online Offerings, named because the fix is on them. */
    offerings: { id: string; title: string; sessions: number }[];
}

/**
 * Group cells whose forced-online demand alone puts them over the cap.
 *
 * MIRRORS THE SOLVER'S OWN ARITHMETIC, and has to: a warning that disagrees
 * with the violation it is explaining is worse than no warning.
 *
 * * Cells are keyed per GROUP, expanded DOWNWARD from each Offering's own
 *   Groups — `expand_subtree` in the solver, membership semantics: a cohort's
 *   Session is attended by its classes, a class's Session does not implicate
 *   the cohort. Expanded within the SENT Groups only, since those are the only
 *   cells the solver has.
 * * `allowance(total) = floor(max_ratio × total)` and a cell is violated when
 *   `online > allowance`. `max_ratio` is a proto `double`, so this arithmetic
 *   is bit-identical to the Rust side rather than merely similar.
 *
 * ONE TEST COVERS BOTH WINDOWS, and that is a result rather than a shortcut:
 *
 * * `PER_TERM` compares against the term cell directly. `forced > allowance`
 *   is precisely the condition the solver will evaluate, so this is the same
 *   statement, made earlier.
 * * `PER_WEEK` cannot be answered directly: demand carries no week until it is
 *   placed, so a per-week cell is unknown here. What is provable is the
 *   pigeonhole — if `forced > max_ratio × total` over the whole term then no
 *   distribution across weeks keeps every week at or under the ratio, so some
 *   week must breach.
 * * Those two conditions COINCIDE for an integer count. `forced > floor(x)`
 *   means `forced >= floor(x) + 1`, which for a non-integer `x` implies
 *   `forced > x`, and for an integer `x` is `forced > x` outright; the converse
 *   holds the same way. So the floored comparison is both the solver's exact
 *   per-term test and the strict per-week pigeonhole, and writing it twice
 *   would be two spellings of one rule waiting to disagree.
 *
 * `window` is carried into the result regardless, because the SENTENCE differs
 * even where the arithmetic does not: a per-week cap breaches in some week the
 * reviewer cannot be shown, and saying so is the difference between a fact and
 * a claim.
 */
export function forcedOnlineAboveShareCap(
    rules: readonly ShareCapRule[],
    offerings: readonly ShareCapOffering[],
    groups: readonly ShareCapGroup[],
): ForcedOnlineOverCap[] {
    if (rules.length === 0 || offerings.length === 0) {
        return [];
    }

    const nameOf = new Map(groups.map((group) => [group.id, group.name]));
    const childrenOf = new Map<string, string[]>();

    for (const group of groups) {
        if (!group.parentId) {
            continue;
        }

        const bucket = childrenOf.get(group.parentId) ?? [];

        bucket.push(group.id);
        childrenOf.set(group.parentId, bucket);
    }

    /**
     * An Offering's Groups plus everything beneath them, within the sent set.
     * Memoised per series id rather than per group list: the same Offering is
     * walked once per rule, and a deep tree walked per rule per Offering is
     * the one place this could get expensive on a real estate.
     */
    const subtreeCache = new Map<string, string[]>();

    const subtreeOf = (offering: ShareCapOffering): string[] => {
        const cached = subtreeCache.get(offering.id);

        if (cached) {
            return cached;
        }

        const seen = new Set<string>();
        // An id the sent set does not hold is dropped rather than counted as a
        // cell of its own: the solver has no cell for a Group it never saw.
        const queue = offering.groupIds.filter((id) => nameOf.has(id));

        while (queue.length > 0) {
            const id = queue.shift()!;

            if (seen.has(id)) {
                continue;
            }

            seen.add(id);
            queue.push(...(childrenOf.get(id) ?? []));
        }

        const expanded = [...seen];

        subtreeCache.set(offering.id, expanded);

        return expanded;
    };

    const out: ForcedOnlineOverCap[] = [];

    for (const rule of rules) {
        interface Cell {
            total: number;
            forced: number;
            offerings: Map<string, { id: string; title: string; sessions: number }>;
        }

        const cells = new Map<string, Cell>();

        for (const offering of offerings) {
            if (offering.requiredSessionCount <= 0) {
                continue;
            }

            // Empty = every kind, the wire's own convention. Reading it as
            // "no kind" would make every scoped cap silently inert here while
            // the solver applied it in full.
            if (rule.appliesToKinds.length > 0 && !rule.appliesToKinds.includes(offering.kind)) {
                continue;
            }

            for (const groupId of subtreeOf(offering)) {
                const cell = cells.get(groupId) ?? { total: 0, forced: 0, offerings: new Map() };

                cell.total += offering.requiredSessionCount;

                if (offering.forcedOnline) {
                    cell.forced += offering.requiredSessionCount;
                    cell.offerings.set(offering.id, {
                        id: offering.id,
                        title: offering.title,
                        sessions: offering.requiredSessionCount,
                    });
                }

                cells.set(groupId, cell);
            }
        }

        for (const [groupId, cell] of cells) {
            if (cell.forced === 0) {
                continue;
            }

            const allowance = Math.floor(rule.maxRatio * cell.total);

            // `ShareInstance::allowance` verbatim, and `is_violated`'s strict
            // `>` with it. `max_ratio` crosses the wire as a proto `double`, so
            // this is bit-identical to the Rust side rather than merely close:
            // 0.3 × 10 rounds to exactly 3 in both, and a cell at 3 of 10 under
            // a 30% cap is therefore satisfied on both sides, not just here.
            if (cell.forced <= allowance) {
                continue;
            }

            out.push({
                constraintId: rule.constraintId,
                groupId,
                groupName: nameOf.get(groupId) ?? groupId,
                window: rule.perWeek ? 'PER_WEEK' : 'PER_TERM',
                maxRatio: rule.maxRatio,
                forcedOnline: cell.forced,
                total: cell.total,
                allowance,
                offerings: [...cell.offerings.values()].sort((a, b) => a.id.localeCompare(b.id)),
            });
        }
    }

    // Sorted so two runs over an unchanged tenant write byte-identical JSON:
    // `meta` is read by humans comparing runs, and Map iteration order would
    // otherwise track whichever Offering happened to be seen first.
    return out.sort((a, b) => (
        a.constraintId.localeCompare(b.constraintId) || a.groupId.localeCompare(b.groupId)
    ));
}

/**
 * The entries off a stored `solver_run.meta`, or `null` when the run predates
 * this check.
 *
 * `meta` is a JSON column, so this is a genuine unknown boundary and is
 * narrowed structurally rather than asserted, the same way `demandLedgerFrom`
 * reads the demand ledger out of the same column. NULL AND EMPTY ARE DIFFERENT
 * STATES: an older run says nothing about forced-online demand, which must not
 * render as "checked, and the cap is reachable".
 */
export function forcedOnlineOverCapFrom(meta: unknown): ForcedOnlineOverCap[] | null {
    if (typeof meta !== 'object' || meta === null || !('report' in meta)) {
        return null;
    }

    const report: unknown = (meta as { report: unknown }).report;

    if (
        typeof report !== 'object'
        || report === null
        || !('groupsWithForcedOnlineAboveShareCap' in report)
    ) {
        return null;
    }

    const rows: unknown = (report as { groupsWithForcedOnlineAboveShareCap: unknown })
        .groupsWithForcedOnlineAboveShareCap;

    if (!Array.isArray(rows)) {
        return null;
    }

    const entries: ForcedOnlineOverCap[] = [];

    for (const row of rows) {
        if (typeof row !== 'object' || row === null) {
            return null;
        }

        const candidate = row as Record<string, unknown>;

        if (
            typeof candidate.constraintId !== 'string'
            || typeof candidate.groupId !== 'string'
            || typeof candidate.groupName !== 'string'
            || (candidate.window !== 'PER_TERM' && candidate.window !== 'PER_WEEK')
            || typeof candidate.maxRatio !== 'number'
            || typeof candidate.forcedOnline !== 'number'
            || typeof candidate.total !== 'number'
            || typeof candidate.allowance !== 'number'
            || !Array.isArray(candidate.offerings)
        ) {
            return null;
        }

        const offerings: ForcedOnlineOverCap['offerings'] = [];

        for (const entry of candidate.offerings) {
            if (typeof entry !== 'object' || entry === null) {
                return null;
            }

            const offering = entry as Record<string, unknown>;

            if (
                typeof offering.id !== 'string'
                || typeof offering.title !== 'string'
                || typeof offering.sessions !== 'number'
            ) {
                return null;
            }

            offerings.push({ id: offering.id, title: offering.title, sessions: offering.sessions });
        }

        entries.push({
            constraintId: candidate.constraintId,
            groupId: candidate.groupId,
            groupName: candidate.groupName,
            window: candidate.window,
            maxRatio: candidate.maxRatio,
            forcedOnline: candidate.forcedOnline,
            total: candidate.total,
            allowance: candidate.allowance,
            offerings,
        });
    }

    return entries;
}
