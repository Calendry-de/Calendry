<template>
    <div
        class="opener"
        :style="{ '--opener-scale': String(1 / speed) }"
    >
        <div
            class="opener_reveal"
            :class="playing ? 'opener_reveal--playing' : ''"
        >
            <slot/>
        </div>

        <div
            v-if="showVeil"
            class="opener_veil"
            role="presentation"
            aria-hidden="true"
            @animationend="onVeilEnd"
        >
            <svg
                class="opener_mark"
                viewBox="0 0 100 100"
                :width="markSize"
                :height="markSize"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path
                    d="M79.5 70.7 A36 36 0 1 1 79.5 29.3"
                    class="opener_c"
                    stroke-width="18"
                />
                <defs>
                    <linearGradient
                        :id="fadeId"
                        x1="0"
                        y1="30"
                        x2="0"
                        y2="70"
                        gradientUnits="userSpaceOnUse"
                    >
                        <stop offset="0" stop-color="#000"/>
                        <stop offset="0.22" stop-color="#fff"/>
                        <stop offset="0.78" stop-color="#fff"/>
                        <stop offset="1" stop-color="#000"/>
                    </linearGradient>
                    <mask
                        :id="maskId"
                        maskUnits="userSpaceOnUse"
                        x="20"
                        y="28"
                        width="60"
                        height="46"
                    >
                        <rect
                            x="20"
                            y="28"
                            width="60"
                            height="46"
                            :fill="`url(#${ fadeId })`"
                        />
                    </mask>
                </defs>
                <g :mask="`url(#${ maskId })`">
                    <path
                        class="opener_row opener_row--1"
                        d="M37 59 L62 59"
                        stroke-width="5"
                        stroke-linecap="round"
                    />
                    <path
                        class="opener_row opener_row--2"
                        d="M37 59 L53 59"
                        stroke-width="5"
                        stroke-linecap="round"
                    />
                    <path
                        class="opener_row opener_row--3"
                        d="M37 59 L59 59"
                        stroke-width="5"
                        stroke-linecap="round"
                    />
                </g>
                <circle
                    class="opener_node"
                    cx="59"
                    cy="59"
                    r="5.5"
                />
            </svg>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * The page opener — the 11C mark assembling itself on a dark stage, then
 * zooming through the viewport to hand over to the page behind it. Imported
 * from `Calendry Intro.dc.html` in the "Calendry logo concepts" project.
 *
 * WHAT IT IS FOR. One brand moment on arrival, not a loading state: it is
 * deliberately not tied to any fetch, and the page underneath is fully rendered
 * the whole time. `CommonLoader` is the thing for "we are waiting".
 *
 * HOW TO USE IT. Wrap what should be revealed, and control it with `v-model`:
 *
 *     <common-page-opener v-model="opening">
 *         <my-page/>
 *     </common-page-opener>
 *
 * It sets the model to `false` and emits `done` when the veil has lifted. The
 * slot renders identically whether or not it is playing, so nothing downstream
 * needs to know.
 *
 * WHY THE ANIMATION IS PURE CSS AND JS ONLY TIDIES UP. Every step — the rows,
 * the node, the zoom, the veil, the reveal — is a keyframe with
 * `animation-fill-mode: both`, ending at the state the page needs: veil
 * transparent, content at opacity 1. So if hydration is slow, fails, or never
 * happens, the opener still finishes and the page is still usable. JS removes
 * the element afterwards; it is not what makes it go away.
 *
 * That is also why `finished` starts false on the server: the veil must be in
 * the FIRST HTML or it cannot cover the first paint, which is the entire point.
 * Deciding whether to play at all is the caller's job (see `useFirstVisit`),
 * and it has to be a decision the server can make.
 *
 * REDUCED MOTION is handled in CSS, not here, for the same reason: a
 * `matchMedia` check cannot run until hydration, by which point the flash it
 * was meant to prevent has already happened. Under `prefers-reduced-motion` the
 * veil is `display: none` from the first byte and the content is simply there.
 */

