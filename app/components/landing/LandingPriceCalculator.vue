<template>
    <div class="calc">
        <div class="calc_controls">
            <fieldset class="calc_group">
                <legend class="calc_legend">Your institution</legend>

                <label class="calc_field">
                    <span class="calc_label">Students</span>
                    <span class="calc_value">{{ formatCount(input.students) }}</span>
                    <input
                        v-model.number="input.students"
                        class="calc_range"
                        type="range"
                        min="100"
                        max="30000"
                        step="100"
                    >
                    <span class="calc_hint">Base tier {{ result.baseTier.id }}. Students are never billed.</span>
                </label>

                <label
                    v-for="band in LOAD_BANDS"
                    :key="band.id"
                    class="calc_field"
                >
                    <span class="calc_label">{{ band.label }} lecturers</span>
                    <span class="calc_value">{{ formatCount(input.lecturers[band.id]) }}</span>
                    <input
                        v-model.number="input.lecturers[band.id]"
                        class="calc_range"
                        type="range"
                        min="0"
                        max="500"
                        step="5"
                    >
                    <span class="calc_hint">{{ band.sessions }}, {{ formatEuro(band.rate) }} each</span>
                </label>
            </fieldset>

            <fieldset class="calc_group">
                <legend class="calc_legend">Complexity score</legend>

                <label
                    v-for="factor in COMPLEXITY_FACTORS"
                    :key="factor.id"
                    class="calc_field"
                >
                    <span class="calc_label">{{ factor.label }}</span>
                    <span class="calc_value">{{ input.complexity[factor.id].toFixed(2) }}</span>
                    <input
                        v-model.number="input.complexity[factor.id]"
                        class="calc_range"
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                    >
                    <span class="calc_hint">{{ factor.measure }}</span>
                </label>
            </fieldset>

            <fieldset class="calc_group">
                <legend class="calc_legend">Seats and services</legend>

                <label class="calc_field">
                    <span class="calc_label">Admin and scheduler seats</span>
                    <span class="calc_value">{{ formatCount(input.adminSeats) }}</span>
                    <input
                        v-model.number="input.adminSeats"
                        class="calc_range"
                        type="range"
                        min="0"
                        max="40"
                        step="1"
                    >
                    <span class="calc_hint">Only people who edit, lock or run the solver</span>
                </label>

                <label class="calc_field">
                    <span class="calc_label">Discount</span>
                    <span class="calc_value">{{ input.discountPercent }}%</span>
                    <input
                        v-model.number="input.discountPercent"
                        class="calc_range"
                        type="range"
                        min="0"
                        max="30"
                        step="1"
                    >
                    <span class="calc_hint">Applied to everything above</span>
                </label>

                <div class="calc_field">
                    <span class="calc_label">Support</span>
                    <div class="calc_choices">
                        <button
                            v-for="tier in SUPPORT_TIERS"
                            :key="tier.id"
                            class="calc_choice"
                            :class="{ 'calc_choice--on': input.support === tier.id }"
                            type="button"
                            :aria-pressed="input.support === tier.id"
                            @click="input.support = tier.id"
                        >{{ tier.label }}</button>
                    </div>
                </div>

                <div class="calc_field">
                    <span class="calc_label">Federation</span>
                    <div class="calc_choices">
                        <button
                            class="calc_choice"
                            :class="{ 'calc_choice--on': !input.federation }"
                            type="button"
                            :aria-pressed="!input.federation"
                            @click="input.federation = false"
                        >Standalone</button>
                        <button
                            class="calc_choice"
                            :class="{ 'calc_choice--on': input.federation }"
                            type="button"
                            :aria-pressed="input.federation"
                            @click="input.federation = true"
                        >Federation member</button>
                    </div>
                </div>
            </fieldset>
        </div>

        <div class="calc_readout">
            <div class="calc_totalBlock">
                <p class="calc_totalLabel">Total a year</p>
                <p
                    class="calc_total"
                    aria-live="polite"
                >{{ formatEuro(shownTotal) }}</p>
                <p class="calc_tierLine">
                    Complexity {{ result.complexityScore.toFixed(2) }},
                    tier {{ result.complexityTier.id }},
                    {{ result.complexityTier.multiplier }}x on the lecturer subtotal
                </p>
            </div>

            <div
                class="calc_bar"
                role="presentation"
            >
                <span
                    v-for="segment in segments"
                    :key="segment.id"
                    class="calc_segment"
                    :class="`calc_segment--${ segment.id }`"
                    :style="{
                        '--start': `${ segment.start }%`,
                        '--scale': segment.scale,
                    }"
                />
            </div>

            <dl class="calc_lines">
                <div
                    v-for="line in result.lines"
                    :key="line.id"
                    class="calc_line"
                    :class="{ 'calc_line--zero': line.amount === 0 }"
                >
                    <dt class="calc_lineLabel">
                        <span
                            class="calc_swatch"
                            :class="`calc_swatch--${ line.id }`"
                            aria-hidden="true"
                        />
                        {{ line.label }}
                        <span class="calc_lineDetail">{{ line.detail }}</span>
                    </dt>
                    <dd class="calc_lineAmount">{{ formatEuro(line.amount) }}</dd>
                </div>

                <div
                    v-if="result.discount !== 0"
                    class="calc_line"
                >
                    <dt class="calc_lineLabel">
                        <span
                            class="calc_swatch calc_swatch--discount"
                            aria-hidden="true"
                        />
                        Discount
                        <span class="calc_lineDetail">{{ input.discountPercent }}% off {{ formatEuro(result.subtotal) }}</span>
                    </dt>
                    <dd class="calc_lineAmount">{{ formatEuro(result.discount) }}</dd>
                </div>
            </dl>

            <div class="calc_examples">
                <p class="calc_examplesLabel">Load an example</p>
                <div class="calc_choices">
                    <button
                        v-for="scenario in SCENARIOS"
                        :key="scenario.id"
                        class="calc_choice"
                        type="button"
                        @click="load(scenario.input)"
                    >{{ scenario.short }}</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { SCENARIOS } from '~/utils/pricingContent';
