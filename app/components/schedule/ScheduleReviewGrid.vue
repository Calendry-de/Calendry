<template>
    <div
        class="rgrid"
        :style="cssVars"
        role="group"
        aria-label="Proposed week"
    >
        <div
            class="rgrid_corner"
            :style="{ gridRow: 1, gridColumn: 1 }"
        />
        <div
            v-for="(day, index) in grid.activeDays"
            :key="`h-${day}`"
            class="rgrid_head"
            :style="{ gridRow: 1, gridColumn: index + 2 }"
        >
            <span>{{ weekdayShort(day) }}</span>
            <!--
                Named only where this day's own breaks put its blocks somewhere
                other than the shared timeline: with one set of rows that
                divergence cannot be DRAWN, so it is stated.
            -->
            <span
                v-if="dayDiffers(day)"
                class="rgrid_head-note"
                title="This day has its own break schedule, so its blocks do not start at the times in the left column."
            >own breaks</span>
        </div>

        <!--
            THE TIME COLUMN LIVES IN THE SAME ROWS AS THE BLOCKS IT LABELS, and
            every child is placed EXPLICITLY. Two bugs came from neither being
            true: auto-placed labels flowed around the explicitly placed chips and
            a scheduled session pushed the time into a day column, and computed
            offsets then disagreed with the columns once a crowded slot outgrew
            its block.
        -->
        <template
            v-for="row in rows"
            :key="`${row.kind}-${row.index}`"
        >
            <div
                v-if="row.kind === 'block'"
                class="rgrid_time"
                :class="{ 'rgrid_time--quiet': !labelledLines.has(row.line) }"
                :style="{ gridRow: row.line, gridColumn: 1 }"
            >
                <span>{{ row.start }}</span>
                <span class="rgrid_time-end">{{ row.end }}</span>
            </div>

            <template v-else>
                <div
                    class="rgrid_gap-time"
                    :style="{ gridRow: row.line, gridColumn: 1 }"
                >{{ row.minutes }} min</div>

                <!--
                    One band across every day, because these are the UNIVERSAL
                    gaps. Its row is sized to its own content, not a share of the
                    block height: a 45-minute break inside 195-minute blocks came
                    out 19px tall, too short for its label.
                -->
                <div
                    class="rgrid_gap"
                    :style="{ gridRow: row.line, gridColumn: `2 / -1` }"
                >
                    <span class="rgrid_gap-label">{{ row.label ?? 'Break' }}</span>
                    <span class="rgrid_gap-mins">{{ row.minutes }} min</span>
                </div>
            </template>
        </template>

        <div
            v-for="cell in cells"
            :key="cell.key"
            class="rgrid_cell"
            :style="cell.style"
        />

        <div
            v-for="slot in slots"
            :key="slot.key"
            class="rgrid_slot"
            :class="{ 'rgrid_slot--compact': slot.compact }"
            :style="slot.style"
        >
            <article
                v-for="item in slot.items"
                :key="item.key"
                class="rgrid_chip"
                :class="`rgrid_chip--${item.action}`"
                :aria-label="item.label"
            >
                <span class="rgrid_chip-tag">
                    <!-- Three encodings per state, never hue alone (DESIGN.md):
                         icon, left border, and this word. -->
                    <Icon
                        :name="DIFF_ICON[item.action]"
                        class="rgrid_chip-icon"
                        aria-hidden="true"
                    />
                    <span class="rgrid_chip-tag-text">{{ DIFF_TAG[item.action] }}</span>
                </span>
                <span class="rgrid_chip-title">{{ lookup.offering(item.offeringId) }}</span>
                <span
                    v-if="item.roomId"
                    class="rgrid_chip-meta"
                >{{ lookup.room(item.roomId) }}</span>
                <!-- A move is only legible if it says where FROM. -->
                <span
                    v-if="item.action === 'move' && item.previous"
                    class="rgrid_chip-meta rgrid_chip-was"
                >was {{ weekdayShort(item.previous.dayOfWeek) }}
                    {{ blockTime(grid, item.previous.blockIndex, item.previous.dayOfWeek).start }}
                    <template v-if="item.previous.termWeek !== item.placement.termWeek">
                        (wk {{ item.previous.termWeek }})
                    </template>
                </span>
            </article>
        </div>

    </div>
</template>

<script setup lang="ts">
import { blockTime, weekdayName, weekdayShort } from '~/composables/schedule';
import type { TimeGrid } from '~/composables/schedule';
import { clusterSlots, useGridGeometry } from '~/composables/gridGeometry';
import { DIFF_ICON, DIFF_TAG, describePlacement, shownAt } from '~/composables/generationReview';
import type { Placement, ReviewPlacement } from '~/composables/generationReview';

