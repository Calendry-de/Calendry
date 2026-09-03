<template>
    <div class="hero">
        <div class="hero_measure">
            <div class="hero_copy">
                <LandingStatusBadge
                    :label="t('landing.hero.statusLabel')"
                    :detail="`v${ version }`"
                />

                <h1 class="hero_title">
                    <span class="hero_titleLine">{{ t('landing.hero.titleLineOne') }}</span>
                    <span class="hero_titleLine">{{ t('landing.hero.titleLineTwo') }}</span>
                </h1>

                <p class="hero_lead">
                    {{ t('landing.hero.lead') }}
                </p>

                <LandingCta/>

                <p class="hero_proof">
                    {{ t('landing.hero.proof') }}
                </p>
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
 * ONE ACTION, WHICH IS THE CHANGE. This block used to carry two buttons, "Get
 * in touch" and "See what works today". A landing page is allowed exactly one
 * primary action and no competing action above the fold: a second button does
 * not add a route to conversion, it splits the reader's attention at the one
 * moment the page has all of it. The section the second button pointed at is
 * still there, still reachable from the nav capsule, and now reached by
 * scrolling, which is what a reader who wants it does anyway. The button is
 * `LandingCta`, shared with the closing call to action so the two are literally
 * the same element.
 *
 * FIVE ELEMENTS, AND THAT IS THE BUDGET: badge, headline, one sentence, the
 * action, one proof line. It carried five before too, but the fifth was a
 * second paragraph naming the audience; that sentence is `LandingAudience` one
 * band lower, and the slot it freed went to the proof line, because the thing a
 * reader needs at the top of a page about an unfinished product is a reason to
 * believe the rest of it.
 *
 * THE HEADLINE IS TWO MESSAGES, not one sentence the browser breaks. The break
 * is authored, at the point where the thought breaks: the first line is what
 * the software does, the second is the promise that it does not do it alone,
 * and those are the two halves a reader has to hold. `text-wrap: balance` on
 * one long string would have put the break wherever the measure fell, which on
 * this headline lands mid-clause. See `landingTagline()` for why two messages
 * rather than one with a break character in it.
 *
 * The figure is not decoration filling a right-hand column: it is the only
 * place above the fold where a reader can see what a timetable looks like here,
 * and it carries the surface's one authored motion. See `LandingHeroGrid` for
 * why it is an abstraction rather than a screenshot.
 *
 * ORDER MATTERS AT NARROW WIDTHS. The copy comes first in the DOM and the
 * figure follows, so a phone reader meets the sentence and the action before
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
     * `$content1Orig` is #18181B, which is on the design system's own list of
     * permitted dark grounds, so this band was already inside the system before
     * the system was written down here. Flat, never a gradient: the one gradient
     * this page is allowed is on the headline text below.
     *
     * `overflow: hidden` is what lets the figure bleed past the measure without
     * a `100vw` breakout, which overflows horizontally the moment a scrollbar
     * takes up space.
     */
    overflow: hidden;

    // Top padding clears the FIXED capsule, which floats over this block rather
    // than reserving flow above it. See `$landingBarClearance`.
    padding: $landingBarClearance $space7 $space13;
    background: $content1;

    @include mobileOnly {
        padding: $space11 $space5 $space10;
    }

    &_measure {
        display: grid;

        // 8/4 rather than 6/5. The headline is the point of this block and it
        // needs the width to break in two lines at the display step; the figure
        // gives up column width and takes it back by bleeding right.
        grid-template-columns: minmax(0, 8fr) minmax(0, 4fr);
        gap: $space11;
        align-items: center;

        width: min(1040px, 100%);
        margin: 0 auto;

        @include mobile {
            grid-template-columns: minmax(0, 1fr);
            gap: $space10;
        }
    }

    &_copy {
        display: flex;
        flex-direction: column;
        gap: $space6;
        align-items: start;
    }

    &_title {
        /*
         * 680px, from the design system, and it replaces a `20ch` cap. `ch`
         * measured the headline in its own glyphs, so the German headline (six
         * characters longer) got a wider column than the English one and broke
         * in a different place. A px cap gives every language the same measure
         * and lets the authored break do its job.
         */
        max-width: 680px;
        margin: 0;

        font-size: $fontSize4Xl;
        font-weight: 700;

        /*
         * The scale's own paired leading for this step, which is 1. Tight is
         * correct for a two-line display headline, and the system does not
         * allow a line height chosen separately from the size that was snapped
         * onto the scale.
         */
        line-height: $lineHeight4Xl;

        /*
         * THE ONE GRADIENT ON THE PAGE, and it is on text. Backgrounds are flat
         * everywhere; a heading fading from full contrast toward about 60% is
         * the single exception the design system carves out, and this is it.
         *
         * WHICH DIRECTION FOLLOWS THE GROUND, NOT THE THEME NAME, and that is
         * the whole subtlety of putting it here. The system states the pair as
         * white-to-grey on a dark theme and black-to-grey on a light one, which
         * assumes the heading sits on the page's own ground. This band is
         * deliberately INVERSE, so in the light theme the hero is dark and
         * takes the white pair, and in the dark theme the hero is light and
         * takes the black pair. Keying this on the theme name instead would put
         * white text on a near-white ground for every reader using dark mode.
         *
         * `color` is set before the clip so a browser without
         * `background-clip: text` renders an ordinary solid heading rather than
         * a transparent one. That is a real fallback, not a formality: an
         * invisible headline is the worst first paint this page could have.
         */
        color: $surface1;

        @supports (background-clip: text) or (-webkit-background-clip: text) {
            background-image: linear-gradient(to right, #FFF, #9B9B9B);

            // Unprefixed only. `-webkit-background-clip` was here and
            // stylelint's own config strips the prefix, which turned the pair
            // into a duplicate declaration; every browser that supports
            // `background-clip: text` at all now supports it unprefixed.
            // `-webkit-text-fill-color` is NOT the same property and does have
            // to stay: it is what makes the glyphs transparent so the gradient
            // shows through.
            background-clip: text;

            -webkit-text-fill-color: transparent;
        }

        letter-spacing: -0.02em;

        /*
         * THE DARK THEME FLIPS THE GROUND, SO THE GRADIENT FLIPS WITH IT.
         *
         * NO `:global()` HERE, and that is the fix for a real bug rather than a
         * style preference. This was written as `:global(.theme-dark) &`, which
         * looks like the obvious way to reach a class that lives on `<html>`.
         * Vue's scoped-CSS transform collapses `:global(X) Y` down to just `X`,
         * so the rule compiled to a BARE, UNSCOPED `.theme-dark { ... }`:
         * verified in the served CSS, not assumed.
         *
         * That did three things, none of them the intended one. The headline
         * kept the light-ground gradient in the dark theme, where this band's
         * ground has flipped light, so it was white on white. The declarations
         * escaped the component onto `<html>`, painting a background GRADIENT
         * across every page of the app in dark mode, which the design system
         * forbids outright. And a stray `color` went with them, overriding the
         * app's own default ink app-wide.
         *
         * A plain descendant needs no `:global()` at all: scoping attaches the
         * component's attribute to the LAST compound selector and leaves
         * ancestors alone, so this compiles to
         * `.theme-dark .hero_title[data-v-…]`. Scoped, and one class more
         * specific than the base rule, which is what makes it win.
         *
         * ONLY `background-image` IS RESTATED. The fallback `color` above is
         * `$surface1`, a custom property that already swaps with the theme, so
         * repeating it was both unnecessary and the source of the leaked
         * `color` declaration.
         */
        .theme-dark & {
            @supports (background-clip: text) or (-webkit-background-clip: text) {
                background-image: linear-gradient(to right, #000, #666);
            }
        }

        // 3xl on a tablet, where the copy no longer has a full column to break
        // two lines in. Paired leading moves with it.
        @include mobile {
            font-size: $fontSize3Xl;
            line-height: $lineHeight3Xl;
        }

        // Was 24px here, the size of a desktop section title, which left the
        // page with no display step at all on a phone.
        @include mobileOnly {
            font-size: $fontSize2Xl;
            line-height: $lineHeight2Xl;
        }
    }

    &_titleLine {
        display: block;
    }

    &_lead {
        // 680px, the same measure as the headline, per the design system.
        max-width: 680px;
        margin: 0;

        font-size: $fontSizeLg;
        line-height: $lineHeightLg;
        color: $surface3;

        // Balances the last line so no single word is left sitting alone.
        text-wrap: pretty;

        @include mobileOnly {
            font-size: $fontSizeMd;
            line-height: $lineHeightMd;
        }
    }

    &_proof {
        max-width: 680px;
        margin: 0;

        font-size: $fontSizeSm;
        line-height: $lineHeightSm;
        color: $surface5;
        text-wrap: pretty;
    }

    /*
     * `.hero_measure > .hero_figure`, NOT `.hero_figure`. The class sits on
     * `LandingHeroGrid`'s root, whose own scoped `.grid { width: 100% }` has
     * the same specificity, so whichever stylesheet the browser met LAST won:
     * the server inlines this component's CSS before the child's (325px, no
     * bleed), the client bundle injects them the other way round (421px). The
     * figure therefore drew at column width and jumped a third wider about a
     * second in, when the client CSS arrived, which read as a broken entrance
     * animation. The extra compound makes this rule win in both orders.
     */
    &_measure > &_figure {
        /*
         * BLEEDS RIGHT, past the measure and off the edge of the section. The
         * figure gave up two columns of grid width above and takes the presence
         * back this way: it is the only place above the fold a reader sees what
         * a timetable looks like here, and at four columns it had become a
         * thumbnail. A fixed overflow rather than a viewport calculation, for
         * the scrollbar reason in `.hero`'s own comment.
         *
         * Desktop only. Below that the figure is stacked under the copy at full
         * width, where there is no margin to bleed into.
         */
        @include pc {
            width: calc(100% + #{$space13});
        }

        @include mobile {
            order: 2;
        }
    }
}
</style>
