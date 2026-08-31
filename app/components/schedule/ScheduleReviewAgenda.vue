<template>
    <div class="ragenda">
        <!--
            The proposal on a phone.

            `ScheduleReviewGrid` renders `76px repeat(var(--day-count), 1fr)` at
            every width, and chips already subdivide to a quarter of a column at
            desktop when four share a slot — so on a 360px screen it was six
            ~47px columns of 11px text. PRODUCT.md records genuine mobile support
            as confirmed and DESIGN.md commits to replacing the week grid outright
            below 1365px; `/schedule` does exactly that with `ScheduleAgenda`, and
            this is the same move over the diff.

            Same data, same vocabulary (DIFF_TAG / DIFF_ICON), different
            structure — a day at a time, ordered by time, which is how a change
            list is actually read when you cannot see the week.
        -->
        <div
            class="ragenda_days"
            role="tablist"
            aria-label="Day"
        >
            <button
                v-for="day in grid.activeDays"
                :key="day"
                type="button"
                role="tab"
                class="ragenda_day"
                :class="{ 'ragenda_day--active': day === activeDay }"
                :aria-selected="day === activeDay"
                @click="activeDay = day"
            >
                <span>{{ weekdayShort(day) }}</span>
                <span
                    v-if="countFor(day)"
                    class="ragenda_count"
                >{{ countFor(day) }}</span>
            </button>
        </div>

        <p
            v-if="!dayItems.length"
            class="ragenda_empty"
        >{{ emptyMessage }}</p>

        <ol
            v-else
            class="ragenda_list"
        >
            <li
                v-for="item in dayItems"
                :key="item.key"
            >
                <span class="ragenda_time">
                    {{ blockTime(grid, item.at.blockIndex, item.at.dayOfWeek).start }}
                    <span class="ragenda_time-end">{{
                        blockTime(grid, item.at.blockIndex, item.at.dayOfWeek).end
                    }}</span>
                </span>

                <article
                    class="ragenda_chip"
                    :class="`ragenda_chip--${item.action}`"
                    :aria-label="item.label"
                >
                    <span class="ragenda_chip-tag">
                        <Icon
                            :name="DIFF_ICON[item.action]"
                            class="ragenda_chip-icon"
                            aria-hidden="true"
                        />
                        {{ DIFF_TAG[item.action] }}
                    </span>
                    <span class="ragenda_chip-title">{{ lookup.offering(item.offeringId) }}</span>
                    <span
                        v-if="item.roomId"
                        class="ragenda_chip-meta"
                    >{{ lookup.room(item.roomId) }}</span>
                    <span
                        v-if="item.action === 'move' && item.previous"
                        class="ragenda_chip-meta ragenda_chip-was"
                    >was {{ weekdayShort(item.previous.dayOfWeek) }}
                        {{ blockTime(grid, item.previous.blockIndex, item.previous.dayOfWeek).start }}
                        <template v-if="item.previous.termWeek !== item.placement.termWeek">
                            (wk {{ item.previous.termWeek }})
                        </template>
                    </span>
                </article>
            </li>
        </ol>
    </div>
</template>

<script setup lang="ts">
import { blockTime, weekdayName, weekdayShort } from '~/composables/schedule';
import type { TimeGrid } from '~/composables/schedule';
import { DIFF_ICON, DIFF_TAG, describePlacement, shownAt } from '~/composables/generationReview';
import type { Placement, ReviewPlacement } from '~/composables/generationReview';

const props = defineProps<{
    grid: TimeGrid;
    placements: ReviewPlacement[];
    lookup: {
        offering: (id: string) => string;
        room: (id: string) => string;
    };
    emptyMessage: string;
}>();

/**
 * Opens on the first day that has something to look at, not on Monday.
 *
 * A proposal can leave a day untouched; landing on an empty tab reads as "this
 * proposal did nothing" — the same failure the week picker had before it started
 * annotating its options.
 */
const activeDay = ref(
    props.grid.activeDays.find((day) => countFor(day) > 0)
    ?? props.grid.activeDays[0]
    ?? 1,
);

/*
 * The day is passed, and that matters: `blockTime` without one resolves the
 * UNIVERSAL timeline, so on a day carrying its own `time_grid_break` rows every
 * clock time here would have been off by that day's break minutes — silently,
 * and only for the tenants who configured them.
 */
