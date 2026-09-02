<template>
    <div class="hero">
        <div class="hero_measure">
            <div class="hero_copy">
                <LandingStatusBadge
                    :label="t('landing.hero.statusLabel')"
                    :detail="`v${ version }`"
                />

                <h1 class="hero_title">
                    {{ t('landing.hero.title') }}
                </h1>

                <p class="hero_lead">
                    {{ t('landing.hero.lead') }}
                </p>

                <div class="hero_actions">
                    <CommonButton
                        type="primary"
                        href="#contact"
                    >{{ t('landing.action.getInTouch') }}</CommonButton>
                    <CommonButton
                        type="secondary"
                        href="#built"
                    >{{ t('landing.hero.secondaryAction') }}</CommonButton>
                </div>
            </div>

            <LandingHeroGrid class="hero_figure"/>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';

/**
 * One sentence on what this is, and the product itself.
 *
 * FOUR ELEMENTS, AND THAT IS THE BUDGET: badge, headline, one sentence, the
 * buttons. It used to carry five, because a second paragraph named the audience
 * ("registrars, timetabling officers and department heads...") between the lead
 * and the actions. That sentence is the one that tells a reader whether the
 * product is for them, so it was not cut: it is the whole of `LandingAudience`
 * now, one band lower, where it is the only thing on the line instead of the
 * fourth thing above the fold. The lead itself went from thirty words to
 * nineteen for the same reason. A hero that does not fit the first screen puts
 * its own call to action below it.
 *
 * The figure is not decoration filling a right-hand column: it is the only
 * place on the page where a reader can see what a timetable looks like here,
 * and it carries the surface's one authored motion. See `LandingHeroGrid` for
 * why it is an abstraction rather than a screenshot.
 *
 * ORDER MATTERS AT NARROW WIDTHS. The copy comes first in the DOM and the
 * figure follows, so a phone reader meets the sentence and both buttons before
 * the grid: the figure never pushes the primary action below the fold.
 *
 * The version comes from `runtimeConfig.public.version` rather than being typed
 * in, for the same reason the review screen derives its structural-rule count
 * from the catalogue instead of writing "3": a number stated in prose is a
 * number nothing checks, and this one moves on every release.
 */
const { t } = useT();
const config = useRuntimeConfig();

const version = computed(() => config.public.version);
</script>

<style scoped lang="scss">
.hero {
    /*
     * THE INVERSE GROUND, and it is the same device the technical band and the
     * capability grid's lead tile already use: `content1` as a ground with
     * `surface*` as ink. Because both ramps swap wholesale with the theme, this
     * is always the opposite of whatever ground the page currently has, so it
     * needs no dark-mode override and cannot come out the same colour as the
     * page. In the dark theme it reads as a light hero, exactly as the technical
     * band reads as a light band.
     *
     * The accent is untouched by this: Signal Teal still appears only on the
     * figure's placement target and the primary button, which is the One Signal
     * Rule and the reason the hero can be this loud without becoming decoration.
     *
     * `overflow: hidden` is what lets the figure bleed past the measure without
     * a `100vw` breakout, which overflows horizontally the moment a scrollbar
     * takes up space.
     */
    overflow: hidden;

    // Top padding clears the FIXED capsule, which floats over this block rather
    // than reserving flow above it. See `$landingBarClearance`.
    padding: $landingBarClearance $space7 $space11;
    background: $content1;

    @include mobileOnly {
        padding: $space10 $space5 $space9;
    }

    &_measure {
        display: grid;

        // 8/4 rather than 6/5. The headline is the point of this block and it
        // needs the width to break in two lines at the display step; the figure
        // gives up column width and takes it back by bleeding right.
        grid-template-columns: minmax(0, 8fr) minmax(0, 4fr);
        gap: $space10;
        align-items: center;

        width: min(1040px, 100%);
        margin: 0 auto;

        @include mobile {
            grid-template-columns: minmax(0, 1fr);
            gap: $space9;
        }
    }

    &_copy {
        display: flex;
        flex-direction: column;
        gap: $space6;
        align-items: start;
    }

    &_title {
        max-width: 20ch;
        margin: 0;

        font-size: $fontSize4Xl;
        font-weight: 700;
        line-height: 1.05;
        color: $surface1;
        text-wrap: balance;
        letter-spacing: -0.02em;

        // 3xl on a tablet, where the copy no longer has a 650px column to break
        // two lines in.
        @include mobile {
            max-width: 24ch;
            font-size: $fontSize3Xl;
        }

        // Was 24px here, the size of a desktop section title, which left the
        // page with no display step at all on a phone.
        @include mobileOnly {
            font-size: $fontSize2Xl;
        }
    }

    &_lead {
        max-width: 54ch;
        margin: 0;

        font-size: $fontSizeLg;
        line-height: 1.6;
        color: $surface3;

        @include mobileOnly {
            font-size: $fontSizeMd;
        }
    }

    &_actions {
        display: flex;
        flex-wrap: wrap;
        gap: $space5;
        margin-top: $space3;

        /*
         * The secondary button is `background: transparent` with the app's
         * default body ink, which on this ground is about 1.5:1 and effectively
         * invisible. It gets the inverse ramp's ink plus a stroke, because a
         * ghost button on a dark ground with no edge is a link pretending to be
         * a button. Set here rather than through `CommonButton`'s colour props:
         * those take values out of `colorsList`, which is literal hex and would
         * not swap with the theme, and the whole point of this band is that it
         * does.
         */
        :deep(.button--type-secondary) {
            border: 1px solid $surface5;
            color: $surface1;
        }
    }

    &_figure {
        /*
         * BLEEDS RIGHT, past the measure and off the edge of the section. The
         * figure gave up two columns of grid width above and takes the presence
         * back this way: it is the only place on the page a reader sees what a
         * timetable looks like here, and at four columns it had become a
         * thumbnail. A fixed overflow rather than a viewport calculation, for
         * the scrollbar reason in `.hero`'s own comment.
         *
         * Desktop only. Below that the figure is stacked under the copy at full
         * width, where there is no margin to bleed into.
         */
        @include pc {
            width: calc(100% + #{$space11});
        }

        @include mobile {
            order: 2;
        }
    }
}
</style>
