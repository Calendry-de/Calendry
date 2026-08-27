<template>
    <!--
        THE WEEK, CENTRED OVER THE WEEK. It sat in the toolbar's left group ahead
        of four filters — the most-changed control filed among the least-changed
        ones. Over the grid it governs, the arrows land either side of the thing
        they move.
    -->
    <div
        class="weeknav"
        :class="{ 'weeknav--loading': loading }"
        role="group"
        aria-label="Week"
        :aria-busy="loading"
        @wheel="stepOnWheel"
    >
        <button
            class="weeknav_step"
            type="button"
            :disabled="week <= 1"
            aria-label="Previous week"
            @click="step(-1)"
        >
            <Icon
                name="material-symbols:chevron-left"
                aria-hidden="true"
            />
        </button>

        <p class="weeknav_label">
            <!-- Keyed on the week so Vue replaces the node and the transition
                 has something to animate; direction comes from which arrow
                 moved it. -->
            <Transition :name="`weeknav-${direction}`">
                <span
                    :key="week"
                    class="weeknav_value"
                >
                    <span class="weeknav_number">Week {{ week }}</span>
                    <span class="weeknav_total">of {{ totalWeeks }}</span>
                    <span
                        v-if="rangeLabel"
                        class="weeknav_range"
                    >{{ rangeLabel }}</span>
                </span>
            </Transition>
        </p>

        <button
            class="weeknav_step"
            type="button"
            :disabled="week >= totalWeeks"
            aria-label="Next week"
            @click="step(1)"
        >
            <Icon
                name="material-symbols:chevron-right"
                aria-hidden="true"
            />
        </button>
    </div>
</template>

<script setup lang="ts">
import { useWheelStep } from '~/composables/wheelStep';

/**
 * Week navigation: its own component because it owns three things that belong
 * together — the bounds-aware arrows, the wheel gesture, and the direction the
 * label animates.
 */
const props = defineProps<{
    totalWeeks: number;
    /**
     * The week's sessions are being refetched.
     *
     * Shown ON the control that caused it, because that is where the reader is
     * looking. The frame no longer unmounts while this is true, so without a
     * signal here a slow step would look like nothing happened.
     */
    loading?: boolean;
    /**
     * The dates this week covers, already formatted. Optional and resolved by
     * the caller: turning a term week into a calendar date needs the Term, and
     * this component deliberately knows only about weeks.
     */
    rangeLabel?: string;
}>();

const week = defineModel<number>({ required: true });

/**
 * Which way the label should travel. Held rather than derived, because the
 * animation needs to know the direction of the LAST change and a computed over
 * the current value cannot say where it came from.
 */
const direction = ref<'next' | 'prev'>('next');

function step(by: 1 | -1) {
    const next = week.value + by;

    if (next < 1 || next > props.totalWeeks) {
        return;
    }

    direction.value = by > 0 ? 'next' : 'prev';
    week.value = next;
}

const stepOnWheel = useWheelStep({
    canStep: (by) => {
        const next = week.value + by;

        return next >= 1 && next <= props.totalWeeks;
    },
    step,
});
</script>

<style scoped lang="scss">
.weeknav {
    /*
     * NO CARD. It carried `$surface1` at `--radius-xl` — byte-identical chrome
     * to the toolbar, 14px above it — so at a squint it read as a second toolbar
     * row, which is exactly what moving it out of the toolbar was meant to stop.
     * Unframed, it reads as the grid's caption, which is what it is.
     */
    position: relative;

    display: flex;
    gap: var(--space-4);
    align-items: center;
    justify-content: center;

    padding: var(--space-2);

    /*
     * A hairline under the label only, so the week visually sits ON the grid
     * rather than beside it. Drawn on the label's stage, not the whole row: the
     * arrows are controls, not part of the caption.
     */
    &--loading &_label::after {
        transform: scaleX(1);
    }

    &_step {
        cursor: pointer;

        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;

        // Centred, and it has to be said: the target is 44px while the icon is
        // 18px, so without this the glyph sits in the corner of its own button.
        min-width: 44px;
        min-height: 44px;
        border: 0;
        border-radius: var(--radius-lg);

        color: $content6;

        background: none;

        transition: background 140ms cubic-bezier(0.16, 1, 0.3, 1),
            color 140ms cubic-bezier(0.16, 1, 0.3, 1);

        svg {
            width: 18px;
            height: 18px;
        }

        @include hover() {
            &:hover {
                color: $content1;
                background: varToRgba('primary500', 0.12);
            }
        }

        &:disabled {
            cursor: default;
            color: $surface6;
            background: none;
        }
    }

    /*
     * A FIXED-WIDTH STAGE for the label.
     *
     * The two nodes overlap during the transition, so the container cannot size
     * to its content without the arrows jumping apart and back on every step —
     * the one motion nobody asked for. `min-width` is generous enough for the
     * longest form the label takes.
     */

    /*
     * A STAGE THAT CAN GROW.
     *
     * It was a fixed `min-width: 22ch` with `overflow: hidden` and absolutely
     * positioned children — which meant text longer than 22ch was silently
     * CLIPPED mid-word. English fits; "Woche 1 von 19 · 5. Okt – 9. Okt" does
     * not, and German runs ~30% longer as a rule. A control that truncates its
     * own value without saying so is worse than one that shifts a few pixels.
     *
     * Both label nodes now occupy the same GRID AREA instead of being absolute,
     * so the stage sizes to the wider of them and nothing is cut. `min-width`
     * stays as a floor — that is what stops the arrows twitching between "Week
     * 9" and "Week 10" — and the box grows past it only when the content
     * genuinely needs more. `overflow: hidden` is kept for the transition: it
     * clips the ±8px slide, which is the wipe.
     */
    &_label {
        overflow: hidden;
        display: grid;
        grid-template-areas: 'label';
        place-items: center center;

        min-width: 24ch;
        min-height: 44px;
    }

    &_value {
        display: flex;
        grid-area: label;
        gap: var(--space-3);
        align-items: baseline;
        justify-content: center;

        white-space: nowrap;
    }

    /*
     * A determinate-looking bar would be a lie — the fetch reports no progress.
     * A 2px rule that simply appears under the label says "this is being
     * replaced" and nothing more, and it appears on the element whose value is
     * about to change.
     */
    &_label::after {
        content: '';

        position: absolute;
        bottom: var(--space-3);
        left: 50%;
        transform-origin: center;
        transform: scaleX(0);
        translate: -50% 0;

        width: 40%;
        height: 2px;
        border-radius: 2px;

        background: $primary500;

        transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    &_number {
        font-size: var(--font-size-lg);
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        color: $content1;
    }

    &_total {
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content6;
    }

    &_range {
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content7;
    }
}

/*
 * The label travels the way the week did — 4px and 140ms, the house ease.
 * Present, not noticed: it is a step, not an event, and the authored moment on
 * this screen belongs to placement mode.
 */
.weeknav-next-enter-active,
.weeknav-next-leave-active,
.weeknav-prev-enter-active,
.weeknav-prev-leave-active {
    transition: opacity 140ms cubic-bezier(0.16, 1, 0.3, 1),
        transform 140ms cubic-bezier(0.16, 1, 0.3, 1);
}

.weeknav-next-enter-from {
    transform: translateX(8px);
    opacity: 0;
}

.weeknav-next-leave-to {
    transform: translateX(-8px);
    opacity: 0;
}

.weeknav-prev-enter-from {
    transform: translateX(-8px);
    opacity: 0;
}

.weeknav-prev-leave-to {
    transform: translateX(8px);
    opacity: 0;
}

</style>
