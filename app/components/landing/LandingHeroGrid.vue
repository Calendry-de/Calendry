<template>
    <div
        class="grid"
        aria-hidden="true"
    >
        <div class="grid_frame">
            <div class="grid_cells">
                <span
                    v-for="cell in CELL_COUNT"
                    :key="cell"
                    class="grid_cell"
                />
            </div>

            <span
                v-for="target in TARGETS"
                :key="`t-${ target.col }-${ target.row }`"
                class="grid_target"
                :style="{ gridColumn: target.col, gridRow: target.row }"
            />

            <span
                v-for="(chip, index) in CHIPS"
                :key="`c-${ index }`"
                class="grid_chip"
                :style="{
                    gridColumn: chip.col,
                    gridRow: `${ chip.row } / span ${ chip.span }`,
                    '--settle-order': index,
                }"
            >
                <span class="grid_chipTitle"/>
                <span class="grid_chipMeta"/>
            </span>

            <span
                class="grid_chip grid_chip--moving"
                :style="{ gridColumn: MOVER.col, gridRow: `${ MOVER.row } / span ${ MOVER.span }` }"
            >
                <span class="grid_chipTitle"/>
                <span class="grid_chipMeta"/>
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * The hero's figure: a week of sessions, and the product's one authored moment.
 *
 * WHY THIS EXISTS. The page had no image of a timetable — 1,500 words of copy
 * about a schedule, and twelve stock icons where the product should have been.
 * A screenshot would go stale on the next UI change and would need a real
 * tenant's data to look honest; a stock illustration would say nothing. So this
 * is the schedule surface's own geometry, drawn from the same tokens: recessed
 * `$surface0` cells on a `$surface5` hairline ground, `$surface3` session chips,
 * and the dashed `$primary400` placement target that `DESIGN.md` calls the one
 * idea the accent is spent on.
 *
 * DELIBERATELY ABSTRACT, AND THAT IS A TAXONOMY RULE, NOT A STYLE CHOICE. There
 * are no weekday letters and no clock times, because `TimeGrid` is per-tenant:
 * days per week, blocks per day and block length are all data, and a marketing
 * page that drew "Mon–Fri, 9:00" would be asserting a grid shape the product
 * refuses to assume. Chips carry two neutral rules where their text would be
 * rather than invented session names. Nothing here claims to be a real
 * timetable, so nothing here can be wrong about one.
 *
 * THE MOTION IS THE PRODUCT'S GESTURE, not an entrance effect. It replays what
 * placement mode actually does: the grid arrives, sessions settle, the other
 * sessions dim to 0.35 while two candidate slots reveal their dashed target,
 * one session travels into the slot it was offered, and the field returns to
 * full contrast with the second candidate still standing. Every value — the
 * 0.35 dim, the dashed violet target, the 140ms-family ease-out — is the one
 * already shipped in `ScheduleGrid`.
 *
 * The rest state is the FINAL state, so the figure is complete with no
 * animation at all: the sequence is added only under
 * `prefers-reduced-motion: no-preference`, and a reader who asked for less
 * motion gets the composed picture, targets included, rather than an empty box.
 * Only `opacity` and `transform` are animated, and the travel distance is
 * expressed in the chip's own size so it stays exact at every viewport.
 */
const COLUMNS = 5;
const ROWS = 6;
const CELL_COUNT = COLUMNS * ROWS;

interface Placement {
    col: number;
    row: number;
    span: number;
}

/** Asymmetric on purpose: a real week is not a checkerboard. */
const CHIPS: Placement[] = [
    { col: 1, row: 1, span: 2 },
    { col: 1, row: 4, span: 1 },
    { col: 2, row: 2, span: 1 },
    { col: 3, row: 1, span: 1 },
    { col: 3, row: 3, span: 2 },
    { col: 4, row: 2, span: 2 },
    { col: 5, row: 4, span: 2 },
    { col: 2, row: 6, span: 1 },
];

/**
 * The session that moves, placed in the slot it ENDS in — so its rest position
 * is the truth and the animation only offsets it backwards to where it came
 * from. Offsetting the destination instead would leave the reduced-motion
 * reader looking at a chip parked in the wrong cell.
 */
const MOVER: Placement = { col: 4, row: 5, span: 1 };

