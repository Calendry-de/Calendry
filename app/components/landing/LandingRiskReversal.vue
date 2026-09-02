<template>
    <p class="risk">
        <Icon
            class="risk_mark"
            name="ph:shield-check"
            aria-hidden="true"
        />
        {{ t('landing.risk.line') }}
    </p>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';

/**
 * What the reader is not risking by clicking.
 *
 * EVERY CONVENTIONAL RISK REVERSAL IS UNAVAILABLE HERE and that is why this is
 * one line rather than a panel of three. There is no free trial, because there
 * is no self-service sign up; there is no money back guarantee, because nobody
 * is being charged at this point; there is no "cancel anytime", because there
 * is nothing to cancel. Writing any of them would be inventing a promise.
 *
 * What is actually true is that the call costs nothing and commits to nothing,
 * and that the walkthrough opens with the gaps. The last clause is the load
 * bearing one: this page's argument is that it tells you what is missing, so
 * the risk reversal is a promise about the CONVERSATION rather than about a
 * contract, and it is the only one of these a reader can verify immediately by
 * scrolling back up to the roadmap.
 *
 * Rendered under both calls to action, which is why it is a component and not a
 * line inside one of them.
 */
const { t } = useT();
</script>

<style scoped lang="scss">
.risk {
    display: flex;
    gap: $space4;
    align-items: baseline;
    justify-content: center;

    margin: 0;

    font-size: $fontSizeSm;
    line-height: $lineHeightSm;

    /*
     * INK IS A CUSTOM PROPERTY because this line renders on both of the page's
     * grounds: under the hero-side action it sits on the page's own surface,
     * and inside the closing band it sits on the inverse one. The default is
     * the page ground's prose ink and `LandingFinalCta` overrides it.
     *
     * A property rather than the parent setting `color` on this component's
     * root: both rules would be a single class at the same specificity, so
     * which one won would be decided by the order the two scoped stylesheets
     * happen to land in the bundle. That is not something a component should
     * depend on.
     */
    color: var(--risk-ink, #{$content6});
    text-align: center;
    text-wrap: pretty;

    &_mark {
        flex: 0 0 auto;
        width: $fontSizeSm;
        height: $fontSizeSm;
        line-height: 1;
    }
}
</style>
