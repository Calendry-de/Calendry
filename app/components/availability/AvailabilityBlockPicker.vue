<template>
    <!--
        A FIELDSET, like `ManageWeekdayPicker`. This was a `div` with the group
        name in a bare `span` bound to nothing, so a screen reader announced
        eight unrelated checkboxes with no idea what they were blocks OF.
    -->
    <fieldset class="blocks">
        <legend v-if="label">{{ label }}</legend>

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
                <!--
                    A REAL, VISIBLE checkbox. This input carried
                    `display: none`, which takes a control out of the focus
                    order AND out of the accessibility tree: all eight blocks
                    were unreachable by keyboard and invisible to assistive
                    technology, on both /my pages (WCAG 2.1.1 and 4.1.2, both
                    Level A). Since the block axis is the only way to say "not
                    this time of day", the sole window a keyboard user could
                    express was the whole day, the most destructive one.

                    Showing it rather than visually-hiding it also restores the
                    non-colour selection signal the chip never had: `--on`
                    changed the ground by a measured 1.09:1 and the border by
                    2.81:1, so selection was conveyed by little more than hue.
                    The tick is unambiguous in greyscale, and it is what the
                    sibling picker has always done.
                -->
                <input
                    :checked="selected.includes(index)"
                    type="checkbox"
                    @change="toggle(index)"
                >
                <span class="blocks_item-text">
                    <span class="blocks_item-name">{{ index + 1 }}</span>
                    <span class="blocks_item-time">{{ timeOf(index) }}</span>
                </span>
            </label>
        </div>

        <!--
            Read-only renders the selection as TEXT, never as disabled
            checkboxes: a disabled control reads as "unavailable right now"
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
    </fieldset>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';
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
 * `blockTime()`, the same helper the schedule grid and the TimeGrid editor
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

const { t } = useT();

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
    : t('availability.blockPicker.anyBlock')));

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

    // A fieldset carries UA margin, padding and a border; all three go.
    margin: 0;
    padding: 0;
    border: 0;

    legend {
        padding: 0 0 var(--space-3);
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
        gap: var(--space-3);
        align-items: center;

        padding: var(--space-2) var(--space-3);
        // The chip's ground is 1.04:1 from its container's, so this border is
        // what identifies it; no surface step reaches 1.4.11's 3:1.
        border: 1px solid $content7;
        border-radius: var(--radius-lg);

        background: $surface0;

        input {
            flex: none;
            margin: 0;
            accent-color: $primary500;
        }

        /*
         * The ring goes on the CHIP, not the 13px checkbox inside it: the
         * visible control is the whole label, so that is what focus should
         * outline. `:focus-within` is how a wrapper reports its input's focus.
         */
        &:focus-within {
            outline: 2px solid $primary600;
            outline-offset: var(--space-1);
        }

        &--on {
            border-color: $primary500;
            background: $surface2;
        }

        &-text {
            display: flex;
            flex-direction: column;
            gap: var(--space-1);
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
