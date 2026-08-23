<template>
    <div
        class="grid"
        :class="{ 'grid--placing': placing, 'grid--swapping': swapping }"
        :style="gridStyle"
    >
        <div class="grid_corner" />

        <div
            v-for="day in grid.activeDays"
            :key="`head-${day}`"
            class="grid_day"
        >
            <span class="grid_day-long">{{ weekdayName(day) }}</span>
            <span class="grid_day-short">{{ weekdayShort(day) }}</span>
            <!--
                Named only when this day's timeline actually differs from the
                universal one. Silence would be the wrong default: with per-day
                stacks the column simply sits at different offsets, which reads
                as a rendering glitch unless the reason is stated.
            -->
            <span
                v-if="dayDiffers(day)"
                class="grid_day-note"
                :title="`This day has its own break schedule, so its blocks do not line up with the time column.`"
            >own breaks</span>
        </div>

        <!--
            THE TIME COLUMN IS THE UNIVERSAL TIMELINE, and a day with its own
            breaks is deliberately allowed to drift out of alignment with it.
            One shared set of row heights cannot be correct for two days whose
            blocks start at different clock times, so the geometry is per-day
            and the gutter is a reference rather than a claim about every column.
        -->
        <div
            class="grid_gutter"
            :style="{ height: `${universal.totalHeight}px` }"
        >
            <div
                v-for="block in universal.blocks"
                :key="`t-${block.index}`"
                class="grid_time"
                :style="{ top: `${block.top}px`, height: `${block.height}px` }"
            >
                <span class="grid_time-start">{{ block.start }}</span>
                <span class="grid_time-end">{{ block.end }}</span>
            </div>

            <div
                v-for="gap in universal.gaps"
                :key="`tg-${gap.afterBlockIndex}`"
                class="grid_gap-time"
                :style="{ top: `${gap.top}px`, height: `${gap.height}px` }"
            >{{ gap.minutes }}′</div>
        </div>

        <div
            v-for="day in grid.activeDays"
            :key="`col-${day}`"
            class="grid_col"
            :style="{ height: `${layoutFor(day).totalHeight}px` }"
        >
            <button
                v-for="block in layoutFor(day).blocks"
                :key="`cell-${day}-${block.index}`"
                type="button"
                class="grid_cell"
                :class="{ 'grid_cell--target': placing }"
                :style="{ top: `${block.top}px`, height: `${block.height}px` }"
                :disabled="!placing"
                :aria-label="placing ? `Move to ${weekdayName(day)} ${block.start}` : undefined"
                @click="placing && $emit('place', { dayOfWeek: day, blockIndex: block.index })"
            />

            <!--
                A break is a real, non-interactive interval. Rendered as its own
                element rather than as padding between cells so it can carry the
                label and duration, and so its HEIGHT is the gap's actual
                minutes — the thing the old uniform-row grid could not express.
            -->
            <div
                v-for="gap in layoutFor(day).gaps"
                :key="`gap-${day}-${gap.afterBlockIndex}`"
                class="grid_gap"
                :style="{ top: `${gap.top}px`, height: `${gap.height}px` }"
            >
                <span class="grid_gap-label">{{ gap.label ?? 'Break' }}</span>
                <span class="grid_gap-mins">{{ gap.minutes }} min</span>
            </div>

            <div
                v-for="placement in placementsFor(day)"
                :key="placement.session.id"
                class="grid_slot"
                :style="slotStyle(placement, day)"
            >
                <ScheduleSessionChip
                    :session="placement.session"
                    :violations="violations.get(placement.session.id) ?? []"
                    :selected="placement.session.id === selectedId"
                    :dimmed="placing && placement.session.id !== selectedId"
                    :targetable="swapping && placement.session.id !== selectedId"
                    @select="$emit('select', placement.session.id)"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    type ScheduleSession, type SessionPlacement, type TimeGrid, type Violation,
    blockTime, layoutDay, weekdayName, weekdayShort,
} from '~/composables/schedule';
import { blockBoundaries, blockSpan, gapsOfDay } from '#shared/timeGrid';
import ScheduleSessionChip from './ScheduleSessionChip.vue';