/**
 * The proposed timetable, rendered as a diff.
 *
 * A separate component rather than a mode on ScheduleGrid: the data genuinely
 * differs. A CREATED placement has no Session row and therefore no id, so it
 * cannot be selected or key into the violations map, and ScheduleGrid's whole
 * vocabulary is session ids.
 *
 * Its rows are content-sized and shared across days, like the live grid's. Four
 * placements in one slot is ordinary here and no minute-proportional block is
 * tall enough for them; the cost is that per-day drift is NAMED in the header
 * rather than drawn. The block/break walk is still shared via
 * `shared/timeGrid.ts` and `useGridGeometry`.
 *
 * NOT THE MOBILE PRESENTATION: `ScheduleReviewAgenda` renders the same data
 * below 1365px.
 *
 * AN EMPTY WEEK IS NOT THIS COMPONENT'S TO DRAW. It used to render the message
 * as the last child of the grid element, which auto-placed into a row after all
 * the explicitly-assigned ones: 869.75px of empty cells above a centred
 * sentence. The page now renders the grid only when there is something in it.
 */
const props = defineProps<{
    grid: TimeGrid;
    placements: ReviewPlacement[];
    rowHeight: number;
    lookup: {
        offering: (id: string) => string;
        room: (id: string) => string;
    };
}>();


/** "Monday 09:00": the shared sentence builder's slot formatter for this grid. */
const slotLabel = (placement: Placement) => (
    `${weekdayName(placement.dayOfWeek)} `
    + `${blockTime(props.grid, placement.blockIndex, placement.dayOfWeek).start}`
);

const { rows, rowSpan, bandWithin, dayDiffers, cssVars, labelledLines } = useGridGeometry(
    computed(() => props.grid),
    computed(() => props.rowHeight),
);

const blockRows = computed(() => rows.value.filter(
    (row): row is Extract<typeof row, { kind: 'block' }> => row.kind === 'block',
));

/** The empty-cell layer: one per day per block, explicitly placed. */
const cells = computed(() => props.grid.activeDays.flatMap((day, index) => (
    blockRows.value.map((row) => ({
        key: `cell-${day}-${row.index}`,
        style: { gridRow: String(row.line), gridColumn: String(index + 2) },
    }))
)));

interface ChipView {
    key: string;
    action: ReviewPlacement['action'];
    offeringId: string;
    roomId: string | null;
    previous: ReviewPlacement['previous'];
    placement: Placement;
    label: string;
}

/**
 * Every placement, packed against overlaps. The fan/stack rule is `clusterSlots`,
 * shared with the live schedule, which had started answering it twice.
 */
const slots = computed(() => {
    const views = new Map<string, ChipView>();

    const entries = props.placements.map((item) => {
        const at = shownAt(item);
        const key = `${item.sessionId ?? 'new'}-${item.offeringId}-${at.dayOfWeek}-${at.blockIndex}`;

        views.set(key, {
            key,
            action: item.action,
            offeringId: item.offeringId,
            roomId: item.roomId,
            previous: item.previous,
            placement: item.placement,
            label: describePlacement(item, slotLabel, props.lookup.offering, props.lookup.room),
        });

        return { key, at };
    });

    return props.grid.activeDays.flatMap((day, index) => clusterSlots(
        entries.filter((entry) => entry.at.dayOfWeek === day),
        (entry) => ({ key: entry.key, start: entry.at.blockIndex, span: entry.at.durationBlocks }),
        {
        column: String(index + 2),
        rowSpan,
        band: (start, span) => bandWithin(day, start, span),
        dayKey: day,
    },
    ).map((slot) => ({
        ...slot,
        items: slot.items.map((entry) => views.get(entry.key)!),
    })));
});
</script>

