import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockSpan, gapsWithinSpan } from '../shared/timeGrid';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { login } from './helpers/client';

let cookie: string | null;

/**
 * The time a multi-block Session OCCUPIES but does not TEACH.
 *
 * THE BUG THIS DEFINES AWAY. `durationBlocks` counts block INDICES, and every
 * consumer treated that as one contiguous stretch of clock. It is not, whenever a
 * gap separates the blocks: on the dev tenant's `Standard week` grid (8 × 45min,
 * `breakMinutes: 0`, named breaks after blocks 0, 1 and 3), a two-block Session
 * starting at block 3 occupies 120 minutes and teaches 90, and rendered
 * identically to a genuine 90-minute one. One live Session was already in that
 * state when this was written.
 *
 * WHY THE SOLVER CANNOT ANSWER IT. `toWireTimeGrid` deliberately sends no
 * breaks, on the stated grounds that the solver reasons in block indices where a
 * gap "changes no adjacency". That is true of a single-block Session and false of
 * a multi-block one, but the answer is not to send breaks. See DECISIONS.md
 * § "A Session that spans a break".
 */
const STANDARD = {
    blockLengthMinutes: 45,
    blocksPerDay: 8,
    startHour: 8,
    startMinute: 0,
    breakMinutes: 0,
    breaks: [
        { afterBlockIndex: 0, durationMinutes: 45, label: 'Break', dayOfWeek: null },
        { afterBlockIndex: 1, durationMinutes: 15, label: 'Lunch', dayOfWeek: null },
        { afterBlockIndex: 3, durationMinutes: 30, label: 'Afternoon', dayOfWeek: null },
    ],
};

/** Every gap is the grid default; nothing is named. */
const UNIFORM = {
    blockLengthMinutes: 60,
    blocksPerDay: 6,
    startHour: 9,
    startMinute: 0,
    breakMinutes: 10,
    breaks: [],
};

describe('gapsWithinSpan', () => {
    it('finds the named break a two-block span crosses', () => {
        const gaps = gapsWithinSpan(STANDARD, 3, 2);

        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toMatchObject({ afterBlockIndex: 3, minutes: 30, label: 'Afternoon' });
    });

    it('finds NOTHING for a two-block span that crosses no gap', () => {
        // The counter-example that makes the test above mean something: blocks
        // 4-5 are back to back on this grid, so a two-block Session there really
        // is 90 contiguous minutes.
        expect(gapsWithinSpan(STANDARD, 4, 2)).toEqual([]);
    });

    it('finds nothing for a single block, which has no interior', () => {
        /*
         * Enforced by the LOOP BOUND (`durationBlocks - 1`), not by the early
         * return above it: that branch is a fast path and removing it changes
         * no result, confirmed by mutation. Block 0 and block 3 are both
         * immediately followed by a break, so this fails the moment the bound
         * is wrong.
         */
        expect(gapsWithinSpan(STANDARD, 3, 1)).toEqual([]);
        expect(gapsWithinSpan(STANDARD, 0, 1)).toEqual([]);
    });

    it('ignores a gap after the span\'s FINAL block, which is outside it', () => {
        // Block 2 -> 3 has no gap; the 30-minute break follows block 3, which is
        // the last block of this span. Counting it would inflate every session
        // that merely ENDS before a break.
        expect(gapsWithinSpan(STANDARD, 2, 2)).toEqual([]);
    });

    it('finds every gap a longer span crosses, in order', () => {
        const gaps = gapsWithinSpan(STANDARD, 0, 5);

        expect(gaps.map((g) => [g.afterBlockIndex, g.minutes, g.label])).toEqual([
            [0, 45, 'Break'],
            [1, 15, 'Lunch'],
            [3, 30, 'Afternoon'],
        ]);
    });

    it('includes the UNNAMED default gap, with a null label', () => {
        // Both occupy real time. Reporting only named breaks would draw a
        // timeline that does not add up on any grid with `breakMinutes > 0`,
        // where EVERY multi-block session spans a gap.
        const gaps = gapsWithinSpan(UNIFORM, 1, 3);

        expect(gaps.map((g) => [g.afterBlockIndex, g.minutes, g.label])).toEqual([
            [1, 10, null],
            [2, 10, null],
        ]);
    });

    it('measures fromMinute against the START of the span, not the day', () => {
        // The renderer places the marker in px from the chip's own top, so an
        // offset from midnight would put every break off the bottom of the grid.
        const gaps = gapsWithinSpan(STANDARD, 3, 2);
        const spanStart = blockSpan(STANDARD, 3, null).start;

        expect(spanStart).toBeGreaterThan(0);
        // Block 3 is the first of the span, so its gap begins one block in.
        expect(gaps[0]!.fromMinute).toBe(45);
    });

    it('honours a DAY-SPECIFIC break, and the null-day fallback', () => {
        const friday = {
            ...STANDARD,
            breaks: [
                { afterBlockIndex: 3, durationMinutes: 30, label: 'Afternoon', dayOfWeek: null },
                { afterBlockIndex: 3, durationMinutes: 90, label: 'Friday long lunch', dayOfWeek: 5 },
            ],
        };

        expect(gapsWithinSpan(friday, 3, 2, 5)[0]).toMatchObject({
            minutes: 90, label: 'Friday long lunch',
        });

        // Another day still gets the universal one.
        expect(gapsWithinSpan(friday, 3, 2, 2)[0]).toMatchObject({
            minutes: 30, label: 'Afternoon',
        });
    });

    it('reports the taught total as span minus interruptions', () => {
        /*
         * The arithmetic the whole function exists to make possible, asserted
         * once so the numbers in the docs are real: blocks 3-4 on this grid run
         * 09:30-11:30 (120 minutes) and teach 90.
         */
        const first = blockSpan(STANDARD, 3, null);
        const last = blockSpan(STANDARD, 4, null);
        const occupied = last.end - first.start;
        const lost = gapsWithinSpan(STANDARD, 3, 2).reduce((sum, gap) => sum + gap.minutes, 0);

        expect(occupied).toBe(120);
        expect(lost).toBe(30);
        expect(occupied - lost).toBe(2 * STANDARD.blockLengthMinutes);
    });
});

