<template>
    <div
        ref="root"
        class="tt"
        :class="[`tt--${ variant }`, { 'tt--armed': armed, 'tt--play': playing }]"
        aria-hidden="true"
    >
        <div class="tt_frame">
            <div class="tt_cells">
                <span
                    v-for="cell in CELL_COUNT"
                    :key="cell"
                    class="tt_cell"
                />
            </div>

            <span
                v-for="(target, index) in script.targets"
                :key="`t-${ index }`"
                class="tt_target"
                :style="{
                    gridColumn: target.col,
                    gridRow: target.row,
                    '--range-start': `${ 6 + (index * 4) }%`,
                    '--i': index,
                }"
            />

            <span
                v-for="(chip, index) in script.chips"
                :key="`c-${ index }`"
                class="tt_chip"
                :class="chip.role ? `tt_chip--${ chip.role }` : undefined"
                :style="{
                    gridColumn: chip.col,
                    gridRow: `${ chip.row } / span ${ chip.span ?? 1 }`,
                    '--range-start': `${ 6 + (index * 5) }%`,
                    '--i': index,
                }"
            >
                <span class="tt_chipTitle"/>
                <span class="tt_chipMeta"/>
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * A small timetable that acts out one paragraph.
 *
 * WHY FOUR SCRIPTS AND NOT FOUR PICTURES. Each capability on the landing page
 * describes something a schedule DOES, and a still image of a grid says the same
 * nothing four times over. A session travelling into a slot, a clash appearing
 * beside an edit that was allowed anyway, a whole proposal arriving at once, a
 * field dimming to one person's row: those are the four sentences, drawn.
 *
 * SAME MATERIAL AS `LandingHeroGrid`, deliberately, and for the reason that
 * component gives: recessed `surface0` cells on a `surface5` hairline ground,
 * `surface3` chips, and the dashed `primary400` target that DESIGN.md says is
 * the one idea the accent is spent on. This is a smaller 4x4 because it sits
 * beside a paragraph rather than opposite a headline.
 *
 * DELIBERATELY ABSTRACT, and that is a taxonomy rule rather than a style choice.
 * No weekday letters and no clock times: `TimeGrid` is per-tenant, so days per
 * week and block length are data, and a marketing page drawing "Mon to Fri, 9:00"
 * would assert a grid shape the product refuses to assume.
 *
 * SCROLL-DRIVEN, NOT TIMED. These sit far down a long page, so a one-shot on
 * load would have finished before anybody reached it. `animation-timeline:
 * view()` scrubs each script against its own position instead, so the story runs
 * at the pace the reader scrolls and is complete by the time the paragraph is
 * comfortably on screen. No observer, no scroll listener, nothing to clean up.
 *
 * THE REST STATE IS THE END OF THE STORY, which is what makes all of this safe
 * to remove: a browser without scroll-driven animations, and a reader who asked
 * for reduced motion, both get the finished frame rather than an empty grid.
 * Only `opacity` and `transform` are animated.
 *
 * THE FALLBACK, for browsers with no scroll timeline (Firefox 154 still
 * reports `animation-timeline: view()` unsupported): the SAME keyframes, run
 * once on a clock instead of scrubbed, started by an IntersectionObserver
 * the first time the figure is a third on screen. Until then it holds the
 * `from` frame. Still CSS animations, so they stay smooth while the page is
 * busy; the observer only flips one class and then disconnects. Armed on the
 * client only, after `CSS.supports` says no, and never under reduced motion,
 * so the server-rendered frame and every other reader keep the finished
 * picture. Before this, a desktop Firefox reader got a still grid while the
 * same page animated on their phone.
 */
import type { TimetableVariant } from '~/utils/landingContent';

// Required, with no default: every caller picks the script that matches its own
// paragraph, and a figure that silently fell back to one of the four would be
// acting out the wrong sentence.
const props = defineProps<{ variant: TimetableVariant }>();

const COLUMNS = 4;
const ROWS = 4;
const CELL_COUNT = COLUMNS * ROWS;

interface Chip {
    col: number;
    row: number;
    span?: number;
    /** Drives the per-variant animation, and nothing else. */
    role?: 'moves' | 'clashes' | 'own' | 'other';
}

interface Script {
    chips: Chip[];
    targets: { col: number; row: number }[];
}

/**
 * Asymmetric on purpose in every variant: a real week is not a checkerboard,
 * and four identical lattices beside four different paragraphs would undo the
 * point of drawing them separately.
 */
