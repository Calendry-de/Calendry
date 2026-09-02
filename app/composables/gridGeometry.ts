import { computed } from 'vue';
import type { Ref } from 'vue';
import { blockTime, packSpans } from '~/composables/schedule';
import type { TimeGrid } from '~/composables/schedule';
import { blockBoundaries, blockSpan, gapsOfDay } from '#shared/timeGrid';

/**
 * The row structure a week grid is drawn on: one row per block, one per break.
 *
 * Knows nothing about Sessions, diffs or selection, only that items occupy a
 * range of blocks on a day. Every day shares ONE set of rows, so a block's time
 * label and its cells are structurally aligned and cannot drift. The cost: a day
 * whose own breaks move its blocks cannot be DRAWN differently, so consumers
 * must resolve clock times with `blockTime(grid, index, day)` and `dayDiffers()`
 * exists to name it. Synchronous and Nuxt-free, so it composes anywhere.
 */

export type GridRow =
    | {
        kind: 'block';
        index: number;
        line: number;
        start: string;
        end: string;
        /** True duration, so the row's minimum height is proportional to it. */
        minutes: number;
        /** Minute-since-midnight this row opens at, on the shared timeline. */
        from: number;
    }
    | {
        kind: 'gap';
        index: number;
        line: number;
        minutes: number;
        label: string | null;
        from: number;
    };

export function useGridGeometry(grid: Ref<TimeGrid>, rowHeight: Ref<number>) {
    /**
     * `line` is the 1-based CSS grid line; the header occupies row 1. Held on
     * the row so the time column, cells and chips cannot disagree. The gaps are
     * the UNIVERSAL ones: a day-specific break gets no row of its own.
     */
    const rows = computed<GridRow[]>(() => {
        const gapAfter = new Map(gapsOfDay(grid.value, null).map((gap) => [gap.afterBlockIndex, gap]));
        const out: GridRow[] = [];
        let line = 2;

        for (let index = 0; index < grid.value.blocksPerDay; index++) {
            const span = blockSpan(grid.value, index, null);

            out.push({
                kind: 'block',
                index,
                line: line++,
                minutes: span.end - span.start,
                from: span.start,
                ...blockTime(grid.value, index, null),
            });

            const gap = gapAfter.get(index);

            if (gap) {
                out.push({
                    kind: 'gap',
                    index,
                    line: line++,
                    minutes: gap.minutes,
                    label: gap.label,
                    from: span.end,
                });
            }
        }

        return out;
    });

    /**
     * Below this block length the gutter labels on the hour instead of every
     * row: a 15-minute grid is 44 rows a day, and 44 stacked times is noise.
     * Unlabelled rows are still rows, so placement is unaffected.
     */
    const LABEL_EVERY_BELOW_MINUTES = 30;

    const labelledLines = computed(() => {
        const blocks = rows.value.filter((row): row is Extract<GridRow, { kind: 'block' }> => (
            row.kind === 'block'
        ));

        if (grid.value.blockLengthMinutes >= LABEL_EVERY_BELOW_MINUTES) {
            return new Set(blocks.map((row) => row.line));
        }

        const out = new Set<number>();
        let lastHour: number | null = null;

        for (const row of blocks) {
            const hour = Math.floor(row.from / 60);

            // The first row always speaks: a blank top row reads as broken.
            if (lastHour === null || hour !== lastHour) {
                out.add(row.line);
                lastHour = hour;
            }
        }

        return out;
    });

    const blockLines = computed(() => {
        const map = new Map<number, number>();

        for (const row of rows.value) {
            if (row.kind === 'block') {
                map.set(row.index, row.line);
            }
        }

        return map;
    });

    const lineOf = (blockIndex: number) => blockLines.value.get(blockIndex) ?? 2;

    /** Anchored so a BLOCK is exactly the height the density control asks for. */
    const perMinute = computed(() => rowHeight.value / Math.max(1, grid.value.blockLengthMinutes));

    /**
     * `minmax(<true minutes>, auto)`: the minimum keeps the picture
     * proportional, `auto` lets a row that cannot fit its contents grow instead
     * of overflowing into the row below. Not `var(--row-height)`: that states
     * the density setting rather than a duration, so breaks came out as tall as
     * their label.
     */
    const gridTemplateRows = computed(() => ['auto', ...rows.value.map((row) => (
        `minmax(${(row.minutes * perMinute.value).toFixed(2)}px, auto)`
    ))].join(' '));

    /** The grid rows something occupies, counting any break rows it spans. */
    const rowSpan = (start: number, span: number) => {
        const from = lineOf(start);
        const to = lineOf(start + Math.max(1, span) - 1);

        return `${from} / ${to + 1}`;
    };

    /**
     * Whether this day's blocks start at the times the shared gutter shows.
     * Compared on resolved boundaries, not on the presence of a day-specific
     * break row: a row restating the universal duration changes nothing visible.
     */
    function dayDiffers(day: number): boolean {
        const mine = blockBoundaries(grid.value, day);
        const theirs = blockBoundaries(grid.value, null);
        const origin = (list: number[]) => list[0] ?? 0;

        return mine.some((minute, index) => (
            minute - origin(mine) !== (theirs[index] ?? 0) - origin(theirs)
        ));
    }

    /**
     * Where something sits inside the rows it spans, in PIXELS at a constant
     * minute scale, never a percentage of the row, which resolves against the
     * row's real height and so makes a minute worth more pixels in a busy row.
     *
     * A band covering its rows WHOLE across more than one row gets `stretch`,
     * because a multi-row grid area also holds the row gaps between those rows
     * and any height a row gained from another column's crowding; neither is a
     * minute, so `minHeight` always falls short and the session draws as ending
     * early. A single-row band must NOT stretch (it would fill a row another
     * column made tall) and neither may a partial band (it would claim time it
     * deliberately leaves free).
     */
    function bandWithin(
        day: number | null,
        start: number,
        span: number,
        fromMinute?: number,
        toMinute?: number,
    ): Band {
        const first = blockSpan(grid.value, start, day);
        const last = blockSpan(grid.value, start + Math.max(1, span) - 1, day);
        const from = fromMinute ?? first.start;
        const to = toMinute ?? last.end;
        const ppm = perMinute.value;

        const whole = from === first.start && to === last.end;
        const crossesRows = lineOf(start + Math.max(1, span) - 1) > lineOf(start);

        return {
            marginTop: `${Math.max(0, (from - first.start) * ppm).toFixed(2)}px`,
            minHeight: `${Math.max(0, (to - from) * ppm).toFixed(2)}px`,
            alignSelf: whole && crossesRows ? 'stretch' : 'start',
        };
    }

    const cssVars = computed(() => ({
        '--day-count': String(grid.value.activeDays.length),
        '--row-height': `${rowHeight.value}px`,
        '--per-minute': String(perMinute.value),
        gridTemplateRows: gridTemplateRows.value,
    }));

    return {
        rows, lineOf, rowSpan, bandWithin, gridTemplateRows,
        dayDiffers, cssVars, perMinute, labelledLines,
    };
}