<style scoped lang="scss">
.rgrid {
    /*
     * Rows come from `gridTemplateRows` inline, because the row COUNT is data.
     * Nothing auto-places: every child names its own row and column.
     */
    display: grid;
    grid-template-columns: auto repeat(var(--day-count), minmax(0, 1fr));
    gap: var(--space-3) var(--space-2);

    padding: var(--space-6);
    border-radius: var(--radius-lg);

    background: $surface1;

    &_corner,
    &_head {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        align-items: center;
        justify-content: flex-end;

        padding: var(--space-4) var(--space-3);

        font-size: var(--font-size-xs);
        font-weight: 600;
        color: $content6;
        text-align: center;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_head-note {
        font-size: var(--font-size-xs);
        font-weight: 400;
        color: $content7;
        text-transform: none;
        letter-spacing: 0;
    }

    &_time {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        align-items: flex-end;

        min-width: 56px;
        padding-right: var(--space-4);

        font-size: var(--font-size-xs);
        // Without this the time column shivers row to row (DESIGN.md).
        font-variant-numeric: tabular-nums;
        color: $content6;
    }

    /*
     * An unlabelled row keeps its cell and its TIME for assistive tech: it is a
     * row header, and one with no name is worse than a quiet one.
     */
    // is the grid's, not the label's, and simply says nothing.

    /*
     * A row the gutter chose not to label keeps its cell: the column's rhythm
     * is the grid's, not the label's, and keeps its TIME for assistive tech.
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

    &_time-end { color: $content7; }

    // The break's duration, in the gutter, so the timeline reads continuously
    // rather than appearing to skip.
    &_gap-time {
        display: flex;
        align-items: center;
        justify-content: flex-end;

        padding-right: var(--space-4);

        font-size: var(--font-size-xs);
        font-variant-numeric: tabular-nums;
        color: $content7;
    }

    &_cell {
        border-radius: var(--radius-sm);
        background: $surface0;
    }

    &_gap {
        overflow: hidden;
        display: flex;
        gap: var(--space-4);
        align-items: center;
        justify-content: center;

        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-sm);

        font-size: var(--font-size-xs);
        font-weight: 600;
        color: $content6;
        text-transform: uppercase;
        letter-spacing: 0.05em;

        /* Hatched, not blank: a blank interval is indistinguishable from a slot
           nothing was placed in, and this one is unavailable by configuration. */
        background: repeating-linear-gradient(
            135deg,
            varToRgba('surface5', 0.5) 0,
            varToRgba('surface5', 0.5) 2px,
            transparent 2px,
            transparent 7px
        );
    }

    &_gap-mins {
        font-weight: 400;
        font-variant-numeric: tabular-nums;
        text-transform: none;
        letter-spacing: 0;
    }

    &_slot {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        min-width: 0;

        &--compact { gap: var(--space-1); }
    }

    &_chip {
        overflow: hidden;
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: var(--space-1);

        min-height: 0;
        padding: var(--space-3);

        /*
         * DETECTOR EXCEPTION `side-tab`, kept deliberately: the stripe is the
         * diff encoding, not decoration: each state overrides only
         * `border-left-color`/`-style`, and a left gutter marking added and
         * removed lines is the convention every diff tool already taught.
         */
        border-left: 3px solid $surface5;
        border-radius: var(--radius-sm);

        font-size: var(--font-size-xs);

        background: $surface3;

        /*
         * THE FOUR STATES, ENCODED TO BE TOLD APART. They differed only in
         * `border-left-color` between three near-blacks; create against move
         * measured 1.09:1. Colour is spent on the two states with consequences:
         * a proposal typically moves almost everything (256 of 260 in one run),
         * so tinting moves would flood the grid and leave removals nothing.
         */
        &--create {
            border-left-color: $success600;
            background: varToRgba('success600', 0.12);

            .rgrid_chip-icon { color: $success700; }
        }

        &--move {
            border-left-color: $content2;
            background: $surface3;
        }

        /*
         * No stripe at all rather than a faint one: the absence reads as "no
         * state" next to three present borders, and encodes nothing that would
         * then need to meet a contrast floor it cannot.
         *
         * RECESSION BY TOKEN, NOT BY OPACITY. This was `opacity: 0.6`, which
         * measured 4.19:1 on the 12px/600 title, an AA failure, and the
         * majority state on almost every proposal (264 of 264 on the applied
         * one). Opacity is the trap: it flattens the chip's own background
         * TOGETHER with its text into one layer before compositing, so the
         * rendered colour is neither the computed `color` nor anything the token
         * ramp can predict, so a reviewer reading what did NOT change was reading
         * the least legible text on the screen.
         *
         * Recessing the surface toward the ground and the text one ramp step
         * instead gets the same "this is background" reading with values that
         * stay measurable: both land near 9:1.
         */
        &--unchanged {
            border-left-color: transparent;
            background: $surface2;

            .rgrid_chip-title { color: $content6; }
        }

        &--delete {
            border-left-color: $error600;

            /*
             * DASHED is the greyscale channel: green and red sit at almost the
             * same luminance (1.29:1), so hue alone cannot tell "added" from
             * "removed", the one pair this grid must never confuse.
             */
            border-left-style: dashed;
            background: varToRgba('error600', 0.12);

            .rgrid_chip-icon { color: $error700; }

            .rgrid_chip-title {
                text-decoration: line-through;
            }
        }
    }

    &_chip-tag {
        display: flex;
        gap: var(--space-2);
        align-items: center;

        font-size: var(--font-size-xs);
        font-weight: 600;
        color: $content6;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_chip-icon {
        flex: none;
        width: 13px;
        height: 13px;
    }

    &_chip-title {
        overflow: hidden;

        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content1;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    &_chip-meta {
        overflow: hidden;

        font-variant-numeric: tabular-nums;
        color: $content6;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    &_chip-was {
        font-style: italic;
    }

    /*
     * The same chip, one line high. Nothing is removed: state icon, offering,
     * room and the move's origin survive, inline and ellipsised. Four fit where
     * one full chip did, which is what shows every member instead of a count.
     */
    &_slot--compact &_chip {
        flex: none;
        flex-direction: row;
        gap: var(--space-3);
        align-items: baseline;

        min-height: 24px;
        padding: var(--space-2) var(--space-3);

        .rgrid_chip-tag { flex: none; }

        // The word is redundant on one line: the icon and the border already
        // carry the state, and the accessible name still says it in full.
        .rgrid_chip-tag-text {
            position: absolute;

            overflow: hidden;

            width: 1px;
            height: 1px;

            white-space: nowrap;

            clip-path: inset(50%);
        }

        .rgrid_chip-title { flex: 0 1 auto; }

        .rgrid_chip-meta {
            flex: 0 1 auto;
            min-width: 0;
        }

        .rgrid_chip-was::before {
            content: '← ';
        }
    }

}
</style>