/**
 * The chip actually says it, over HTTP.
 *
 * The unit tests above pin the WALK; this pins that the schedule renders its
 * answer. Separate because they fail for different reasons: a correct walk whose
 * result nothing displays is exactly the state this card was filed about.
 *
 * Asserted on the ACCESSIBLE NAME rather than the hatched overlay. The overlay is
 * inline `style` px computed from `perMinute`, so matching it would pin a
 * pixel arithmetic that is allowed to change; the sentence is the contract with
 * the reader, and it is the only form the agenda has.
 */
describe('the schedule chip reports it', () => {
    const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

    async function scheduleHtml(): Promise<string> {
        const res = await fetch(`${BASE}/schedule`, { headers: { cookie: cookie! } });

        expect(res.status, '/schedule did not render').toBe(200);

        return res.text();
    }

    /** Places the fixture Session across, or clear of, a named break. */
    async function place(blockIndex: number, durationBlocks: number): Promise<void> {
        await ownerDb.$executeRawUnsafe(
            `UPDATE session SET block_index = $1, duration_blocks = $2 WHERE id = 'test-session-a'`,
            blockIndex, durationBlocks,
        );
    }

    beforeAll(async () => {
        await seed();
        ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));

        // The fixture grid has no breaks and `breakMinutes: 0`, so nothing spans
        // anything until one exists.
        await ownerDb.$executeRawUnsafe(
            `INSERT INTO time_grid_break
               (id, tenant_id, time_grid_id, after_block_index, duration_minutes, label, updated_at)
             VALUES ('test-break-span', 'test-tenant-a', 'test-grid-a', 0, 30, 'Morning break', now())`,
        );
    });

    afterAll(async () => {
        await ownerDb.$executeRawUnsafe(`DELETE FROM time_grid_break WHERE id = 'test-break-span'`);
        await teardown();
        await ownerDb.$disconnect();
    });

    it('names the break a two-block Session spans', async () => {
        await place(0, 2);

        const html = await scheduleHtml();

        expect(html).toContain('Interrupted by Morning break');
        expect(html).toContain('30 minutes not taught');
    });

    it('says nothing when the same Session spans no gap (the counter-example)', async () => {
        // Blocks 4-5 are back to back: the only break on this grid follows block
        // 0. Without this, a chip that announced an interruption unconditionally
        // would pass the test above.
        await place(4, 2);

        const html = await scheduleHtml();

        expect(html).not.toContain('Interrupted by');
        // Paired, so "absent" cannot be satisfied by a page that failed to render.
        expect(html).toContain('Databases');
    });

    it('says nothing for a single-block Session sitting right before a break', async () => {
        await place(0, 1);

        const html = await scheduleHtml();

        expect(html).not.toContain('Interrupted by');
        expect(html).toContain('Databases');
    });
});