/**
 * How a slot sits inside the rows it spans: a minute-true offset and extent,
 * plus whether it fills its grid area. See `bandWithin`.
 */
export interface Band {
    marginTop: string;
    minHeight: string;
    alignSelf: 'stretch' | 'start';
}

export interface GridSlot<T> {
    key: string;
    items: T[];
    /** Crowded: one full-width slot, every member on a single compact line. */
    compact: boolean;
    style: Record<string, string>;
}

export interface SlotPlacement {
    column: string;
    rowSpan: (start: number, span: number) => string;
    /** Minute-true offset and extent within the spanned rows. */
    band: (start: number, span: number) => Band;
    dayKey: string | number;
}

/**
 * How many items fit side by side in one day column and stay readable. A fourth
 * takes each to ~50px, which is not a narrow chip but an unreadable one.
 */
export const FAN_LIMIT = 3;

/**
 * Overlapping items, packed into positioned slots for one day.
 *
 * PAST THE FAN LIMIT THE DENSITY CHANGES, NEVER THE COUNT: an overlap is either
 * a defect being hunted or a placement being accepted, and neither survives
 * being behind a disclosure. A collapse-past-three rule was measured turning 17
 * of 20 slots in a real week into "+N more" buttons.
 *
 * So a crowded cluster becomes full-width compact slots, ONE PER START BLOCK,
 * each confined to that block's row.
 */
export function clusterSlots<T>(
    items: T[],
    read: (item: T) => { key: string; start: number; span: number },
    place: SlotPlacement,
    fanLimit: number = FAN_LIMIT,
): GridSlot<T>[] {
    const packed = packSpans(items, read);
    const clusters = new Map<string, typeof packed>();

    for (const entry of packed) {
        const list = clusters.get(entry.cluster) ?? [];

        list.push(entry);
        clusters.set(entry.cluster, list);
    }

    const out: GridSlot<T>[] = [];

    for (const [name, members] of clusters) {
        const columns = members[0]?.columns ?? 1;
        const key = `${place.dayKey}:${name}`;

        if (columns <= fanLimit) {
            for (const { item, column } of members) {
                const width = 100 / columns;
                const span = read(item);

                out.push({
                    key: `${key}:${column}:${span.key}`,
                    items: [item],
                    compact: false,
                    style: {
                        gridRow: place.rowSpan(span.start, span.span),
                        gridColumn: place.column,
                        ...place.band(span.start, span.span),
                        width: `${width}%`,
                        marginLeft: `${column * width}%`,
                    },
                });
            }

            continue;
        }

        /*
         * ONE SLOT PER START BLOCK, each spanning exactly ONE row.
         *
         * One slot for the whole cluster put members at their LIST INDEX rather
         * than their time, and inflated every row it spanned: a grid item whose
         * content exceeds its spanned `auto` tracks makes the browser distribute
         * the excess across all of them, so break rows came out as tall as
         * blocks. Safe to confine because compact mode already gives up drawing
         * duration, so there is no overlap left to avoid.
         *
         * EVERY member of such a cluster goes compact, even where its own block
         * is quiet: a fanned member spanning rows would be drawn over a compact
         * stack. Uniformity is what makes that structurally impossible.
         */
        const byStart = new Map<number, typeof members>();

        for (const entry of members) {
            const { start } = read(entry.item);
            const list = byStart.get(start) ?? [];

            list.push(entry);
            byStart.set(start, list);
        }

        for (const [start, group] of [...byStart].sort((a, b) => a[0] - b[0])) {
            // Must be a TOTAL order: a partial one leaves ties in input order,
            // which differs between SSR and the client and mismatches hydration.
            const ordered = [...group].sort((a, b) => {
                const left = read(a.item);
                const right = read(b.item);

                return right.span - left.span || left.key.localeCompare(right.key);
            });

            out.push({
                key: `${key}:b${start}`,
                items: ordered.map((entry) => entry.item),
                compact: true,
                style: {
                    gridRow: place.rowSpan(start, 1),
                    gridColumn: place.column,
                    ...place.band(start, 1),
                    width: '100%',
                    marginLeft: '0%',
                },
            });
        }
    }

    return out;
}