/**
 * The week grid, laid out in MINUTES rather than in uniform rows.
 *
 * WHY THIS STOPPED BEING ONE CSS GRID
 *
 * It used to be `grid-auto-rows: var(--row-height)` with one row per block, so
 * every gap between blocks rendered as zero height. The TimeGrid break feature
 * — schema, `blockBoundaries()`, the editor's preview — was built without this
 * component ever being updated, so a tenant with a 45-minute morning break saw
 * their blocks butted together while the time column correctly said 12:15 then
 * 13:00. The times were right and the picture contradicted them.
 *
 * A single grid cannot be fixed by adding break rows, because row heights are
 * shared across columns and a DAY-SPECIFIC break means two days genuinely have
 * different block start times. So each day is now its own positioned stack
 * sized from its OWN `blockBoundaries(grid, day)`, and the time column shows
 * the universal timeline as a reference. Where a day differs it visibly drifts
 * from that reference, which is the honest picture rather than a bug.
 *
 * NO GEOMETRY IS COMPUTED HERE. Every offset comes from `blockBoundaries()`,
 * `blockSpan()` and `gapsOfDay()` in `shared/timeGrid.ts` — the same walk
 * `blockTime()` and `blockOfMinute()` use. A local `blockLength + breakMinutes`
 * stride is exactly what that module was created to delete; three of them had
 * accumulated once already.
 */
const props = defineProps<{
    grid: TimeGrid;
    sessions: ScheduleSession[];
    violations: Map<string, Violation[]>;
    selectedId: string | null;
    placing: boolean;
    /** Chips are pick targets rather than the grid's empty cells. */
    swapping: boolean;
    rowHeight: number;
}>();

defineEmits<{
    select: [sessionId: string];
    place: [target: { dayOfWeek: number; blockIndex: number }];
}>();

/**
 * Pixels per minute, anchored so a BLOCK keeps exactly the height it had
 * before. Breaks then add their real duration on top, rather than every row
 * shrinking to make room — which would have made the fix look like a
 * regression on every grid that has no breaks at all.
 */
const perMinute = computed(() => props.rowHeight / Math.max(1, props.grid.blockLengthMinutes));

interface DayLayout {
    blocks: { index: number; top: number; height: number; start: string; end: string }[];
    gaps: { afterBlockIndex: number; minutes: number; label: string | null; top: number; height: number }[];
    totalHeight: number;
}

function layoutOf(day: number | null): DayLayout {
    const bounds = blockBoundaries(props.grid, day);
    const origin = bounds[0] ?? 0;
    const ppm = perMinute.value;
    const px = (minute: number) => (minute - origin) * ppm;

    return {
        blocks: Array.from({ length: props.grid.blocksPerDay }, (_, index) => ({
            index,
            top: px(bounds[index] ?? origin),
            height: props.grid.blockLengthMinutes * ppm,
            ...blockTime(props.grid, index, day),
        })),
        gaps: gapsOfDay(props.grid, day).map((gap) => ({
            ...gap,
            top: px((bounds[gap.afterBlockIndex] ?? origin) + props.grid.blockLengthMinutes),
            height: gap.minutes * ppm,
        })),
        totalHeight: px(bounds[bounds.length - 1] ?? origin),
    };
}

// Memoised per render: `layoutFor` is called several times per day in the
// template, and each call otherwise re-walks the boundaries.
const layouts = computed(() => {
    const map = new Map<number, DayLayout>();

    for (const day of props.grid.activeDays) {
        map.set(day, layoutOf(day));
    }

    return map;
});

const universal = computed(() => layoutOf(null));

const layoutFor = (day: number) => layouts.value.get(day) ?? universal.value;

/**
 * Whether this day's timeline differs from the universal one.
 *
 * Compared on the resolved BOUNDARIES rather than by looking for a
 * day-specific break row, because a row that happens to restate the universal
 * duration changes nothing a viewer can see, and flagging it would be noise.
 */
function dayDiffers(day: number): boolean {
    const mine = layoutFor(day).blocks;
    const theirs = universal.value.blocks;

    return mine.some((block, index) => block.top !== theirs[index]?.top);
}

const gridStyle = computed(() => ({
    '--day-count': String(props.grid.activeDays.length),
    '--row-height': `${props.rowHeight}px`,
}));

const placementsFor = (day: number) => layoutDay(props.sessions.filter((s) => s.dayOfWeek === day));

/**
 * A session is positioned from its own day's timeline and sized from its first
 * block's start to its last block's end — so a multi-block Session that spans a
 * break VISIBLY spans it, gap included.
 *
 * That is deliberate and deliberately not a decision: whether such a placement
 * should be legal at all is the open question in CLAUDE.md. Drawing it as it is
 * stored shows the situation instead of hiding it behind a contiguous chip.
 */
function slotStyle(placement: SessionPlacement, day: number) {
    const { session, column, columns } = placement;
    const bounds = blockBoundaries(props.grid, day);
    const origin = bounds[0] ?? 0;
    const first = blockSpan(props.grid, session.blockIndex, day);
    const last = blockSpan(props.grid, session.blockIndex + session.durationBlocks - 1, day);
    const width = 100 / columns;

    return {
        top: `${(first.start - origin) * perMinute.value}px`,
        height: `${(last.end - first.start) * perMinute.value}px`,
        width: `${width}%`,
        left: `${column * width}%`,
    };
}
</script>

