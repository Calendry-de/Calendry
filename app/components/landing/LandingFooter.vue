<template>
    <footer class="footer">
        <div class="footer_measure">
            <div class="footer_left">
                <p class="footer_wordmark">Calendry</p>
                <p class="footer_note">
                    Multi-tenant timetabling for schools and universities. Built in the open, one
                    verified phase at a time.
                </p>
            </div>

            <nav
                class="footer_nav"
                aria-label="Footer"
            >
                <a
                    class="footer_link"
                    :href="`mailto:${ CONTACT_EMAIL }`"
                >{{ CONTACT_EMAIL }}</a>
                <NuxtLink
                    class="footer_link"
                    to="/login"
                >Sign in</NuxtLink>
            </nav>
        </div>
    </footer>
</template>

<script setup lang="ts">
import { CONTACT_EMAIL } from '~/utils/landingContent';

/**
 * Deliberately thin. Every link here goes somewhere that exists — there is no
 * privacy page, no terms page and no careers page in this repository, and
 * linking to one would be the same fabrication as an invented testimonial.
 *
 * "Built in the open" is doing unpaid work: a technical evaluator reads it as a
 * promise of a repository and there is nothing to click. The line stays because
 * it is true of how the project is run, but a public repository URL belongs
 * here the moment one exists.
 */
</script>

<style scoped lang="scss">
.footer {
    padding: $space8 $space7;
    border-top: 1px solid $surface5;

    @include mobileOnly {
        padding: $space7 $space5;
    }

    &_measure {
        display: flex;
        flex-wrap: wrap;
        gap: $space6 $space8;
        align-items: end;
        justify-content: space-between;

        width: min(1040px, 100%);
        margin: 0 auto;
    }

    &_wordmark {
        margin: 0 0 $space3;
        font-size: $fontSizeMd;
        font-weight: 700;
        color: $content4;
    }

    &_note {
        max-width: 52ch;
        margin: 0;

        font-size: $fontSizeSm;
        line-height: 1.65;
        color: $content7;
    }

    &_nav {
        display: flex;
        flex-wrap: wrap;
        gap: $space7;
    }

    &_link {
        // A real tap target: these were bare 12.5px text with no padding, which
        // computes to roughly 17px of height.
        padding: $space3 0;
        font-size: $fontSizeSm;
        color: $content6;
        text-decoration: none;

        /*
         * 27px is not a phone target. These sit in a `<nav>`, not inline in a
         * sentence, so WCAG 2.5.8's inline exemption does not cover them the
         * way it covers the address in the contact aside — they are standalone
         * controls and get the full 44px this repo already gives thumb-reached
         * rows elsewhere. Centred rather than padded so "Sign in" does not
         * grow a 44px-tall underline on hover.
         */
        @include mobileOnly {
            display: inline-flex;
            align-items: center;
            min-height: 44px;
        }

        @include hover {
            &:hover {
                color: $content2;
                text-decoration: underline;
                text-underline-offset: 3px;
            }
        }
    }
}
</style>
