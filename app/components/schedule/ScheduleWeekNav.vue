<template>
    <!--
        THE WEEK, CENTRED OVER THE WEEK.
        It used to sit in the toolbar's left group, beside the Term select and
        ahead of four filters — the most-changed control on the screen, filed
        among the least-changed ones. Over the grid it governs, the relationship
        is drawn rather than remembered, and the two arrows land either side of
        the thing they move.
    -->
    <div
        class="weeknav"
        role="group"
        aria-label="Week"
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
            <!--
                Keyed on the week, so Vue replaces the node and the transition
                has something to animate. The direction comes from which arrow
                moved it, so the label travels the way the week did.
            -->
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
 * Week navigation, lifted out of the toolbar.
 *
 * Its own component rather than markup in the page because it owns three things
 * that belong together: the two bounds-aware arrows, the wheel gesture, and the
 * direction the label animates. Left in the page, the direction ref would sit
 * beside unrelated editing state and the wheel binding would be the page's
 * third.
 */
const props = defineProps<{
    totalWeeks: number;
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
    display: flex;
    gap: var(--space-4);
    align-items: center;
    justify-content: center;

    padding: var(--space-2);
    border-radius: var(--radius-xl);

    background: $surface1;

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
    &_label {
        position: relative;

        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;

        min-width: 22ch;
        height: 44px;
    }

    &_value {
        position: absolute;

        display: flex;
        gap: var(--space-3);
        align-items: baseline;
        justify-content: center;

        white-space: nowrap;
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

.weeknav-next-enter-from { transform: translateX(8px); opacity: 0; }
.weeknav-next-leave-to { transform: translateX(-8px); opacity: 0; }
.weeknav-prev-enter-from { transform: translateX(-8px); opacity: 0; }
.weeknav-prev-leave-to { transform: translateX(8px); opacity: 0; }
</style>