import type { PriceInput } from '~/utils/pricingModel';
import {
    COMPLEXITY_FACTORS, LOAD_BANDS, SUPPORT_TIERS,
    computePrice, formatCount, formatEuro,
} from '~/utils/pricingModel';

/**
 * The interactive rate card: move a variable, watch the price move.
 *
 * WHY THIS EXISTS RATHER THAN A LONGER TABLE. The model's whole claim is that
 * price tracks measured complexity rather than a label, and that claim is
 * abstract on paper and obvious the moment somebody drags the complexity
 * sliders and watches a bill change by a factor of two without a single student
 * being added. The tables state the rates; this shows what they do.
 *
 * ANIMATION, AND WHAT EACH ONE IS FOR. There are exactly two, and neither is
 * decoration:
 *
 *   - The total eases rather than snaps (`useTweenedNumber`). A slider fires
 *     several changes a second, and between two snapped figures a reader cannot
 *     tell direction or magnitude. Easing makes "that went up a lot" legible.
 *   - The composition bar's segments slide and stretch to their new share, so a
 *     change is visible as one part of the bill growing against the others,
 *     rather than as a redrawn picture.
 *
 * THE BAR ANIMATES ON `transform` ONLY, never on width. Each segment is a
 * full-width absolutely positioned box carrying `translateX(start) scaleX(share)`
 * with a left transform origin. A percentage translation resolves against the
 * element's own UNSCALED border box, which here is the full track, so `start` is
 * a straight percentage of the bar and the scale is the share. That keeps the
 * whole thing on the compositor; transitioning `width` on six boxes would put a
 * layout pass in the middle of a drag.
 *
 * STATE IS A PLAIN REACTIVE OBJECT and the price is a `computed` over it, so
 * there is exactly one derivation of the number and nothing to keep in sync.
 *
 * The reduced-motion path is inside `useTweenedNumber` and in the CSS below:
 * both collapse to instant, and the readout is correct at every frame either
 * way.
 */

const DEFAULT_INPUT: PriceInput = {
    students: 6000,
    lecturers: { light: 60, standard: 180, heavy: 40 },
    complexity: { entanglement: 0.4, nesting: 0.35, variance: 0.45, constraints: 0.4 },
    adminSeats: 8,
    federation: false,
    support: 'standard',
    discountPercent: 0,
};

const input = reactive<PriceInput>(structuredClone(DEFAULT_INPUT));

function load(next: PriceInput): void {
    Object.assign(input, structuredClone(next));
}

const result = computed(() => computePrice(input));

const shownTotal = useTweenedNumber(() => result.value.total);

/**
 * Segment geometry for the composition bar. Zero-amount lines are dropped
 * rather than rendered at zero width, so a hairline of colour never survives
 * for a service nobody bought.
 */
const segments = computed(() => {
    const positive = result.value.lines.filter(line => line.amount > 0);
    const sum = positive.reduce((total, line) => total + line.amount, 0);
    if (sum === 0) return [];

    let cursor = 0;
    return positive.map((line) => {
        const share = line.amount / sum;
        const segment = { id: line.id, start: cursor * 100, scale: share };
        cursor += share;
        return segment;
    });
});
</script>

