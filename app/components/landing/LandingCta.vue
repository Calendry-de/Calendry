<template>
    <a
        class="cta"
        :href="target.href"
        :rel="target.booking ? 'noopener' : undefined"
    >
        <span class="cta_label">{{ label }}</span>

        <Icon
            class="cta_icon"
            :name="target.booking ? 'ph:calendar-check' : 'ph:paper-plane-tilt'"
            aria-hidden="true"
        />
    </a>
</template>

<script setup lang="ts">
import { landingCtaTarget } from '~/utils/landingContent';
import { useT } from '~/composables/i18n';

/**
 * The page's ONE primary action, as one component rendered twice.
 *
 * WHY THIS IS NOT `CommonButton`. The design system pins a landing page's main
 * button to exact values: 16px semibold label, 8px vertical and 12px horizontal
 * padding, a press state, and a named easing curve on every transition.
 * `CommonButton` is the product's button, sized and padded for dense screens
 * and used on hundreds of surfaces; bending it to those numbers would have
 * re-padded every button in the app to satisfy a rule about a marketing page.
 * So this is a separate element, and the hero's old `:deep(.button--...)`
 * override goes away with it.
 *
 * WHAT IT DOES REUSE is the part that was measured rather than chosen: the
 * teal ramp's contrast ladder. `CommonButton`'s own comment records
 * `$content0Orig` on `$primary500` at 5.7:1, on `$primary400` at 7.6:1 and on
 * `$primary300` at 10.4:1, which is why the label is ink and the states go
 * LIGHTER. Re-deriving that here would have meant re-measuring it, and picking
 * a nice-looking pair instead is how a button ends up below AA in the one state
 * a keyboard user sees most.
 *
 * RENDERED TWICE, FROM HERE. The system requires the closing call to action to
 * be identical to the one in the hero, so both are this component and neither
 * takes a variant prop. That is also why it carries no `tone`: both bands it
 * appears in use the inverse ground deliberately, so "identical" is literal
 * rather than approximate.
 *
 * THE LABEL FOLLOWS THE TARGET, which is the whole reason `landingCtaTarget()`
 * reports which destination it resolved. With no scheduling link configured the
 * action is an email, and a button that still said "book a walkthrough" would
 * be describing something the click does not do.
 *
 * `<a>` and not `<button>`: it navigates. A button element here would need a
 * click handler to do what an anchor does for free, and would drop
 * middle-click, long-press and "copy link address".
 */
const { t } = useT();

const target = landingCtaTarget();

const label = computed(() => (target.booking
    ? t('landing.action.bookWalkthrough')
    : t('landing.action.askForWalkthrough')));
</script>

<style scoped lang="scss">
.cta {
    /*
     * PADDING IS THE SYSTEM'S, not this codebase's: 8px vertical and 12px
     * horizontal is the specified main-button box. It reads tighter than the
     * product's own buttons and that is correct, because the label is 16px
     * here against the app's 14px, so the box grows with the type rather than
     * with the padding.
     */
    display: inline-flex;
    gap: $space4;
    align-items: center;

    padding: $space4 $space5;
    border-radius: $radiusLg;

    font-size: $fontSizeMd;
    font-weight: 600;
    line-height: $lineHeightMd;

    /*
     * Ink label on the teal fill, and the states go UP the ramp. Both facts
     * come from the measured ladder quoted in this component's script comment;
     * `Orig` rather than `$content0` because the fill is a fixed brand colour
     * in both themes, so a theme-following label would invert to near-white on
     * teal in the dark theme.
     */
    color: $content0Orig;
    text-decoration: none;

    background: $primary500;

    /*
     * THE CURVE IS MANDATED, the duration is not. The system's canonical
     * snippet is 700ms on this bezier, which is right for something heavy
     * crossing the viewport and wrong for a press: a button that takes
     * two-thirds of a second to acknowledge a click reads as broken rather than
     * as weighty. Same curve, shorter travel.
     */
    transition:
        background 320ms cubic-bezier(0.32, 0.72, 0, 1),
        transform 200ms cubic-bezier(0.32, 0.72, 0, 1);

    // `scale(0.98)`, the specified press. Paired with the ramp's lightest step
    // so the state is visible to somebody who cannot perceive the movement.
    &:active {
        transform: scale(0.98);
        background: $primary300;
    }

    /*
     * The focus ring is stated rather than inherited. The global
     * `:focus-visible` rule in layout.scss is (0,1,0) and would be beaten by
     * anything this component set on `outline`; it sets none, so the global
     * rule does apply, but stating it here means a later edit to this block
     * cannot silently remove the one indicator a keyboard user has.
     */
    &:focus-visible {
        outline: 2px solid $primary600;
        outline-offset: $space1;
    }

    &:focus, &:focus-visible {
        background: $primary300;
    }

    &_icon {
        flex: 0 0 auto;

        width: $fontSizeMd;
        height: $fontSizeMd;

        // Icons carry no leading: `line-height: 1` here means "no leading at
        // all" rather than a tighter text role, which is why tokens-root.scss
        // deliberately keeps it off the leading scale.
        line-height: 1;

        transition: transform 320ms cubic-bezier(0.32, 0.72, 0, 1);
    }

    @media (prefers-reduced-motion: reduce) {
        transition: none;

        &:active {
            transform: none;
        }
    }

    @include hover {
        &:hover {
            background: $primary400;

            .cta_icon {
                transform: translateX(2px);
            }
        }
    }
}
</style>