<style scoped lang="scss">
.grid {
    /*
     * Two rows only: headers, then the stacks. Blocks are no longer grid rows —
     * they are positioned inside each column from real minutes, because row
     * heights are shared across columns and two days with different breaks do
     * not share a timeline. See the component comment.
     */
    display: grid;
    grid-template-columns: auto repeat(var(--day-count), minmax(0, 1fr));
    grid-template-rows: auto auto;
    gap: 1px;

    padding: 1px;
    border-radius: 10px;

    background: $surface5;

    &_corner,
    &_day {
        background: $surface1;
    }

    &_corner {
        position: sticky;
        z-index: 3;
        top: 0;
        left: 0;

        border-radius: 9px 0 0;
    }

    &_day {
        position: sticky;
        z-index: 2;
        top: 0;

        display: flex;
        gap: 6px;
        align-items: center;
        justify-content: center;

        height: 40px;

        font-size: 13px;
        font-weight: 600;
        color: $content6;
        letter-spacing: 0.02em;

        &-short { display: none; }

        &-note {
            padding: 1px 6px;
            border-radius: 999px;

            font-size: 10px;
            font-weight: 600;
            color: $content6;
            letter-spacing: 0.04em;

            background: rgb(124, 89, 188, 0.18);
        }

        @include mobile() {
            &-long { display: none; }
            &-short { display: inline; }

            &-note { display: none; }
        }
    }

    &_gutter,
    &_col {
        position: relative;
        background: $surface5;
    }

    &_gutter {
        position: sticky;
        z-index: 1;
        left: 0;

        min-width: 62px;

        background: $surface1;
    }

    &_time {
        position: absolute;
        right: 0;
        left: 0;

        display: flex;
        flex-direction: column;
        gap: 2px;
        align-items: flex-end;
        justify-content: center;

        padding: 0 10px;

        // Tabular figures keep the time column from shivering row to row.
        font-variant-numeric: tabular-nums;

        &-start {
            font-size: 12px;
            color: $content6;
        }

        &-end {
            font-size: 11px;
            color: $surface7;
        }
    }

    /* The gap's duration beside the time column, so the drift is measurable. */
    &_gap-time {
        position: absolute;
        right: 0;
        left: 0;

        display: flex;
        align-items: center;
        justify-content: flex-end;

        padding: 0 10px;

        font-size: 10px;
        font-variant-numeric: tabular-nums;
        color: $surface7;
    }

    &_cell {
        position: absolute;
        right: 0;
        left: 0;

        border: 0;

        appearance: none;
        background: $surface0;

        &:disabled { cursor: default; }

        &--target {
            cursor: pointer;
            transition: background 160ms cubic-bezier(0.16, 1, 0.3, 1);

            &::after {
                content: '';

                display: block;

                width: 100%;
                height: 100%;
                border: 1px dashed rgb(124 89 188 / 55%);
                border-radius: 6px;

                opacity: 0;

                transition: opacity 160ms cubic-bezier(0.16, 1, 0.3, 1);
            }

            @include hover() {
                &:hover {
                    background: rgb(124 89 188 / 14%);

                    &::after { opacity: 1; }
                }
            }

            &:focus-visible {
                background: rgb(124 89 188 / 14%);
                outline: 2px solid $primary400;
                outline-offset: -2px;

                &::after { opacity: 1; }
            }
        }
    }

    /*
     * A break is inert by construction — no handler, no tabindex — so placement
     * mode cannot target it. A Session may not START in a gap: there is no
     * block index for it, and `fitsGrid()` would have nothing to validate.
     */
    &_gap {
        position: absolute;
        right: 0;
        left: 0;

        overflow: hidden;
        display: flex;
        gap: 6px;
        align-items: center;
        justify-content: center;

        font-size: 10px;
        color: $surface7;
        letter-spacing: 0.02em;
        white-space: nowrap;

        background: repeating-linear-gradient(
            135deg,
            $surface2,
            $surface2 6px,
            $surface1 6px,
            $surface1 12px
        );

        &-label { font-weight: 600; }

        @include mobile() {
            &-mins { display: none; }
        }
    }

    &_slot {
        pointer-events: none;

        position: absolute;

        display: flex;

        min-width: 0;
        padding: 2px;

        > * { pointer-events: auto; }

        /*
         * While PLACING, chips stop intercepting clicks so the cell beneath is
         * reachable. Without this a chip covers its own cell, so an occupied
         * slot could not be chosen as a destination at all — measured at 26 of
         * 40 target cells unreachable — and clicking one selected that session
         * and silently cancelled the move instead.
         *
         * This is the other half of the mode rule: in `place` the CELLS are the
         * targets, so chips must be inert. In `swap` the chips ARE the targets,
         * so they stay live and the cells are the disabled ones.
         */
        .grid--placing & > * { pointer-events: none; }
    }
}
</style>
