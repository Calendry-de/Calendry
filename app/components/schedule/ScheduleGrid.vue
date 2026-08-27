<template>
    <div
        class="grid"
        :class="{ 'grid--placing': placing, 'grid--swapping': swapping }"
        :style="cssVars"
        role="grid"
        aria-label="Week"
    >
        <div
            class="grid_corner"
            :style="{ gridRow: 1, gridColumn: 1 }"
        />

        <div
            v-for="(day, index) in grid.activeDays"
            :key="`head-${day}`"
            class="grid_day"
            role="columnheader"
            :style="{ gridRow: 1, gridColumn: index + 2 }"
        >
            <span class="grid_day-long">{{ weekdayName(day, locale) }}</span>
            <span class="grid_day-short">{{ weekdayShort(day, locale) }}</span>
            <span
                v-if="dateOf(day)"
                class="grid_day-date"
            >{{ formatSlotDate(dateOf(day), locale) }}</span>
            <!--
                Named only when this day's blocks do not start at the times in
                the gutter. Silence would be the wrong default: the rows are
                shared, so a day with its own breaks CANNOT be drawn at its own
                offsets, and a viewer comparing a chip's time to the column
                beside it deserves to know why they differ.
            -->
            <span
                v-if="dayDiffers(day)"
                class="grid_day-note"
                title="This day has its own break schedule, so its blocks do not start at the times in the left column."
            >own breaks</span>
        </div>

        <!--
            THE TIME COLUMN SHARES ITS ROWS WITH THE BLOCKS IT LABELS.

            It used to be absolute offsets computed from minutes, per day, with
            the gutter computing its own — so the two agreed only as long as
            nothing outgrew its block. Four sessions in one slot either shrank to
            unreadable slivers or overflowed, and once they overflowed the
            columns and the gutter disagreed about where 16:15 was.

            Now a block's label and that block's cells are in the same grid row.
            Whatever makes the row taller moves the label with it; nothing is
            computed, so nothing can drift.
        -->
        <template
            v-for="row in rows"
            :key="`${row.kind}-${row.index}`"
        >
            <div
                v-if="row.kind === 'block'"
                class="grid_time"
                :class="{ 'grid_time--quiet': !labelledLines.has(row.line) }"
                role="rowheader"
                :style="{ gridRow: row.line, gridColumn: 1 }"
            >
                <span class="grid_time-start">{{ row.start }}</span>
                <span class="grid_time-end">{{ row.end }}</span>
            </div>

            <template v-else>
                <div
                    class="grid_gap-time"
                    :style="{ gridRow: row.line, gridColumn: 1 }"
                >{{ row.minutes }}′</div>

                <!--
                    A break is inert by construction — no handler, no tabindex —
                    so placement mode cannot target it. A Session may not START
                    in a gap: there is no block index for it, and `fitsGrid()`
                    would have nothing to validate.

                    One band across every day, because these are the UNIVERSAL
                    gaps, and its row is sized to its own label rather than to a
                    share of the block height.
                -->
                <div
                    class="grid_gap"
                    :style="{ gridRow: row.line, gridColumn: '2 / -1' }"
                >
                    <span class="grid_gap-label">{{ row.label ?? 'Break' }}</span>
                    <span class="grid_gap-mins">{{ row.minutes }} min</span>
                </div>
            </template>
        </template>

        <button
            v-for="cell in cells"
            :key="cell.key"
            type="button"
            class="grid_cell"
            :class="{ 'grid_cell--target': placing }"
            :style="cell.style"
            :disabled="!placing"
            :aria-label="cell.label"
            @click="placing && $emit('place', { dayOfWeek: cell.day, blockIndex: cell.blockIndex })"
        />

        <div
            v-for="slot in slots"
            :key="slot.key"
            class="grid_slot"
            :class="{ 'grid_slot--compact': slot.compact }"
            :style="slot.style"
        >
            <ScheduleSessionChip
                v-for="session in slot.items"
                :key="session.id"
                :grid="grid"
                :room-name="roomName"
                :virtual-room-ids="virtualRoomIds"
                :display="display"
                :session="session"
                :violations="violations.get(session.id) ?? []"
                :selected="session.id === selectedId"
                :dimmed="placing && session.id !== selectedId"
                :targetable="swapping && session.id !== selectedId"
                @select="$emit('select', session.id)"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    type ScheduleSession, type TimeGrid, type Violation,
    blockTime, formatSlotDate, weekdayName, weekdayShort,
} from '~/composables/schedule';
import { useViewerLocale } from '~/composables/locale';
import { clusterSlots, useGridGeometry } from '~/composables/gridGeometry';
import type { DisplaySettings } from '#shared/sessionColor';
import ScheduleSessionChip from './ScheduleSessionChip.vue';