<style scoped lang="scss">
.calc {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
    gap: $space9;
    align-items: start;

    @include mobile {
        grid-template-columns: minmax(0, 1fr);
        gap: $space8;
    }

    &_controls {
        display: flex;
        flex-direction: column;
        gap: $space8;
    }

    &_group {
        margin: 0;
        padding: 0;
        border: none;
    }

    &_legend {
        margin-bottom: $space6;
        padding: 0;

        font-size: $fontSizeXs;
        font-weight: 700;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_field {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: $space2 $space5;
        margin-bottom: $space7;

        &:last-child {
            margin-bottom: 0;
        }
    }

    &_label {
        font-size: $fontSizeMd;
        font-weight: 700;
        color: $content2;
    }

    &_value {
        font-size: $fontSizeMd;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: $content2;
        text-align: right;
    }

    &_hint {
        grid-column: 1 / -1;
        font-size: $fontSizeSm;
        line-height: 1.5;
        color: $content7;
    }

    /*
     * The native range input, restyled rather than replaced. A custom slider
     * would have to reimplement keyboard stepping, focus and the whole ARIA
     * surface that `input[type=range]` already has correct.
     */
    &_range {
        cursor: pointer;

        grid-column: 1 / -1;

        width: 100%;
        height: $space6;
        margin: $space2 0;

        accent-color: $primary500;
    }

    &_choices {
        display: flex;
        grid-column: 1 / -1;
        flex-wrap: wrap;
        gap: $space3;

        margin-top: $space3;
    }

    &_choice {
        cursor: pointer;

        padding: $space3 $space5;
        border: 1px solid $surface5;
        border-radius: $radiusMd;

        font-size: $fontSizeSm;
        font-weight: 600;
        color: $content6;

        background: $surface0;

        @include hover {
            &:hover {
                border-color: $content7;
                color: $content2;
            }
        }

        // Selected state is fill plus ink, never colour alone: the accent is a
        // fill on this surface and fails as text against it.
        &--on {
            border-color: $content1;
            color: $surface1;
            background: $content1;
        }
    }

    &_readout {
        display: flex;
        flex-direction: column;
        gap: $space7;

        padding: $space8;
        border: 1px solid $surface5;
        border-radius: $radiusLg;

        background: $surface0;

        // Follows the readout down a long control column, so the number stays
        // visible while a slider at the bottom is being dragged. That is the
        // entire point of the component.
        @include pc {
            position: sticky;
            top: $landingBarClearance;
        }

        @include mobileOnly {
            padding: $space7 $space6;
        }
    }

    &_totalLabel {
        margin: 0 0 $space2;

        font-size: $fontSizeXs;
        font-weight: 700;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_total {
        margin: 0;

        font-size: $fontSize3Xl;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        line-height: 1.05;
        color: $content1;
        letter-spacing: -0.02em;

        @include mobileOnly {
            font-size: $fontSize2Xl;
        }
    }

    &_tierLine {
        max-width: 40ch;
        margin: $space4 0 0;

        font-size: $fontSizeSm;
        font-variant-numeric: tabular-nums;
        line-height: 1.5;
        color: $content7;
    }

    &_bar {
        position: relative;

        overflow: hidden;

        height: $space6;
        border: 1px solid $surface5;
        border-radius: $radiusSm;

        // Not `surface3`: the palest segment is drawn in it, and a segment the
        // same colour as the track it sits in is an invisible segment.
        background: $surface1;
    }

    &_segment {
        position: absolute;
        top: 0;
        left: 0;
        transform-origin: left center;
        transform: translateX(var(--start)) scaleX(var(--scale));

        width: 100%;
        height: 100%;

        @media (prefers-reduced-motion: no-preference) {
            transition: transform 450ms cubic-bezier(0.16, 1, 0.3, 1);
        }
    }

    /*
     * FIVE STEPS ACROSS BOTH NEUTRAL RAMPS, not five hues. `DESIGN.md` reserves
     * the one accent for "the system is offering you something to act on", and a
     * composition chart is not that.
     *
     * The first attempt drew all five from the content ramp, which is entirely
     * dark: base at `content1` and lecturers at `content5` were 15% apart in
     * luminance and read as one black bar. Spanning from the darkest ink to a
     * light surface gives five steps a reader can actually separate, and it
     * still inverts cleanly because both ramps swap together.
     */
    &_segment--base,
    .calc_swatch--base { background: $content1; }

    &_segment--lecturers,
    .calc_swatch--lecturers { background: $content7; }

    &_segment--seats,
    .calc_swatch--seats { background: $surface7; }

    &_segment--federation,
    .calc_swatch--federation { background: $surface6; }

    &_segment--support,
    .calc_swatch--support { background: $surface5; }

    &_swatch--discount { background: $surface3; }

    &_lines {
        display: flex;
        flex-direction: column;
        gap: $space4;
        margin: 0;
    }

    &_line {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: $space5;
        align-items: baseline;

        // Present but receded: a line at zero still tells a reader the option
        // exists and that they have not bought it.
        &--zero {
            opacity: 0.45;
        }
    }

    &_lineLabel {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: $space2 $space4;
        align-items: center;

        font-size: $fontSizeMd;
        font-weight: 700;
        color: $content2;
    }

    &_swatch {
        width: $space4;
        height: $space4;
        border-radius: 2px;
    }

    &_lineDetail {
        grid-column: 2;

        font-size: $fontSizeSm;
        font-weight: 400;
        line-height: 1.5;
        color: $content7;
    }

    &_lineAmount {
        margin: 0;

        font-size: $fontSizeMd;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: $content2;
    }

    &_examples {
        padding-top: $space6;
        border-top: 1px solid $surface5;
    }

    &_examplesLabel {
        margin: 0;

        font-size: $fontSizeXs;
        font-weight: 700;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
}
</style>