const SCRIPTS: Record<TimetableVariant, Script> = {
    // Everything a timetable is made of, arriving piece by piece.
    model: {
        chips: [
            { col: 1, row: 1, span: 2 },
            { col: 2, row: 2 },
            { col: 3, row: 1 },
            { col: 4, row: 2, span: 2 },
            { col: 1, row: 4 },
            { col: 3, row: 3 },
        ],
        targets: [],
    },
    // One session moved by hand, and the clash it caused, recorded rather than
    // refused. The clashing chip is the one the mover now sits beside.
    editing: {
        chips: [
            { col: 1, row: 1 },
            { col: 3, row: 1, span: 2 },
            { col: 2, row: 3, role: 'moves' },
            { col: 2, row: 4, role: 'clashes' },
            { col: 4, row: 4 },
        ],
        targets: [],
    },
    // A whole proposal, arriving at once, with slots still on offer.
    solver: {
        chips: [
            { col: 1, row: 1 },
            { col: 2, row: 1, span: 2 },
            { col: 4, row: 1 },
            { col: 1, row: 3, span: 2 },
            { col: 3, row: 3 },
            { col: 4, row: 4 },
        ],
        targets: [
            { col: 3, row: 2 },
            { col: 2, row: 4 },
        ],
    },
    // The same week, reduced to the sessions one person is actually in.
    people: {
        chips: [
            { col: 1, row: 1, role: 'other' },
            { col: 2, row: 2, role: 'own' },
            { col: 3, row: 1, span: 2, role: 'other' },
            { col: 4, row: 3, role: 'other' },
            { col: 1, row: 3, role: 'other' },
            { col: 2, row: 4, role: 'own' },
        ],
        targets: [],
    },
};

const script = computed(() => SCRIPTS[props.variant]);

const root = useTemplateRef<HTMLElement>('root');

/** Fallback mode: hold the start frame until the figure scrolls into view. */
const armed = ref(false);
/** The one-shot trigger: set once, never unset, so the story cannot rewind. */
const playing = ref(false);

onMounted(() => {
    const scrubbable = CSS.supports('animation-timeline: view()');
    const motionOk = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

    if (scrubbable || !motionOk || !root.value) {
        return;
    }

    armed.value = true;

    const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
            playing.value = true;
            observer.disconnect();
        }
    }, { threshold: 0.35 });

    observer.observe(root.value);
    onBeforeUnmount(() => observer.disconnect());
});
</script>

<style scoped lang="scss">
.tt {
    --cell-height: 34px;
    --hairline: 1px;

    width: 100%;

    @include mobile {
        --cell-height: 30px;
    }

    &_frame {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        grid-template-rows: repeat(4, var(--cell-height));
        gap: var(--hairline);

        padding: var(--hairline);
        border-radius: $radiusLg;

        // The gaps ARE the hairlines, so one background draws every rule and
        // they stay exactly 1px at any zoom or device pixel ratio.
        background: $surface5;
    }

    &_cells {
        display: grid;
        grid-column: 1 / -1;
        grid-row: 1 / -1;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        grid-template-rows: repeat(4, var(--cell-height));
        gap: var(--hairline);
    }

    &_cell {
        background: $surface0;
    }

    &_target {
        z-index: 1;
        border: 2px dashed $primary400;
        border-radius: $radiusMd;
        background: varToRgba('primary500', 0.09);
    }

    &_chip {
        z-index: 2;

        display: flex;
        flex-direction: column;
        justify-content: center;

        padding: 0 $space3;
        border-radius: $radiusMd;

        background: $surface3;
    }

    /*
     * The clash. An outline rather than a fill, because the chip underneath is
     * still a perfectly real session: the product's rule is warn, never block,
     * and a session drawn as an error would say the edit was refused. Warm ink
     * on the warning ramp, which is the only ramp this figure borrows.
     */
    &_chip--clashes {
        box-shadow: inset 0 0 0 2px $warning600;
    }

    &_chipTitle,
    &_chipMeta {
        height: 3px;
        border-radius: 2px; // Half the height: a pill end, not a scale step.
    }

    &_chipTitle {
        width: 62%;

        // Ink on a surface, so the pair keeps its relationship when the two
        // ramps swap for the dark theme.
        background: varToRgba('content4', 0.34);
    }

    &_chipMeta {
        width: 36%;
        margin-top: $space1;
        background: varToRgba('content4', 0.16);
    }

    // The dimmed field of somebody else's sessions. This is a RESTING state, not
    // an animated one: the paragraph's claim is that you see your own slice, so
    // the finished picture is already reduced.
    &--people &_chip--other {
        opacity: 0.22;
    }
}

/*
 * THE SCRIPTS. Added only where motion is welcome AND the browser can drive an
 * animation from scroll position. Everything above is already the finished
 * frame, so this whole block can fail to apply without leaving a gap.
 *
 * `animation-range` starts at a per-element offset set inline as `--range-start`,
 * which is how the stagger is expressed: a scroll timeline has no meaningful
 * `animation-delay`, so sequencing has to live in the range rather than in time.
 */
