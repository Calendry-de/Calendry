/**
 * Block boundaries: the one definition of when each block starts.
 *
 * In `shared/` because two consumers answer inverse questions about the same
 * timeline and must not drift — `blockTime()` in the app, `blockOfMinute()` on
 * the server. Disagreement would render one time while `reference_slot` believed
 * another, invisible until the solver refused to move a Session plainly still in
 * the future.
 *
 * A WALK, not a stride. `dayStart + index * (blockLength + breakMinutes)` is
 * right only while every gap is equal; a 45-minute lunch after block 3 shifts
 * every later block and no divisor expresses it. The uniform case is not a
 * special path but what the walk produces with no override — asserted by the
 * equivalence property in `tests/time-grid-breaks.test.ts`.
 *
 * None of it reaches the solver: the wire carries block INDICES, and a gap's
 * duration changes no index, adjacency or conflict.
 */

/** A named gap that replaces the default `breakMinutes` at one position. */
export interface TimeGridBreak {
    /** The gap FOLLOWS this 0-based block index. */
    afterBlockIndex: number;
    durationMinutes: number;
    label: string;
    /**
     * `null` applies on every active day. A row naming a specific ISO weekday
     * beats the universal one at the SAME `afterBlockIndex` and only there, so
     * "same lunch daily, but Friday differs" needs one extra row.
     */
    dayOfWeek: number | null;
}

/** `breaks` is optional, so a grid without overrides behaves exactly as before. */
export interface BlockGrid {
    blocksPerDay: number;
    blockLengthMinutes: number;
    startHour: number;
    startMinute: number;
    breakMinutes: number;
    breaks?: TimeGridBreak[];
}

/**
 * The gap after `afterBlockIndex` on `dayOfWeek`, in minutes. Precedence is
 * day-specific → universal → grid default, resolved per POSITION: a Friday
 * override at block 6 does not displace the universal lunch at block 3.
 *
 * `dayOfWeek === null` sees only universal overrides — the honest answer for a
 * caller that has not said which day it means.
 */
export function gapAfter(
    grid: BlockGrid,
    afterBlockIndex: number,
    dayOfWeek: number | null = null,
): number {
    const overrides = grid.breaks ?? [];
    const at = overrides.filter((b) => b.afterBlockIndex === afterBlockIndex);

    const specific = dayOfWeek === null
        ? undefined
        : at.find((b) => b.dayOfWeek === dayOfWeek);

    return (specific ?? at.find((b) => b.dayOfWeek === null))?.durationMinutes
        ?? grid.breakMinutes;
}

/**
 * The named break filling that gap, or null when it is the grid's unnamed
 * default. SAME PRECEDENCE AS `gapAfter`, which is why it exists: the editor grew
 * its own `breaks.find(...)`, which returns whichever row comes first in the
 * array — so previewing Friday could show the universal break's label while
 * `gapAfter` returned the Friday duration.
 */
export function breakAfter(
    grid: BlockGrid,
    afterBlockIndex: number,
    dayOfWeek: number | null = null,
): TimeGridBreak | null {
    // Never after the final block: a gap there has no meaning.
    // meaning — the same boundary `blockBoundaries` refuses to walk.
    if (afterBlockIndex >= grid.blocksPerDay - 1) {
        return null;
    }

    const at = (grid.breaks ?? []).filter((b) => b.afterBlockIndex === afterBlockIndex);

    const specific = dayOfWeek === null
        ? undefined
        : at.find((b) => b.dayOfWeek === dayOfWeek);

    return specific ?? at.find((b) => b.dayOfWeek === null) ?? null;
}

/**
 * Every gap on `dayOfWeek` that occupies real time — what a RENDERER needs in one
 * call. Derived from `gapAfter`/`breakAfter` rather than the break rows, so an
 * unnamed default gap is included: it occupies time on screen exactly as a named
 * one does, and omitting it would draw a timeline that does not add up.
 */
export function gapsOfDay(
    grid: BlockGrid,
    dayOfWeek: number | null = null,
): { afterBlockIndex: number; minutes: number; label: string | null }[] {
    const out = [];

    for (let i = 0; i < grid.blocksPerDay - 1; i += 1) {
        const minutes = gapAfter(grid, i, dayOfWeek);

        if (minutes > 0) {
            out.push({ afterBlockIndex: i, minutes, label: breakAfter(grid, i, dayOfWeek)?.label ?? null });
        }
    }

    return out;
}

