<template>
    <aside class="repo">
        <h3 class="repo_title">{{ t('landing.proof.repoTitle') }}</h3>

        <!--
            `i18n-t` rather than a string with a link concatenated onto it: the
            repository name sits INSIDE the sentence, and German puts it
            somewhere English does not. The slot name matches the placeholder.
        -->
        <i18n-t
            keypath="landing.proof.repoBody"
            tag="p"
            class="repo_body"
            scope="global"
        >
            <template #link>
                <a
                    class="repo_link"
                    :href="REPO_HREF"
                    rel="noopener"
                >{{ REPO_LABEL }}</a>
            </template>
        </i18n-t>
    </aside>
</template>

<script setup lang="ts">
import { REPO_HREF, REPO_LABEL } from '~/utils/landingContent';
import { useT } from '~/composables/i18n';

/**
 * The proof that the claims above can be checked, at the end of the section
 * that makes them.
 *
 * WHY IT SITS HERE and not in the hero. The hero's proof line already says the
 * code is public, in one sentence, because that is all a reader will absorb
 * above the fold. This is the same claim with somewhere to go, placed directly
 * after the list of things it would let them verify: proof belongs beside the
 * claim it supports, and the claim is the built list.
 *
 * A LINK, NOT A BUTTON, and deliberately quiet. The page gets one primary
 * action and it is `LandingCta`; styling this as a second filled control would
 * put a competing destination at the end of the page's proof section, which is
 * exactly where a reader is closest to converting.
 *
 * READABLE, NOT OPEN SOURCE. The repository carries no licence, so every right
 * is reserved: a visitor may read the code and may not reuse it. The copy says
 * so and names the missing licence as an open decision rather than glossing it,
 * because the one thing this page cannot afford is an overclaim a reader can
 * check in one click. `tests/landing-page` asserts the phrase "open source"
 * appears nowhere on the page.
 */
const { t } = useT();
</script>

<style scoped lang="scss">
.repo {
    @include landingReveal;

    margin-top: $space9;
    padding: $space6;
    border: 1px solid $surface4;
    border-radius: $radius2Xl;

    background: $surface1;

    &_title {
        margin: 0 0 $space4;

        font-size: $fontSizeLg;
        font-weight: 600;
        line-height: $lineHeightLg;
        color: $content2;
        text-wrap: balance;
    }

    &_body {
        margin: 0;

        font-size: $fontSizeMd;
        line-height: $lineHeightMd;
        color: $content6;
        text-wrap: pretty;
    }

    &_link {
        color: $content2;
        text-decoration: underline;
        transition: color 320ms cubic-bezier(0.32, 0.72, 0, 1);

        @include hover {
            &:hover {
                color: $primary600;
            }
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: $space1;
        }

        @media (prefers-reduced-motion: reduce) {
            transition: none;
        }
    }
}
</style>
