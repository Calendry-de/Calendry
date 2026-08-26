<template>
    <span
        class="logo"
        :class="wordmark ? 'logo--lockup' : ''"
    >
        <svg
            class="logo_mark"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            :role="wordmark ? 'presentation' : 'img'"
            :aria-label="wordmark ? undefined : 'Calendry'"
            :aria-hidden="wordmark ? 'true' : undefined"
        >
            <path
                d="M79.5 70.7 A36 36 0 1 1 79.5 29.3"
                stroke="currentColor"
                :stroke-width="weights.c"
            />
            <path
                d="M37 41 L62 41"
                stroke="currentColor"
                :stroke-width="weights.row"
                stroke-linecap="round"
            />
            <path
                d="M37 50 L53 50"
                stroke="currentColor"
                :stroke-width="weights.row"
                stroke-linecap="round"
            />
            <path
                class="logo_accent"
                d="M37 59 L59 59"
                :stroke-width="weights.row"
                stroke-linecap="round"
            />
            <circle
                class="logo_node"
                cx="59"
                cy="59"
                :r="weights.node"
            />
        </svg>

        <span
            v-if="wordmark"
            class="logo_wordmark"
        >alendry</span>
    </span>
</template>

<script setup lang="ts">
/**
 * The Calendry mark — concept 11C from the "Calendry logo concepts" design
 * project: a heavy C whose counter holds three agenda rows of unequal length,
 * the last one accented and terminating in a node.
 *
 * THE MARK IS A CAPITAL LETTER, and every rule below follows from that. It
 * supplies the C of "Calendry", so the wordmark is `alendry` and the lockup is
 * set the way type is: the mark sized to the cap height of the word beside it,
 * sitting on the same baseline, with the overshoot a round capital gets.
 *
 * The first version instead gave both the same px value and centred them on
 * each other. Both halves of that were wrong, and visibly so: a font's cap
 * height is ~0.71em, so a 26px mark next to 26px text stood a seventh taller
 * than the letters it was leading — the word read as the small half — and
 * `align-items: center` centres the LINE BOX, whose descender space pushed the
 * lowercase band below the mark's middle. It sat low and small, which is
 * exactly how it looked.
 *
 * So `size` is the type size, and the mark is derived from it:
 *
 *   ink = 0.90 × box   the drawing spans y 5..95 of its 100-unit viewBox
 *   ink = 1.04 × cap   a round form overshoots the cap line and the baseline
 *   box = 1.155 × cap  the two together
 *
 * `1cap` is a real font metric resolved by the browser, so the lockup re-fits
 * itself to whatever the UI font is rather than to a ratio measured once. The
 * `em` value beside it is the same figure for Noto Sans (cap 0.714em) and is
 * only reached by browsers without the unit.
 *
 * The ink strokes are `currentColor`, not a fixed value. The design was drawn
 * on a light ground with `#1A2230` ink, which is invisible on this app's dark
 * theme (`surface0: #131316`); inheriting the surrounding text colour keeps
 * the mark legible in both themes and lets a call site tint it by setting
 * `color`. Only the accent is fixed, as `$brandAccent`.
 *
 * Stroke weights are optically compensated, following the design rather than
 * scaling one drawing: 11C is drawn twice there, at 170px with 18/5/5.5 and at
 * 30px with 20/6/6. A single set scaled down goes spindly at small sizes, so
 * the heavier set is used below `HEAVY_BELOW` — measured against the mark's
 * own rendered size, which in a lockup is not `size`.
 */

const HEAVY_BELOW = 48;

/** The mark's box, as a multiple of cap height. See the derivation above. */
const BOX_PER_CAP = 1.155;

/** Cap height of Noto Sans, for the `1cap` fallback only. */
const NOTO_SANS_CAP = 0.714;

const props = withDefaults(defineProps<{
    /**
     * Type size in px. With `wordmark`, this is the wordmark's font size and
     * the mark is fitted to its cap height; without one, the mark is `size`
     * square, since then there is no type for it to be fitted to.
     */
    size?: number;
    /** Render the `alendry` lockup after the mark. */
    wordmark?: boolean;
}>(), {
    size: 30,
    wordmark: false,
});

const sizePx = computed(() => `${ props.size }px`);

const markPx = computed(() => (props.wordmark
    ? props.size * NOTO_SANS_CAP * BOX_PER_CAP
    : props.size));

const weights = computed(() => (markPx.value < HEAVY_BELOW
    ? { c: 20, row: 6, node: 6 }
    : { c: 18, row: 5, node: 5.5 }));
</script>

<style scoped lang="scss">
// Kept in step with BOX_PER_CAP / NOTO_SANS_CAP in the script above: the
// script needs the figure to pick a stroke weight, the stylesheet to size the
// box, and neither can read the other's.
$boxPerCap: 1.155;
$notoCap: 0.714;

.logo {
    display: inline-flex;
    align-items: center;
    font-size: v-bind(sizePx);

    &_mark {
        flex: none;
        width: 1em;
        height: 1em;
    }

    &_accent {
        stroke: $brandAccent;
    }

    &_node {
        fill: $brandAccent;
    }

    &_wordmark {
        font-size: 1em;
        font-weight: 500;
        line-height: 1;
        letter-spacing: -0.01em;
    }
}

// The lockup: the mark stops being an icon beside a word and becomes the
// word's first letter.
.logo--lockup {

    // No gap. The drawing already carries 13% of its own box as clearance on
    // the right (its ink stops at x=87 of 100, since the C opens that way), so
    // an explicit gap lands on top of built-in whitespace and reads as a word
    // break rather than a letter space.
    gap: 0;
    // Baseline, not centre. The mark is a capital, so it sits on the same line
    // the letters do — and unlike `center`, this is unaffected by the
    // descender space in the line box, which is what pushed it low before.
    align-items: baseline;

    .logo_mark {
        // Baseline alignment puts the BOX's bottom edge on the baseline, but
        // the ink stops 5% of the box above that. Drop it by that 5% plus the
        // 2% of cap height a round capital overshoots below the baseline:
        // (0.05 + 0.02 / 1.155) of the box.
        transform: translateY(6.7%);
        width: #{ $notoCap * $boxPerCap }em;
        height: #{ $notoCap * $boxPerCap }em;
    }

    // The browser's own cap-height metric wherever it exists, so the fit
    // survives a change of UI font; the em values above are the same figure
    // worked out for Noto Sans, and are all an older browser gets.
    @supports (width: 1cap) {
        .logo_mark {
            width: calc(1cap * #{ $boxPerCap });
            height: calc(1cap * #{ $boxPerCap });
        }
    }
}
</style>