/**
 * The week grid, laid out in ROWS that grow with what is in them.
 *
 * WHY IT STOPPED BEING PER-DAY MINUTE OFFSETS
 *
 * It was `grid-auto-rows: var(--row-height)` with one row per block, so every
 * gap between blocks rendered as zero height — the TimeGrid break feature was
 * built without this component ever being updated, and a tenant with a
 * 45-minute morning break saw their blocks butted together while the time column
 * correctly said 12:15 then 13:00.
 *
 * The fix for that was a per-day absolutely-positioned stack sized from each
 * day's own `blockBoundaries()`, which was minute-true and let a day with its
 * own breaks visibly drift from the gutter. But a block's height was then a
 * function of the density setting alone, so several sessions in one slot either
 * fanned into unreadable slivers or overflowed their block — and when they
 * overflowed, each column and the gutter computed offsets independently and
 * disagreed about where a time was.
 *
 * So the rows are shared and CONTENT-SIZED (`useGridGeometry`): a block row is
 * at least the chosen density and grows when its fullest day needs more, and a
 * block's label sits in the same row as its cells. Alignment is structural.
 *
 * WHAT THAT COSTS: per-day drift can no longer be drawn. A day whose own breaks
 * move its blocks is NAMED in its header instead, its cells' accessible labels
 * carry that day's real clock times, and the gutter is explicitly the shared
 * timeline rather than a claim about every column.
 *
 * NO GEOMETRY IS COMPUTED HERE. Rows, spans and slot placement come from
 * `useGridGeometry` / `clusterSlots`, over `blockBoundaries()`, `blockSpan()`
 * and `gapsOfDay()` in `shared/timeGrid.ts` — the same walk `blockTime()` and
 * `blockOfMinute()` use. A local `blockLength + breakMinutes` stride is exactly
 * what that module was created to delete; three of them had accumulated once
 * already, and the review grid needs the identical projection.
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
    /** The week on screen, so day headers can show real dates. */
    termWeek: number;
    /** Resolves a slot to a calendar date; null before a term is chosen. */
    slotDateOf: (termWeek: number, dayOfWeek: number) => Date | null;
    /** Resolves a room id to its name, for the chip's room label. */
    roomName?: (id: string) => string;
    /** Virtual room ids and the tenant's display standards, for chip colour. */
    virtualRoomIds?: Set<string>;
    display?: DisplaySettings;
    /**
     * What choosing a cell will DO, for the slot's accessible name. `place` and
     * `create` both make cells the targets, and a blind user pressing one
     * deserves to know which — "Move to Friday 09:00" and "Add event at Friday
     * 09:00" are different promises.
     */
    targetVerb?: string;
}>();

defineEmits<{
    select: [sessionId: string];
    place: [target: { dayOfWeek: number; blockIndex: number }];
}>();

const locale = useViewerLocale();

/** This column's calendar date, in the week currently shown. */
const dateOf = (day: number) => props.slotDateOf(props.termWeek, day);

const { rows, rowSpan, bandWithin, dayDiffers, cssVars, labelledLines } = useGridGeometry(
    computed(() => props.grid),
    computed(() => props.rowHeight),
);

const blockRows = computed(() => rows.value.filter(
    (row): row is Extract<typeof row, { kind: 'block' }> => row.kind === 'block',
));

/**
 * The target layer: one button per day per block, explicitly placed.
 *
 * The accessible name resolves THIS DAY's clock time, not the gutter's. With
 * shared rows a day carrying its own breaks starts its blocks elsewhere, and
 * announcing the shared timeline would promise a slot the move would not make.
 */
const cells = computed(() => props.grid.activeDays.flatMap((day, index) => (
    blockRows.value.map((row) => ({
        key: `cell-${day}-${row.index}`,
        day,
        blockIndex: row.index,
        label: props.placing
            ? `${props.targetVerb ?? 'Move to'} ${weekdayName(day)} `
                + `${blockTime(props.grid, row.index, day).start}`
            : undefined,
        style: { gridRow: String(row.line), gridColumn: String(index + 2) },
    }))
)));

/**
 * Sessions packed against overlaps, one positioned slot per column of each
 * cluster — or, past the fan limit, one full-width slot whose members stack
 * under each other. `clusterSlots` owns that rule; both grids share it.
 */
