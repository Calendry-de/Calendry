<template>
    <header class="topbar">
        <p class="topbar_wordmark">Calendry</p>

        <nav
            class="topbar_nav"
            aria-label="Landing page"
        >
            <common-button
                type="link"
                href="#built"
            >What works</common-button>
            <common-button
                type="link"
                href="#next"
            >What's next</common-button>
            <common-button
                type="secondary"
                to="/login"
            >Sign in</common-button>
        </nav>
    </header>
</template>

<script setup lang="ts">
/**
 * The public page's own bar, deliberately not the app's header.
 *
 * The app header carries the menu and the session control, which mean nothing to
 * a visitor who has never signed in — and the landing page uses the `empty`
 * layout precisely so none of that renders. `Sign in` is a real destination for
 * the people who already have an account; there is no `Sign up`, because
 * accounts are created by an administrator and a button that cannot do what it
 * says is worse than its absence.
 */
</script>

<style scoped lang="scss">
.topbar {
    display: flex;
    gap: $space5;
    align-items: center;
    justify-content: space-between;

    &_wordmark {
        margin: 0;
        font-size: $fontSizeXl;
        font-weight: 700;
        color: $content2;
    }

    &_nav {
        display: flex;
        gap: $space4;
        align-items: center;

        // The two in-page links are navigation for a long page, not the point of
        // it. On a phone the page is short enough to scroll and the wordmark plus
        // Sign in is all that earns the space.
        @include mobileOnly {
            :deep(.button--type-link) {
                display: none;
            }
        }
    }
}
</style>