const props = withDefaults(defineProps<{
    /** Whether the opener is playing. Wrapped by `v-model`. */
    modelValue?: boolean;
    /**
     * Multiplies the whole timeline: 2 runs it twice as fast, 0.5 half speed.
     * One knob rather than five, because the steps overlap — the zoom starts
     * before the rows have settled and the reveal starts before the veil has
     * gone, and independent durations would let a caller pull those apart into
     * something that no longer reads as one movement.
     */
    speed?: number;
    /** Rendered size of the mark on the stage, in px. */
    markSize?: number;
}>(), {
    modelValue: false,
    speed: 1,
    markSize: 200,
});

const emit = defineEmits<{
    'update:modelValue': [value: boolean];
    done: [];
}>();

// SVG ids are document-global, so two openers on one page (or an opener beside
// anything else using these names) would have the second mask silently
// overwrite the first. `useId()` is stable across server and client.
const uid = useId();
const fadeId = `opener-fade-${ uid }`;
const maskId = `opener-mask-${ uid }`;

const playing = computed(() => props.modelValue);

// Guards the uncontrolled case. `done` asks the parent to set the model false,
// but nothing obliges it to, and a veil that outlived its own animation would
// sit there at opacity 0 forever.
const finished = ref(false);
const showVeil = computed(() => playing.value && !finished.value);

function finish() {
    if (finished.value) return;

    finished.value = true;
    emit('update:modelValue', false);
    emit('done');
}

/*
 * Reduced motion is settled in CSS — the veil is `display: none` from the first
 * byte, so there is nothing to see and nothing to wait for. But `display: none`
 * also means no `animationend`, so without this the component would sit
 * `playing` forever and never tell its caller it was over. This is bookkeeping
 * after the fact, not the thing that prevents the flash.
 */
onMounted(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) finish();
});

/**
 * The veil's own fade-out is the LAST thing in the timeline, so its
 * `animationend` is the honest end of the opener. Listening for it beats a
 * `setTimeout` mirroring the CSS: a timer and a stylesheet holding the same
 * durations is two definitions of one number, and the failure is a veil torn
 * away mid-fade or a dead overlay left swallowing clicks.
 */
function onVeilEnd(event: AnimationEvent) {
    // The veil is an ancestor of the mark, whose own animations bubble their
    // end events through it. Only the veil's own fade means the opener is over.
    if (event.target !== event.currentTarget) return;

    finish();
}
</script>

<style scoped lang="scss">
// The stage is dark in BOTH themes — it is a brand moment, not a surface — so
// it is drawn from the `*Orig` values, which are the palette's light-base
// constants and do not follow the theme swap. `$content0` would invert to
// near-white in dark mode and open the site with a full-screen flash.
$stage: $content0Orig;
$ink: $surface0Orig;
$accent: $primary400Orig; // one step up from the brand, which is what a ramp is for

