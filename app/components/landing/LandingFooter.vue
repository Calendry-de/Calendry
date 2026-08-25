<template>
    <footer class="footer">
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
    </footer>
</template>

<script setup lang="ts">
import { CONTACT_EMAIL } from '~/utils/landingContent';

/**
 * Deliberately thin. Every link here goes somewhere that exists — there is no
 * privacy page, no terms page and no careers page in this repository, and
 * linking to one would be the same fabrication as an invented testimonial.
 */
</script>

<style scoped lang="scss">
.footer {
    display: flex;
    flex-wrap: wrap;
    gap: $space6;
    align-items: end;
    justify-content: space-between;

    padding-top: $space7;
    border-top: 1px solid $surface5;

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
        line-height: 1.6;
        color: $content7;
    }

    &_nav {
        display: flex;
        flex-wrap: wrap;
        gap: $space6;
    }

    &_link {
        font-size: $fontSizeSm;
        color: $content6;
        text-decoration: none;

        &:hover {
            color: $primary600;
            text-decoration: underline;
        }
    }
}
</style>
