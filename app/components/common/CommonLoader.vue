<template>
    <div
        class="loading-screen"
        :class="smol ? 'loading-screen-smol' : ''"
    >
        <svg
            class="loader"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Loading"
        >
            <path
                class="loader_c"
                d="M79.5 70.7 A36 36 0 1 1 79.5 29.3"
                stroke-width="18"
            />
            <path
                class="loader_row loader_row--1"
                d="M37 59 L62 59"
                stroke-width="5"
                stroke-linecap="round"
            />
            <path
                class="loader_row loader_row--2"
                d="M37 59 L53 59"
                stroke-width="5"
                stroke-linecap="round"
            />
            <path
                class="loader_row loader_row--3"
                d="M37 59 L59 59"
                stroke-width="5"
                stroke-linecap="round"
            />
        </svg>
    </div>
</template>

<script setup lang="ts">
/**
 * Loader 13A ("Queue") from the "Calendry logo concepts" design project, and
 * the only loader in the app — four call sites render this one component.
 *
 * The C never moves. Rows enter at the bottom in the brand accent, turn ink as
 * they step up a slot, and fade out at the top: three rows on one 2.7s
 * keyframe, offset by a third of the cycle each with negative delays so the
 * queue is already full at first paint rather than filling in from empty.
 *
 * The ink colour is `$content4`, the body text colour, rather than the
 * design's `#1A2230` — that value is invisible on this app's dark theme, and
 * a keyframe interpolating to `currentColor` resolves against whatever the
 * call site happens to inherit. A token is both theme-correct and fixed.
 *
 * `translateY` steps are in USER UNITS, not px: the viewBox is 100×100, so a
 * -9 step is one row pitch (rows sit at y=41/50/59) whatever the rendered
 * size. That is what lets `smol` change one width and nothing else.
 */

defineProps({
    smol: {
        type: Boolean,
    },
});
</script>

<style scoped lang="scss">
.loading-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 300px;

    &-smol {
        height: fit-content;

        .loader {
            width: 22px;
            height: 22px;
        }
    }
}

.loader {
    width: 48px;
    height: 48px;

    &_c {
        stroke: $content4;
    }

    &_row {
        stroke: $brandAccent;
        animation: cal-queue 2.7s cubic-bezier(0.6, 0, 0.25, 1) infinite;

        // Negative delays, so the queue starts mid-cycle and is full on the
        // first frame. A positive delay would show one row and stagger the
        // other two in, which reads as the loader itself still loading.
        &--2 {
            animation-delay: -0.9s;
        }

        &--3 {
            animation-delay: -1.8s;
        }
    }
}

@keyframes cal-queue {
    0%,
    28% {
        transform: translateY(0);
        opacity: 1;
        stroke: $brandAccent;
    }

    33%,
    61% {
        transform: translateY(-9px);
        opacity: 1;
        stroke: $content4;
    }

    66%,
    92% {
        transform: translateY(-18px);
        opacity: 1;
        stroke: $content4;
    }

    99%,
    100% {
        transform: translateY(-27px);
        opacity: 0;
        stroke: $content4;
    }
}

// A reader who asked for less motion still needs to know something is in
// flight. Rather than freeze the queue mid-step — which stacks all three rows
// on the bottom slot, since that is where they are drawn — park them at the
// three slots they occupy in the static 11C mark (rows at y=41/50/59, the
// bottom one accented) and let the whole lockup breathe.
@media (prefers-reduced-motion: reduce) {
    .loader_row {
        animation: cal-queue-still 1.8s ease-in-out infinite;
        animation-delay: 0s;

        &--1 {
            transform: translateY(-18px);
            stroke: $content4;
        }

        &--2 {
            transform: translateY(-9px);
            stroke: $content4;
        }
    }
}

@keyframes cal-queue-still {
    0%,
    100% {
        opacity: 0.4;
    }

    50% {
        opacity: 1;
    }
}

</style>