const slots = computed(() => props.grid.activeDays.flatMap((day, index) => clusterSlots(
    props.sessions.filter((session) => session.dayOfWeek === day),
    (session) => ({
        key: session.id,
        start: session.blockIndex,
        span: session.durationBlocks,
    }),
    {
        column: String(index + 2),
        rowSpan,
        band: (start, span) => bandWithin(day, start, span),
        dayKey: day,
    },
)));
</script>
<style scoped lang="scss">
.grid {
    /*
     * Rows come from `gridTemplateRows` in the inline style, because the row
     * COUNT is data: one per block, one per break. Nothing here auto-places —
     * every child names its own row and column — which is what keeps the time
     * column in column 1 no matter what is scheduled.
     */
    display: grid;
    grid-template-columns: auto repeat(var(--day-count), minmax(0, 1fr));
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

        &-date {
            font-size: 11px;
            font-weight: 500;
            font-variant-numeric: tabular-nums;
            color: $content7;
        }

        &-note {
            padding: 1px 6px;
            border-radius: 999px;

            font-size: 10px;
            font-weight: 600;
            color: $content6;
            letter-spacing: 0.04em;

            background: varToRgba('primary500', 0.18);
        }

        @include mobile() {
            &-long { display: none; }
            &-short { display: inline; }

            &-note { display: none; }
        }
    }

    &_time,
    &_gap-time {
        position: sticky;
        z-index: 1;
        left: 0;

        min-width: 62px;

        background: $surface1;
    }

    /*
     * A row the gutter chose not to label keeps its cell — the column's rhythm
     * is the grid's, not the label's — and keeps its TIME for assistive tech.
     *
     * Hidden rather than dropped: it is a `rowheader`, and a row header with no
     * name is worse than a quiet one. The eye gets an uncluttered hour column;
     * a screen reader still gets "09:15" for the row it is reading across.
     */
    &_time--quiet > * {
        position: absolute;

        overflow: hidden;

        width: 1px;
        height: 1px;

        white-space: nowrap;

        clip-path: inset(50%);
    }

    &_time {
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
            color: $content7;
        }
    }

    /* The break's duration beside the time column, so it is measurable. */
    &_gap-time {
        display: flex;
        align-items: center;
        justify-content: flex-end;

        padding: 0 10px;

        font-size: 10px;
        font-variant-numeric: tabular-nums;
        color: $content7;
    }

    &_cell {
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
                border: 1px dashed varToRgba('primary600', 0.55);
                border-radius: 6px;

                opacity: 0;

                transition: opacity 160ms cubic-bezier(0.16, 1, 0.3, 1);
            }

            @include hover() {
                &:hover {
                    background: varToRgba('primary500', 0.14);

                    &::after { opacity: 1; }
                }
            }

            &:focus-visible {
                background: varToRgba('primary500', 0.14);
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
        overflow: hidden;
        display: flex;
        gap: 6px;
        align-items: center;
        justify-content: center;

        font-size: 10px;
        color: $content7;
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

        display: flex;
        gap: 2px;

        /*
         * IN FLOW, and that is load-bearing.
         *
         * Offset and extent come from `bandWithin` as a `margin-top` and a
         * `min-height` in pixels at a constant minute scale — so an hour is the
         * same height everywhere on the grid, and a slot is exactly as tall as
         * its session lasts.
         *
         * WHAT HAPPENS WHEN A BLOCK CANNOT FIT ITS SESSIONS: the row grows.
         * `min-height` is a floor, not a ceiling, and the row is
         * `minmax(<true minutes>, auto)` — so a stack that needs more than its
         * block lasts takes the space and the row takes it with it. Nothing is
         * hidden, nothing scrolls, nothing overlaps, and the time column moves
         * with it because it shares the row. It was briefly `position: absolute`,
         * which broke exactly this: an out-of-flow slot contributes nothing to
         * its row's height, so a crowded block silently overflowed instead.
         *
         * `align-self: start` is the other half. A grid item stretches to its
         * area by default, so a slot in a row that some OTHER column made tall
         * was stretched to match — a single session rendered as a chip the full
         * height of the container with one line of text in it. Starting at the
         * top leaves the unused time visibly empty, which is what it is.
         */
        align-self: start;

        min-width: 0;
        padding: 2px;

        > * { pointer-events: auto; }

        /*
         * A crowded cluster stacks under itself instead of fanning into
         * slivers. The row it sits in grows to fit (`minmax(var(--row-height),
         * auto)`), so nothing overflows and nothing is hidden — see
         * `clusterSlots`.
         */
        &--compact {
            flex-direction: column;
            gap: 1px;

            /*
             * THE COMPACT CHIP — the same chip, one line high.
             *
             * `:deep` because the chip owns its own scoped styles and this is a
             * layout decision the CONTAINER makes: the same component is a tall
             * card when it has a column to itself and a single line when it is
             * one of six sharing a slot. Nothing is removed — title, kind, lock
             * and violation icons all survive, laid out inline and ellipsised
             * rather than stacked.
             */
            :deep(.chip) {
                flex: none;
                flex-direction: row;
                gap: 8px;
                align-items: baseline;
                justify-content: flex-start;

                min-height: 24px;
                padding: 3px 8px;
            }

            :deep(.chip_meta) {
                flex: none;
            }

            :deep(.chip_title) {
                flex: 0 1 auto;
                white-space: nowrap;
            }

            // The stack has no position to read a time off, so the chip states
            // it. This is the whole reason the stacked form is not lossy.
            :deep(.chip_time) { display: inline; }
        }

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
