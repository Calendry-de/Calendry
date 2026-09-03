<template>
    <section
        id="who"
        class="audience"
        aria-labelledby="who-title"
    >
        <div class="audience_measure">
            <p
                id="who-title"
                class="audience_line"
            >
                {{ t('landing.audience.line') }}
            </p>
        </div>
    </section>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';

/**
 * Who the product is for, as the only thing on its line.
 *
 * WHY IT IS A BAND AND NOT A HERO PARAGRAPH. This sentence used to be the
 * fourth text element in the hero, between the lead and the buttons, set at
 * body size in the secondary colour. It is the line that tells a reader whether
 * to keep reading, and it was doing that job in the one position where it also
 * pushed the primary action down the screen. Moved here it costs the hero
 * nothing and gains the whole width.
 *
 * NO TINT, DELIBERATELY, and this is a palette fact rather than a preference.
 * A band on this surface would normally be marked by a recessed ground, but
 * `surface0` measures 1.04:1 against the `surface1` page ground: it is not a
 * visible surface, which is exactly the finding that removed the card grid from
 * `LandingCapabilityGrid`. The only ground on this palette with real separation
 * is the inverse one, and the technical section already spends it. So the band
 * is drawn with scale and space instead, which cost no contrast at all.
 *
 * IT IS LEFT-ALIGNED, AND IT WAS NOT AT FIRST. The sentence was offset to the
 * right with `margin-left: auto`, on the theory that the page's second
 * full-width moment should not restate the hero's left edge. On the page that
 * read as a stray card rather than as a composition: every other block on this
 * surface begins on the same left edge, so one paragraph floating right looked
 * like a mistake, and the empty half beside it looked like a section that had
 * failed to load. An offset needs something to be offset FROM, and with the
 * hero figure already ended above it there was nothing.
 *
 * It earns its separation by scale and space instead, which is what the rest of
 * the page does too.
 */
const { t } = useT();
</script>

<style scoped lang="scss">
.audience {
    /*
     * `$space8`, not `$space10`: one sentence between the hero and the first
     * section, and at 48px above and below it floated in its own band of air,
     * a stranded paragraph rather than the hero's last line.
     */
    padding: $space8 $space7;

    @include mobileOnly {
        padding: $space7 $space5;
    }

    // The same 1040px column every other section uses, so this block starts on
    // the page's one left edge. Without it the paragraph was measured against
    // the whole viewport and did not line up with anything above or below it.
    &_measure {
        width: min(1040px, 100%);
        margin: 0 auto;
    }

    &_line {
        // Wider than the 68ch prose measure would suggest because the type is
        // larger: at 24px this is about three lines, which is the length a
        // single statement can be before it stops being one.
        // 48ch: three balanced lines at this size, not four narrow ones
        // beside an empty half of the measure.
        max-width: 48ch;
        margin: 0;

        // One step under the hero's display size and one over a section title,
        // which is the whole hierarchy claim: louder than a heading, quieter
        // than the headline it qualifies.
        font-size: $fontSizeXl;
        line-height: $lineHeightXl;
        color: $content2;
        text-wrap: balance;

        @include landingReveal(16px);

        @include mobile {
            max-width: 46ch;
            font-size: $fontSizeLg;
        }

        @include mobileOnly {
            max-width: 100%;
        }
    }
}
</style>