/**
 * Two candidates, because placement mode offers a set rather than a single
 * answer — and because the mover lands on the first, the second is what keeps a
 * visible target in the composition once the sequence has finished.
 */
const TARGETS = [
    { col: 4, row: 5 },
    { col: 2, row: 4 },
];
</script>

<style scoped lang="scss">
.grid {
    // Fluid cells, floored so the chips never collapse into stripes.
    --cell-height: 38px;
    --hairline: 1px;

    width: 100%;

    @include mobile {
        --cell-height: 32px;
    }

    &_frame {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        grid-template-rows: repeat(6, var(--cell-height));
        gap: var(--hairline);

        padding: var(--hairline);
        border-radius: $radiusLg;

        // The gaps ARE the hairlines: one background behind a 1px-gapped grid
        // draws 24 rules without 24 borders, and keeps them exactly 1px at any
        // zoom or device pixel ratio.
        background: $surface5;
    }

    &_cells {
        // Explicit repeats rather than `subgrid`: this layer covers the parent's
        // whole area, so the two track lists are identical by construction and
        // the figure does not depend on subgrid support to draw its own ground.
        display: grid;
        grid-column: 1 / -1;
        grid-row: 1 / -1;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        grid-template-rows: repeat(6, var(--cell-height));
        gap: var(--hairline);
    }

    &_cell {
        background: $surface0;
    }

    &_target {
        // Sits above the cell layer, below the chips.
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

        padding: 0 $space4;
        border-radius: $radiusMd;

        background: $surface3;

        &--moving {
            // Above its neighbours while it travels, and it keeps the accent
            // ring it was offered so the pairing reads at rest.
            z-index: 3;
            box-shadow: 0 2px 6px varToRgba('content4', 0.16);
        }
    }

    &_chipTitle,
    &_chipMeta {
        height: 3px;
        border-radius: 2px;
    }

    &_chipTitle {
        width: 66%;
        // Ink, not a lighter surface: `content*` on `surface*` keeps the same
        // relationship when the two ramps swap for the dark theme.
        background: varToRgba('content4', 0.34);
    }

    &_chipMeta {
        width: 38%;
        margin-top: $space1;
        background: varToRgba('content4', 0.16);
    }
}

/*
 * THE SEQUENCE — added only when motion is welcome. Everything above is already
 * the finished state, so this layer can be removed entirely without leaving a
 * gap in the composition.
 */
@media (prefers-reduced-motion: no-preference) {
    .grid_cells {
        animation: grid-layer-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .grid_chip {
        animation:
            grid-chip-settle 320ms cubic-bezier(0.16, 1, 0.3, 1) calc(200ms + var(--settle-order, 0) * 45ms) both,
            grid-chip-dim 1100ms ease-in-out 800ms both;
    }

    .grid_target {
        animation: grid-target-in 320ms cubic-bezier(0.16, 1, 0.3, 1) 850ms both;
    }

    /*
     * The travel. `--settle-order` is unset here, so the mover settles with the
     * first group and then leaves; the offset is its own size plus the hairline,
     * which is exactly one column right and three rows up.
     */
    .grid_chip--moving {
        animation:
            grid-chip-settle 320ms cubic-bezier(0.16, 1, 0.3, 1) 200ms both,
            grid-chip-move 520ms cubic-bezier(0.16, 1, 0.3, 1) 1000ms both;
    }
}

@keyframes grid-layer-in {
    from {
        opacity: 0;
    }

    to {
        opacity: 1;
    }
}

@keyframes grid-chip-settle {
    from {
        transform: translateY(-6px);
        opacity: 0;
    }

    to {
        transform: translateY(0);
        opacity: 1;
    }
}

/* Placement mode: everything not being placed steps back, then returns. */
@keyframes grid-chip-dim {
    0% {
        opacity: 1;
    }

    18%,
    62% {
        opacity: 0.35;
    }

    100% {
        opacity: 1;
    }
}

@keyframes grid-target-in {
    from {
        transform: scale(0.94);
        opacity: 0;
    }

    to {
        transform: scale(1);
        opacity: 1;
    }
}

@keyframes grid-chip-move {
    from {
        transform: translate(calc(100% + var(--hairline)), calc(-300% - 3 * var(--hairline)));
    }

    to {
        transform: translate(0, 0);
    }
}
</style>