@media (prefers-reduced-motion: no-preference) {
    @supports (animation-timeline: view()) {
        .tt_chip,
        .tt_target {
            animation-duration: 1ms; // Scrubbed: the timeline supplies progress.
            animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
            animation-fill-mode: both;
            animation-timeline: view();
            animation-range: entry var(--range-start, 6%) cover 42%;
        }

        // Assembling. Each piece arrives from slightly above, in order.
        .tt--model .tt_chip {
            animation-name: tt-arrive;
        }

        // The proposal lands as one answer rather than as six decisions, so the
        // chips share a range and scale up together; the targets that remain on
        // offer fade in after them.
        .tt--solver .tt_chip {
            animation-name: tt-propose;
            animation-range: entry 8% cover 38%;
        }

        .tt--solver .tt_target {
            animation-name: tt-offer;
            animation-range: entry 24% cover 52%;
        }

        // The edit: one session travels a column, and the clash it lands next to
        // announces itself rather than stopping it.
        .tt--editing .tt_chip {
            animation-name: tt-arrive;
        }

        .tt--editing .tt_chip--moves {
            animation-name: tt-travel;
            animation-range: entry 14% cover 46%;
        }

        .tt--editing .tt_chip--clashes {
            animation-name: tt-flag;
            animation-range: entry 30% cover 56%;
        }

        // The field reducing to one person's sessions. Their own chips arrive
        // normally; everybody else's fade back to the resting 0.22.
        .tt--people .tt_chip--own {
            animation-name: tt-arrive;
        }

        .tt--people .tt_chip--other {
            animation-name: tt-recede;
            animation-range: entry 16% cover 48%;
        }
    }
}

/*
 * THE TIMED FALLBACK. Same keyframes as the scrubbed scripts above, on a clock,
 * once. `--i` is the chip's index, set inline beside `--range-start`, and it
 * gives the 60ms stagger the scroll range gave the scrubbed version. The house
 * ease-out; durations in the explanatory band, since this is a marketing
 * figure and nothing here is waiting on a click.
 *
 * Armed (`tt--armed`) holds the `from` frame; `tt--play` starts the clock.
 * `animation-fill-mode: both` is what makes a delayed chip sit at its start
 * frame during its delay rather than flashing to the finished one.
 */
@media (prefers-reduced-motion: no-preference) {
    @supports not (animation-timeline: view()) {
        .tt--armed .tt_chip,
        .tt--armed .tt_target {
            opacity: 0;
        }

        .tt--armed.tt--play .tt_chip,
        .tt--armed.tt--play .tt_target {
            animation-duration: 560ms;
            animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
            animation-fill-mode: both;
            animation-delay: calc(var(--i, 0) * 60ms);
        }

        .tt--armed.tt--play.tt--model .tt_chip,
        .tt--armed.tt--play.tt--editing .tt_chip,
        .tt--armed.tt--play.tt--people .tt_chip--own {
            animation-name: tt-arrive;
        }

        // One answer, not six decisions: the proposal lands together, and the
        // slots still on offer follow it.
        .tt--armed.tt--play.tt--solver .tt_chip {
            animation-name: tt-propose;
            animation-duration: 480ms;
            animation-delay: 0ms;
        }

        .tt--armed.tt--play.tt--solver .tt_target {
            animation-name: tt-offer;
            animation-duration: 400ms;
            animation-delay: calc(360ms + var(--i, 0) * 80ms);
        }

        // The edit lands after the field has settled; the clash announces itself
        // after the edit.
        .tt--armed.tt--play.tt--editing .tt_chip--moves {
            animation-name: tt-travel;
            animation-duration: 640ms;
            animation-delay: 320ms;
        }

        .tt--armed.tt--play.tt--editing .tt_chip--clashes {
            animation-name: tt-flag;
            animation-duration: 720ms;
            animation-delay: 560ms;
        }

        .tt--armed.tt--play.tt--people .tt_chip--other {
            animation-name: tt-recede;
            animation-duration: 900ms;
            animation-delay: calc(120ms + var(--i, 0) * 40ms);
        }
    }
}

@keyframes tt-arrive {
    from {
        transform: translateY(-6px);
        opacity: 0;
    }

    to {
        transform: none;
        opacity: 1;
    }
}

@keyframes tt-propose {
    from {
        transform: scale(0.94);
        opacity: 0;
    }

    to {
        transform: none;
        opacity: 1;
    }
}

@keyframes tt-offer {
    from {
        transform: scale(0.9);
        opacity: 0;
    }

    to {
        transform: none;
        opacity: 1;
    }
}

/*
 * One column left and one row up, expressed in the chip's own size plus the
 * hairline so the distance stays exact at every viewport.
 */
@keyframes tt-travel {
    from {
        transform: translate(calc(-100% - var(--hairline)), calc(-100% - var(--hairline)));
        opacity: 0.5;
    }

    to {
        transform: none;
        opacity: 1;
    }
}

@keyframes tt-flag {
    0% {
        transform: translateY(-6px);
        opacity: 0;
        box-shadow: inset 0 0 0 2px transparent;
    }

    60% {
        transform: none;
        opacity: 1;
        box-shadow: inset 0 0 0 2px transparent;
    }

    100% {
        transform: none;
        opacity: 1;
        box-shadow: inset 0 0 0 2px $warning600;
    }
}

@keyframes tt-recede {
    0% {
        transform: translateY(-6px);
        opacity: 0;
    }

    45% {
        transform: none;
        opacity: 1;
    }

    100% {
        transform: none;
        opacity: 0.22;
    }
}
</style>
