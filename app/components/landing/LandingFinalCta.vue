<template>
    <section
        id="talk"
        class="final"
    >
        <div class="final_measure">
            <h2 class="final_title">{{ t('landing.section.finalCta.title') }}</h2>

            <!--
                No lead. It said "the useful conversation is about your
                institution: how many rooms and cohorts, what your week looks
                like, and what breaks today", and the contact section directly
                underneath opens with the same sentence. Said once, where the
                form is; here the title, the action and the risk line are the
                whole band, which is what a final CTA is for.
            -->
            <div class="final_action">
                <LandingCta/>
            </div>

            <LandingRiskReversal class="final_risk"/>
        </div>
    </section>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';

/**
 * The closing call to action, and the page's second inverse band.
 *
 * IDENTICAL TO THE HERO'S, which is a rule rather than a preference: the design
 * system requires the final action to be the same action, and the way to
 * guarantee that is for both to be `LandingCta` with no variant prop between
 * them. Restating the button here with its own styling is how the two drift
 * until the bottom of the page offers something the top did not.
 *
 * THE INVERSE GROUND IS WHY `LandingCta` NEEDS NO TONE. This band and the hero
 * are the only two on the page painted from the opposite end of the ramp, so
 * the button appears on exactly one ground and can be measured against exactly
 * one. It also bookends the page: a reader who scrolls the whole argument
 * arrives back at the surface they started on.
 *
 * NOT A `LandingSection`. That component puts a heading in a stacked, aside or
 * narrow composition beside a body, and this band has no body: it is a heading,
 * a sentence and a button, centred. Passing it through the section scaffold
 * would mean adding a fourth layout that exists for one caller.
 *
 * THE ACTION IS WRAPPED RATHER THAN REVEALED DIRECTLY, and the wrapper exists
 * for exactly that. `LandingCta` animates its own `transform` on hover and
 * press; the reveal is an `animation` on `transform` with `both` fill, and a
 * finished filled animation outranks every declaration in the cascade, so
 * putting it on the button itself would leave the page's one primary action
 * permanently unable to move under a press. The wrapper takes the reveal, the
 * button keeps its feedback.
 *
 * THE RISK LINE SITS UNDER THE BUTTON, not above it. It answers the objection
 * the click itself raises ("what am I signing up for"), and an objection
 * answered before it is felt reads as a disclaimer.
 */
const { t } = useT();
</script>

<style scoped lang="scss">
.final {
    padding: $space13 $space7;

    // Same inverse ground as the hero, and the same reason: expressed in
    // `content*` tokens so it is always the opposite of the page's own ground
    // and needs no per-theme override.
    background: $content1;

    @include mobileOnly {
        padding: $space11 $space5;
    }

    &_measure {
        display: flex;
        flex-direction: column;
        gap: $space6;
        align-items: center;

        width: min(680px, 100%);
        margin: 0 auto;
    }

    &_title {
        /*
         * FOUR STEPS, IN THE ORDER THE READER NEEDS THEM: the claim, the
         * sentence that qualifies it, the action, and the line that answers
         * what the action costs. This band is one centred column with nothing
         * beside it, so all four cross the viewport edge within a few pixels
         * of each other and would otherwise arrive as a single slab.
         */
        @include landingReveal($shift: 16px);

        margin: 0;

        font-size: $fontSize3Xl;
        font-weight: 700;
        line-height: $lineHeight3Xl;
        color: $surface1;
        text-align: center;
        text-wrap: balance;
        letter-spacing: -0.02em;

        @include mobileOnly {
            font-size: $fontSize2Xl;
            line-height: $lineHeight2Xl;
        }
    }

    /*
     * Less blur than everything above it, deliberately. This is the one element
     * on the page a reader is trying to hit, and a 12px blur on a button label
     * is a legibility cost paid for nothing: the travel alone already places it
     * in the sequence.
     */
    &_action {
        @include landingReveal($shift: 12px, $blur: 4px, $order: 1);
    }

    // The risk line's default ink is set for the page ground; on this band it
    // takes the inverse ramp, the same swap the hero's lead makes. Set through
    // the property the component exposes, so the override does not depend on
    // stylesheet order. See `LandingRiskReversal`.
    &_risk {
        @include landingReveal($shift: 12px, $blur: 4px, $order: 2);

        --risk-ink: #{$surface5};
    }
}
</style>
