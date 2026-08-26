<template>
    <div
        class="rgrid"
        :style="cssVars"
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
                other than the shared timeline. With one set of rows for every
                column, that divergence cannot be DRAWN — so it is stated, and
                each chip carries its own day's real clock time.
            -->
            <span
                v-if="dayDiffers(day)"
                class="rgrid_head-note"
                title="This day has its own break schedule, so its blocks do not start at the times in the left column."
            >own breaks</span>
        </div>

        <!--
            THE TIME COLUMN LIVES IN THE SAME ROWS AS THE BLOCKS IT LABELS.

            Two bugs came out of it not doing so. It was one auto-placed div per
            block in a `grid-auto-rows` grid while the chips were placed
            EXPLICITLY, so CSS flowed the auto items around them and a single
            scheduled session wrapped the next time label into a day column — the
            time appeared on the RIGHT. Rebuilding it as absolute offsets from
            minutes fixed that and introduced the second: a crowded slot's
            content outgrew its block, so the day columns and the time column
            disagreed about where 16:15 was.

            Both are gone for the same reason. Every child is placed EXPLICITLY,
            so nothing flows; and a block's label shares a grid ROW with that
            block's cells, so whatever makes the row taller moves the label with
            it. Alignment is structural rather than computed, and cannot drift.
        -->
        <template
            v-for="row in rows"
            :key="`${row.kind}-${row.index}`"
        >
            <div
                v-if="row.kind === 'block'"
                class="rgrid_time"
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
                    gaps. A break is a real interval, and the row it occupies is
                    sized to its own content rather than to a share of the block
                    height: a 45-minute break inside 195-minute blocks came out
                    19px tall, too short to carry its own label.
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
                    <!--
                        Three encodings per state, never hue alone (DESIGN.md):
                        the icon, the left border, and this word. In greyscale, or
                        with the tint stripped, "added" and "removed" are still
                        the two things they must never be mistaken for.
                    -->
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

        <p
            v-if="!placements.length"
            class="rgrid_empty"
        >{{ emptyMessage }}</p>
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
 * A SEPARATE COMPONENT rather than a mode on ScheduleGrid, deliberately.
 * ScheduleGrid is already at the size threshold and carries selection and
 * placement-mode concerns; diff rendering would be a fourth responsibility on
 * it. More to the point the data genuinely differs: a CREATED placement has no
 * Session row and therefore no id, so it cannot be selected, cannot key into the
 * violations map, and does not belong in a component whose whole vocabulary is
 * session ids.
 *
 * WHY ITS GEOMETRY DIFFERS FROM ScheduleGrid's, WHICH IS A REAL TRADE
 * ------------------------------------------------------------------
 * The live grid positions each day in its OWN minute-accurate stack, so a day
 * with its own breaks visibly drifts from the time column. That is right there:
 * a timetabler is reading a week as a shape in time, and proportion is the
 * information.
 *
 * A reviewer is reading a LIST of changes that happens to be arranged like a
 * week. Four placements in one slot is ordinary here, each carrying four facts,
 * and no minute-proportional block is tall enough for them — so this grid sizes
 * its rows to their CONTENT (`minmax(var(--row-height), auto)`) and shares one
 * set of rows across every day. What that buys is exact alignment between the
 * time column and the cells no matter how much is in them. What it costs is
 * per-day drift, so a day whose own breaks move its blocks is NAMED in its
 * header instead, and every chip states its own day's real clock time.
 *
 * The block/break WALK is still shared — `gapsOfDay()` and `blockTime()` from
 * `shared/timeGrid.ts`, and `useGridGeometry` for the per-day comparison behind
 * that header note. Only the pixel projection differs, because only the pixel
 * projection should.
 *
 * NOT THE MOBILE PRESENTATION. `ScheduleReviewAgenda` renders the same data
 * below 1365px, the way `/schedule` swaps its week grid for `ScheduleAgenda`.
 */
const props = defineProps<{
    grid: TimeGrid;
    placements: ReviewPlacement[];
    rowHeight: number;
    lookup: {
        offering: (id: string) => string;
        room: (id: string) => string;
    };
    emptyMessage: string;
}>();