const slotLabel = (placement: Placement) => (
    `${weekdayName(placement.dayOfWeek)} `
    + `${blockTime(props.grid, placement.blockIndex, placement.dayOfWeek).start}`
);

const dayItems = computed(() => props.placements
    .map((item) => ({
        key: `${item.sessionId ?? 'new'}-${item.offeringId}-${shownAt(item).blockIndex}`,
        at: shownAt(item),
        action: item.action,
        offeringId: item.offeringId,
        roomId: item.roomId,
        previous: item.previous,
        placement: item.placement,
        label: describePlacement(item, slotLabel, props.lookup.offering, props.lookup.room),
    }))
    .filter((item) => item.at.dayOfWeek === activeDay.value)
    .sort((a, b) => a.at.blockIndex - b.at.blockIndex));

function countFor(day: number): number {
    return props.placements.filter((item) => shownAt(item).dayOfWeek === day).length;
}
</script>

<style scoped lang="scss">
.ragenda {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    width: 100%;

    &_days {
        overflow-x: auto;
        display: flex;
        gap: var(--space-2);

        padding: var(--space-2);
        border-radius: var(--radius-lg);

        background: $surface1;
    }

    &_day {
        cursor: pointer;

        display: flex;
        flex: 1;
        gap: var(--space-3);
        align-items: center;
        justify-content: center;

        // 44px: this is the primary navigation of the mobile presentation, and
        // it is reached with a thumb.
        min-width: 44px;
        min-height: 44px;
        padding: var(--space-4) var(--space-5);
        border: 0;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content6;

        background: none;

        &--active {
            color: $content1;
            background: varToRgba('primary500', 0.16);
        }
    }

    &_count {
        min-width: 18px;
        padding: var(--space-1) var(--space-2);
        border-radius: 9px; // Half the 18px min-width — a circular badge, not a scale step.

        font-size: var(--font-size-xs);
        font-variant-numeric: tabular-nums;
        color: $surface1;

        background: $content7;
    }

    &_empty {
        padding: var(--space-8) 0;
        font-size: var(--font-size-sm);
        color: $content6;
        text-align: center;
    }

    &_list {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        list-style: none;

        li {
            display: grid;
            grid-template-columns: 58px minmax(0, 1fr);
            gap: var(--space-5);
            align-items: stretch;
        }
    }

    &_time {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);

        padding-top: var(--space-4);

        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content6;
        text-align: right;

        &-end {
            font-size: var(--font-size-xs);
            color: $content7;
        }
    }

    // The same three encodings as the grid's chips — icon, border, word — so the
    // two presentations teach one vocabulary rather than two.
    &_chip {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);

        padding: var(--space-4);

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

        background: $surface3;

        &--create {
            border-left-color: $success600;
            background: varToRgba('success600', 0.12);

            .ragenda_chip-icon { color: $success700; }
        }

        &--move {
            border-left-color: $content2;
            background: $surface3;
        }

        // Recession by token, not by opacity — the same fix as the grid's, for
        // the same measured reason: `opacity: 0.6` flattens the chip background
        // into its own text before compositing, which put the majority state's
        // title at 4.19:1 against a 4.5:1 floor.
        &--unchanged {
            border-left-color: transparent;
            background: $surface2;

            .ragenda_chip-title { color: $content6; }
        }

        &--delete {
            border-left-color: $error600;
            // DASHED, and that is the greyscale channel. Green and red sit at
            // almost the same luminance (1.29:1), so colour alone cannot tell
            // "added" from "removed" for a reader who cannot see hue — the exact
            // pair this grid must never confuse. The stripe style, the icon, the
            // word and the strikethrough all survive greyscale; the hue is the
            // redundant fourth cue, not the load-bearing one.
            border-left-style: dashed;
            background: varToRgba('error600', 0.12);

            .ragenda_chip-icon { color: $error700; }

            .ragenda_chip-title { text-decoration: line-through; }
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
        font-size: var(--font-size-md);
        font-weight: 600;
        color: $content1;
    }

    &_chip-meta {
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content6;
    }

    &_chip-was {
        font-style: italic;
    }
}
</style>