.opener {
    &_veil {

        // Never intercepts a click, even mid-zoom: the page behind it is real
        // and already interactive.
        pointer-events: none;

        position: fixed;
        z-index: 100;
        inset: 0;

        // The mark reaches scale(17) — several thousand px — so without this it
        // would extend the document and put scrollbars on the page it is
        // covering.
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;

        background: $stage;

        animation: opener-veil calc(0.5s * var(--opener-scale)) ease-out calc(2.3s * var(--opener-scale)) both;
    }

    &_mark {
        animation: opener-zoom calc(1s * var(--opener-scale)) cubic-bezier(0.7, 0, 0.3, 1) calc(1.85s * var(--opener-scale)) both;
    }

    &_c {
        stroke: $ink;
    }

    &_row {
        transform-origin: 37px 50px;
        transform-box: view-box;

        // Each row has its own keyframe rather than one shared track with
        // delays: they enter from different depths and arrive at different
        // slots, and the third stays accent while the first two turn ink.
        &--1 {
            animation: opener-row-1 calc(1.7s * var(--opener-scale)) cubic-bezier(0.55, 0, 0.2, 1) both;
        }

        &--2 {
            animation: opener-row-2 calc(1.7s * var(--opener-scale)) cubic-bezier(0.55, 0, 0.2, 1) both;
        }

        &--3 {
            animation: opener-row-3 calc(1.7s * var(--opener-scale)) cubic-bezier(0.55, 0, 0.2, 1) both;
        }
    }

    &_node {
        transform-origin: 59px 59px;
        transform-box: view-box;
        fill: $accent;
        animation: opener-node calc(0.5s * var(--opener-scale)) cubic-bezier(0.3, 1.5, 0.5, 1) calc(1.5s * var(--opener-scale)) both;
    }

    &_reveal--playing {
        animation: opener-reveal calc(0.8s * var(--opener-scale)) cubic-bezier(0.2, 0, 0.2, 1) calc(2.1s * var(--opener-scale)) both;
    }
}

@keyframes opener-row-1 {
    0% {
        transform: translateY(9px);
        opacity: 0;
        stroke: $accent;
    }
    7% { opacity: 1; }

    26%, 30% {
        transform: translateY(0);
        stroke: $accent;
    }

    50%, 54% {
        transform: translateY(-9px);
        stroke: $ink;
    }

    74%, 100% {
        transform: translateY(-18px);
        opacity: 1;
        stroke: $ink;
    }
}

@keyframes opener-row-2 {
    0% {
        transform: translateY(18px);
        opacity: 0;
        stroke: $accent;
    }

    14%, 20% {
        transform: translateY(18px);
        opacity: 1;
        stroke: $accent;
    }

    40%, 44% {
        transform: translateY(9px);
        stroke: $accent;
    }

    64%, 100% {
        transform: translateY(-9px);
        opacity: 1;
        stroke: $ink;
    }
}

@keyframes opener-row-3 {
    0% {
        transform: translateY(27px);
        opacity: 0;
        stroke: $accent;
    }
    22% { opacity: 0; }

    28%, 34% {
        transform: translateY(27px);
        opacity: 1;
    }
    54%, 58% { transform: translateY(18px); }

    78%, 100% {
        transform: translateY(0);
        opacity: 1;
        stroke: $accent;
    }
}

@keyframes opener-node {
    0% { transform: scale(0); }
    100% { transform: scale(1); }
}

// Scale 17 is what carries the C's counter past the viewport edge at 200px on a
// large screen; the small overshoot first is what makes it read as a push
// rather than a dissolve.
@keyframes opener-zoom {
    0% {
        transform: scale(1);
        opacity: 1;
    }

    22% {
        transform: scale(1.06);
        opacity: 1;
    }

    100% {
        transform: scale(17);
        opacity: 0;
    }
}

@keyframes opener-veil {
    to { opacity: 0; }
}

@keyframes opener-reveal {
    0% {
        transform: scale(1.03);
        opacity: 0;
    }

    100% {
        transform: scale(1);
        opacity: 1;
    }
}

/*
 * No opener at all, rather than a fast one.
 *
 * The source design collapses every duration to 0.01s under reduced motion,
 * which still puts a full-screen dark panel on screen for a frame — the exact
 * hard cut the setting exists to avoid. Removing the veil outright and leaving
 * the content unanimated is the honest reading: nothing here carries
 * information, so nothing is lost by not showing it.
 *
 * `animation: none` on the reveal is load-bearing, not tidiness: its keyframe
 * starts at `opacity: 0`, so a reduced-motion visitor would otherwise get an
 * invisible page.
 */
@media (prefers-reduced-motion: reduce) {
    .opener_veil {
        display: none;
    }

    .opener_reveal--playing {
        animation: none;
    }
}
</style>