/** "Monday 09:00" — the shared sentence builder's slot formatter for this grid. */
const slotLabel = (placement: Placement) => (
    `${weekdayName(placement.dayOfWeek)} `
    + `${blockTime(props.grid, placement.blockIndex, placement.dayOfWeek).start}`
);

const { rows, rowSpan, bandWithin, dayDiffers, cssVars } = useGridGeometry(
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
 * Every placement, packed against overlaps and placed in its own grid area.
 *
 * The fan/stack rule itself is `clusterSlots` — shared with the live schedule,
 * because both grids answer the same question about a crowded slot and had
 * started answering it twice.
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
     * Rows come from `gridTemplateRows` in the inline style, because the row
     * COUNT is data: one per block, one per break. Nothing here auto-places —
     * every child names its own row and column — which is what keeps the time
     * column in column 1 no matter what is scheduled.
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

        /*
         * Hatched rather than merely empty. A blank interval is
         * indistinguishable from a slot nothing was placed in, and this one is
         * unavailable by configuration — a different fact.
         */
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
         * DETECTOR EXCEPTION, `side-tab`, kept deliberately.
         *
         * The mechanical scan flags a >1px coloured side border as the classic
         * AI-slop accent stripe, and its remedy is to remove it. Here the stripe
         * is not decoration: it is the diff encoding. Each state overrides only
         * `border-left-color`/`-style`, so deleting it would delete the signal
         * this component exists to carry — and a left gutter marking added and
         * removed lines is the convention every diff tool already taught the
         * reader. Earned by the brief, not reached for by habit.
         */
        border-left: 3px solid $surface5;
        border-radius: var(--radius-sm);

        font-size: var(--font-size-xs);

        background: $surface3;

        /*
         * THE FOUR STATES, ENCODED TO BE TOLD APART.
         *
         * They previously differed only in `border-left-color`, between three
         * near-blacks: create #18181B against move #202024 measured 1.09:1, and
         * create against delete 1.36:1 on raw token colour — under the comment
         * asserting that added and removed must never be mistaken for each
         * other. The only working signal was the tag text, which was itself the
         * lowest-contrast text on the screen.
         *
         * Colour is spent on the two states with consequences and withheld from
         * the two without. A proposal typically moves almost everything (256 of
         * 260 in one measured run), so tinting moves would flood the grid and
         * leave the four removals no way to stand out. Rarity is what gives the
         * state colour its force.
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

        // No stripe at all rather than a faint one: the absence reads as "no
        // state" next to three present borders, and encodes nothing that would
        // then need to meet a contrast floor it cannot.
        &--unchanged {
            border-left-color: transparent;
            opacity: 0.6;
        }

        &--delete {
            border-left-color: $error600;

            /*
             * DASHED, and that is the greyscale channel. Green and red sit at
             * almost the same luminance (1.29:1), so colour alone cannot tell
             * "added" from "removed" for a reader who cannot see hue — the exact
             * pair this grid must never confuse. The stripe style, the icon, the
             * word and the strikethrough all survive greyscale; the hue is the
             * redundant fourth cue, not the load-bearing one.
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
     * THE COMPACT ROW — the same chip, one line high.
     *
     * Nothing is removed: state icon, offering, room and the move's origin all
     * survive, laid out inline and ellipsised at the end rather than stacked four
     * deep. Four of these fit where one full chip did, which is what lets a
     * crowded slot show every member instead of a count.
     */
    &_slot--compact &_chip {
        flex: none;
        flex-direction: row;
        gap: var(--space-3);
        align-items: baseline;

        min-height: 24px;
        padding: var(--space-2) var(--space-3);

        .rgrid_chip-tag { flex: none; }

        // The word is redundant on one line — the icon and the border already
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

    &_empty {
        grid-column: 1 / -1;

        padding: var(--space-8);

        font-size: var(--font-size-sm);
        color: $content6;
        text-align: center;
    }
}
</style>
