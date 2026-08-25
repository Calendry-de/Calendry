<template>
    <header class="topbar">
        <div class="topbar_measure">
            <p class="topbar_wordmark">Calendry</p>

            <nav
                class="topbar_nav"
                aria-label="Landing page"
            >
                <NuxtLink
                    class="topbar_link"
                    to="/login"
                >Sign in</NuxtLink>
                <common-button
                    type="primary"
                    size="S"
                    href="#contact"
                >Get in touch</common-button>
            </nav>
        </div>
    </header>
</template>

<script setup lang="ts">
/**
 * The public page's own bar — sticky, and carrying the conversion action.
 *
 * Three changes from the first version, each closing a real gap:
 *
 * STICKY, because the page is long and the only way back to the form was
 * scrolling. On a phone this is now the ONLY navigation, which is why the CTA
 * lives here rather than the two in-page anchors that used to: those were
 * `display: none` below 699px, so a phone reader had no affordance at all.
 *
 * The anchors are gone rather than moved. They were `--type-link` buttons at a
 * hardcoded 10px — below the type scale's own floor, and computing to a ~14px
 * tap target, which fails even the 24px minimum. The hero's second button
 * already offers the same jump.
 *
 * Still no "Sign up". Accounts are created by an administrator, and a button
 * that cannot do what it says is worse than its absence.
 */
</script>

<style scoped lang="scss">
.topbar {
    position: sticky;
    z-index: 20;
    top: 0;

    padding: $space5 $space7;
    border-bottom: 1px solid $surface5;

    // Opaque, not translucent: a blurred bar over a hairline grid figure reads
    // as a smear, and glass here would be decoration rather than an effect.
    background: $surface1;

    @include mobileOnly {
        padding: $space4 $space5;
    }

    &_measure {
        display: flex;
        gap: $space5;
        align-items: center;
        justify-content: space-between;

        width: min(1040px, 100%);
        margin: 0 auto;
    }

    &_wordmark {
        margin: 0;

        font-size: $fontSizeLg;
        font-weight: 700;
        color: $content2;
        letter-spacing: -0.01em;
    }

    &_nav {
        display: flex;
        gap: $space6;
        align-items: center;
    }

    &_link {
        // A text link, not a `--type-link` button: it needs a real tap target
        // and the button variant supplies none.
        padding: $space3 0;

        font-size: $fontSizeMd;
        font-weight: 600;
        color: $content4;
        text-decoration: none;

        @include hover {
            &:hover {
                text-decoration: underline;
                text-underline-offset: 3px;
            }
        }
    }
}
</style>
