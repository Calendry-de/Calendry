<template>
    <div class="blocks">
        <span
            v-if="label"
            class="blocks_label"
        >{{ label }}</span>

        <p
            v-if="help"
            class="blocks_help"
        >{{ help }}</p>

        <div
            v-if="!readonly"
            class="blocks_row"
        >
            <label
                v-for="index in indices"
                :key="index"
                class="blocks_item"
                :class="{ 'blocks_item--on': selected.includes(index) }"
            >
                <input
                    :checked="selected.includes(index)"
                    type="checkbox"
                    @change="toggle(index)"
                >
                <span class="blocks_item-name">{{ index + 1 }}</span>
                <span class="blocks_item-time">{{ timeOf(index) }}</span>
            </label>
        </div>

        <!--
            Read-only renders the selection as TEXT, never as disabled
            checkboxes — a disabled control reads as "unavailable right now"
            rather than "not yours to change".
        -->
        <p
            v-else
            class="blocks_static"
        >{{ selectedSummary }}</p>

        <p
            v-if="error"
            class="blocks_error"
            role="alert"
        >{{ error }}</p>
    </div>
</template>

<script setup lang="ts">
import type { TimeGrid } from '~/composables/schedule';
import { blockTime } from '~/composables/schedule';

/**
 * Pick blocks of the teaching day, by number and by the clock time they mean.
 *
 * The counterpart to `ManageWeekdayPicker`, which this deliberately mirrors in
 * shape (model of `number[]`, label/help/error/readonly props) so the two read
 * as one control split across two axes.
 *
 * IT SHOWS TIMES, and that is the whole reason it is not a row of numbers.
 * "Block 3" is unverifiable; "Block 3 (11:15–12:00)" is the thing the person
 * actually means when they say they prefer mornings. Times come from
 * `blockTime()` — the same helper the schedule grid and the TimeGrid editor
 * use, so a break override cannot make this control disagree with the timetable.
 */
const props = defineProps<{
    grid: TimeGrid | null;
    label?: string;
    help?: string;
    error?: string;
    readonly?: boolean;
}>();

const selected = defineModel<number[]>({ required: true });

const indices = computed(() => Array.from(
    { length: props.grid?.blocksPerDay ?? 0 },
    (_, index) => index,
));

/**
 * The UNIVERSAL timeline, with no day passed.
 *
 * A day-specific break makes two days genuinely disagree about when block 4
 * starts, and this control is choosing block INDICES rather than a day's worth
 * of clock time. Naming one day's times here would state the wrong thing for
 * the others; the schedule grid already shows the per-day truth.
 */
/** The read-only rendering: "1 (08:00), 2 (08:45)", or the empty-means-any note. */
const selectedSummary = computed(() => (selected.value.length
    ? selected.value.map((index) => `${index + 1} (${timeOf(index)})`).join(', ')
    : 'Any block'));

function timeOf(index: number): string {
    if (!props.grid) {
        return '';
    }

    const { start, end } = blockTime(props.grid, index);

    return `${start}–${end}`;
}

function toggle(index: number) {
    const next = new Set(selected.value ?? []);

    if (!next.delete(index)) {
        next.add(index);
    }

    selected.value = [...next].sort((a, b) => a - b);
}
</script>

<style scoped lang="scss">
.blocks {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    &_label {
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content4;
    }

    &_help {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;
    }

    &_row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }

    &_item {
        cursor: pointer;

        display: flex;
        flex-direction: column;
        gap: 2px;
        align-items: center;

        padding: var(--space-2) var(--space-3);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        background: $surface0;

        input {
            display: none;
        }

        &--on {
            border-color: $primary500;
            background: $surface2;
        }

        &-name {
            font-size: var(--font-size-sm);
            font-weight: 650;
            color: $content3;
        }

        &-time {
            font-size: var(--font-size-xs);
            font-variant-numeric: tabular-nums;
            color: $content7;
        }
    }

    &_static {
        margin: 0;
        font-size: var(--font-size-md);
        color: $content3;
    }

    &_error {
        margin: 0;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $error700;
    }
}
</style>
