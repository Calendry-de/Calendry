<template>
    <!--
        `role="group"`, NOT `role="grid"`: the grid role promises row/column
        navigation this DOM cannot deliver — there are no `role="row"` wrappers
        because a multi-block chip SPANS rows and cannot belong to one. Naming is
        solved instead by every chip and target assembling its own full label.
    --    -->
    <div
        class="grid"
        :class="{ 'grid--placing': placing, 'grid--swapping': swapping }"
        :style="cssVars"
        role="group"
        aria-label="Week grid"
    >
        <div
            class="grid_corner"
            :style="{ gridRow: 1, gridColumn: 1 }"
        />

        <div
            v-for="(day, index) in grid.activeDays"
            :key="`head-${day}`"
            class="grid_day"
            :style="{ gridRow: 1, gridColumn: index + 2 }"
        >
            <span class="grid_day-long">{{ weekdayName(day, locale) }}</span>
            <span class="grid_day-short">{{ weekdayShort(day, locale) }}</span>
            <span
                v-if="dateOf(day)"
                class="grid_day-date"
            >{{ formatSlotDate(dateOf(day), locale) }}</span>
            <!--
                Named only when this day's blocks do not start at the gutter's
                times: the rows are shared, so a day with its own breaks cannot
                be drawn at its own offsets.
            --            -->
            <span
                v-if="dayDiffers(day)"
                class="grid_day-note"
                title="This day has its own break schedule, so its blocks do not start at the times in the left column."
            >own breaks</span>
        </div>

        <!--
            The time column shares its rows with the blocks it labels, so
            whatever makes a row taller moves its label with it. Nothing is
            computed, so nothing can drift.
        --        -->
        <template
            v-for="row in rows"
            :key="`${row.kind}-${row.index}`"
        >
            <div
                v-if="row.kind === 'block'"
                class="grid_time"
                :class="{ 'grid_time--quiet': !labelledLines.has(row.line) }"
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
                    Inert by construction — no handler, no tabindex — so
                    placement mode cannot target it. A Session may not START in a
                    gap: there is no block index for it. One band across every
                    day, because these are the UNIVERSAL gaps.
                --                -->
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
                :group-name="groupName"
                :person-name="personName"
                :show-group="showGroup"
                :show-person="showPerson"
                :dense="dense"
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
 * Rows are shared across days and content-sized (`useGridGeometry`): a block row
 * is at least the chosen density and grows when its fullest day needs more, with
 * a block's label in the same row as its cells. The cost is that per-day drift
 * cannot be drawn — a day whose own breaks move its blocks is NAMED in its
 * header, and its cells' labels carry that day's real clock times.
 *
 * NO GEOMETRY IS COMPUTED HERE. Rows, spans and slot placement come from
 * `useGridGeometry`/`clusterSlots` over `shared/timeGrid.ts`. A local
 * `blockLength + breakMinutes` stride is what that module exists to delete.
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
    /** Who/which resolvers, and whether the toolbar is already saying it. */
    groupName?: (id: string) => string;
    personName?: (id: string) => string;
    showGroup?: boolean;
    showPerson?: boolean;
    /**
     * What choosing a cell will DO, for its accessible name: "Move to Friday
     * 09:00" and "Add event at Friday 09:00" are different promises.
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

/**
 * Compact density drops the chip's third line. Derived here because the
 * threshold is a fact about the chip's intrinsic height against a row, not
 * something the page should have to know.
 */
const dense = computed(() => props.rowHeight < 60);

const { rows, rowSpan, bandWithin, dayDiffers, cssVars, labelledLines } = useGridGeometry(
    computed(() => props.grid),
    computed(() => props.rowHeight),
);

const blockRows = computed(() => rows.value.filter(
    (row): row is Extract<typeof row, { kind: 'block' }> => row.kind === 'block',
));

/**
 * The target layer: one button per day per block. The accessible name resolves
 * THIS DAY's clock time, not the gutter's — announcing the shared timeline would
 * promise a slot the move would not make.
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

/** Sessions packed against overlaps; `clusterSlots` owns the rule, both grids share it. */
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
     * Rows come from `gridTemplateRows` inline, because the row COUNT is data.
     * Nothing auto-places — every child names its own row and column, which is
     * what keeps the time column in column 1 whatever is scheduled.
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
     * An unlabelled row keeps its cell and its TIME for assistive tech: it is a
     * row header, and one with no name is worse than a quiet one.
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

    /* Inert by construction, so placement mode cannot target it. A Session may
       not START in a gap: there is no block index for it. */
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
         * IN FLOW, and that is load-bearing. `min-height` is a floor, and the
         * row is `minmax(<true minutes>, auto)`, so a stack needing more than its
         * block lasts takes the space and the row takes it with it. As
         * `position: absolute` it contributed nothing to its row's height and a
         * crowded block silently overflowed.
         *
         * `align-self` here is only the fallback — `bandWithin` sets it per slot,
         * because a slot spanning several rows whole must `stretch` to bridge the
         * 1px gaps interior to it.
         */
        align-self: start;

        min-width: 0;
        padding: 2px;

        > * { pointer-events: auto; }

        /* A crowded cluster stacks instead of fanning into slivers; its row
           grows to fit. See `clusterSlots`. */
        &--compact {
            flex-direction: column;
            gap: 1px;

            /*
             * The same chip, one line high. `:deep` because this is a layout
             * decision the CONTAINER makes. Nothing is removed — title, kind,
             * lock and violation icons survive, inline and ellipsised.
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

            // On one line the who/which parts join the row rather than stacking
            // under it, and give way first: the offering and the room identify
            // the session, the cohort narrows it.
            :deep(.chip_who) {
                flex: 0 1 auto;
                min-width: 0;
            }
        }

        /*
         * While PLACING, chips stop intercepting clicks so the cell beneath is
         * reachable — without this a chip covered its own cell and 26 of 40
         * targets were unreachable. The mirror of the mode rule: in `place` the
         * CELLS are targets so chips are inert; in `swap` the chips are.
         */
        .grid--placing & > * { pointer-events: none; }
    }
}
</style>