/**
 * The gaps that fall INSIDE a multi-block span — the time it occupies but does
 * not teach.
 *
 * WHY THIS IS A SHARED DEFINITION AND NOT A RENDERER DETAIL. A Session with
 * `durationBlocks: 2` occupies two block INDICES, and every consumer that draws
 * or measures it treats that as one contiguous stretch. That is a claim about the
 * clock, and it is false whenever a gap separates those blocks: on an 8 × 45min
 * grid with a 30-minute break after block 3, a two-block Session starting at
 * block 3 occupies 120 minutes and teaches 90.
 *
 * The solver cannot answer this — `toWireTimeGrid` deliberately sends no breaks,
 * because the solver reasons in block indices where a gap changes no adjacency.
 * True of a single-block Session, false of a multi-block one. So the definition
 * lives here, with `gapAfter`/`breakAfter`, and every consumer asks the same
 * question of the same function rather than re-deriving the walk.
 *
 * Includes the UNNAMED default gap (`grid.breakMinutes`) as well as named breaks,
 * because both occupy real time; `label` is null for the unnamed one, which is
 * the only reason it can be absent. `fromMinute` is measured from the START of
 * the span, so a caller needs no second boundary walk to place it.
 *
 * A span of 1 has no interior, and a gap after the span's FINAL block is outside
 * it — the same boundary `breakAfter` refuses to walk.
 */
export function gapsWithinSpan(
    grid: BlockGrid,
    blockIndex: number,
    durationBlocks: number,
    dayOfWeek: number | null = null,
): { afterBlockIndex: number; minutes: number; label: string | null; fromMinute: number }[] {
    /*
     * A FAST PATH, not a correctness guard — the loop bound below already yields
     * no iterations for a span of 1, which is why no test can tell this branch
     * from its absence (checked by mutation). It stays because the single-block
     * case is the overwhelming majority of chips on a grid and this skips a
     * boundary walk for each of them. Do not add a test "covering" it; test the
     * loop bound instead, which is what actually enforces the rule.
     */
    if (durationBlocks < 2) {
        return [];
    }

    const spanStart = blockSpan(grid, blockIndex, dayOfWeek).start;
    const out: { afterBlockIndex: number; minutes: number; label: string | null; fromMinute: number }[] = [];

    for (let index = blockIndex; index < blockIndex + durationBlocks - 1; index += 1) {
        const minutes = gapAfter(grid, index, dayOfWeek);

        if (minutes <= 0) {
            continue;
        }

        out.push({
            afterBlockIndex: index,
            minutes,
            label: breakAfter(grid, index, dayOfWeek)?.label ?? null,
            fromMinute: blockSpan(grid, index, dayOfWeek).end - spanStart,
        });
    }

    return out;
}

/**
 * Start minute of every block, plus a final entry for when teaching ends — always
 * `blocksPerDay + 1` long, so a caller never re-derives the last block's length.
 *
 * Minutes are from local midnight and NOT wrapped at 24h: a grid running past
 * midnight produces values above 1440, so callers can detect it rather than
 * seeing a plausible early-morning time.
 */
export function blockBoundaries(grid: BlockGrid, dayOfWeek: number | null = null): number[] {
    const out: number[] = [grid.startHour * 60 + grid.startMinute];

    for (let i = 0; i < grid.blocksPerDay; i += 1) {
        const end = out[i]! + grid.blockLengthMinutes;

        // The gap after the final block is never walked: there is no block for
        // it to push, and it would overstate when teaching ends.
        // it to push, and including it would overstate when teaching ends.
        out.push(i === grid.blocksPerDay - 1 ? end : end + gapAfter(grid, i, dayOfWeek));
    }

    return out;
}

/** Start and end minute of one block. */
export function blockSpan(
    grid: BlockGrid,
    blockIndex: number,
    dayOfWeek: number | null = null,
): { start: number; end: number } {
    const bounds = blockBoundaries(grid, dayOfWeek);
    const start = bounds[blockIndex] ?? bounds[bounds.length - 1] ?? 0;

    return { start, end: start + grid.blockLengthMinutes };
}

/**
 * Which block contains `minutesSinceMidnight`, or the number of blocks finished
 * when the time falls in a gap or past the last block. A scan, not a division,
 * because a time inside a BREAK counts as the preceding block being finished —
 * which fell out of `Math.floor` under a uniform stride and has to be stated here.
 */
export function blockAtMinute(
    grid: BlockGrid,
    minutesSinceMidnight: number,
    dayOfWeek: number | null = null,
): number {
    const bounds = blockBoundaries(grid, dayOfWeek);

    if (minutesSinceMidnight < bounds[0]! || grid.blocksPerDay <= 0) {
        return 0;
    }

    for (let i = 0; i < grid.blocksPerDay; i += 1) {
        // Inside block i or the gap after it: either way i blocks have started.
        // blocks have started and i is the answer while the block runs.
        if (minutesSinceMidnight < bounds[i + 1]!) {
            return i;
        }
    }

    // Past the end of teaching: the COUNT of blocks finished, not an index.
    // finished — rather than an index that does not exist.
    return grid.blocksPerDay;
}
