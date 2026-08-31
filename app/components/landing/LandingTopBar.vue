<template>
    <header class="topbar">
        <div class="topbar_measure">
            <NuxtLink
                class="topbar_brand"
                to="/"
                aria-label="Calendry"
            >
                <CommonLogo
                    :size="64"
                    wordmark
                />
            </NuxtLink>

            <nav
                class="topbar_nav"
                aria-label="Landing page"
            >
                <NuxtLink
                    class="topbar_link"
                    to="/login"
                >Sign in</NuxtLink>
                <CommonButton
                    type="primary"
                    size="S"
                    href="#contact"
                >Get in touch</CommonButton>
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
 *
 * The plain-text wordmark is now the 11C lockup — mark plus `alendry`, the
 * mark itself supplying the C. It is a link to `/` rather than a bare `<p>`:
 * a brand at the top-left of a public page is the affordance people reach for
 * to get back to the top, and this page is long enough that they will.
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

    &_brand {
        display: inline-flex;
        align-items: center;

        // The brand is the half that yields. Both children are flex items and
        // both defaulted to `min-width: auto` — their own min-content — so
        // neither could give and the bar overflowed instead. Between a wordmark
        // and the only conversion control on a phone, the wordmark yields.
        min-width: 0;

        // The mark is the tap target, so it needs the height a bare inline
        // image would not have.
        padding: $space3 0;

        color: $content2;
        text-decoration: none;
    }

    /*
     * MARK ONLY, BELOW THE MEASURED THRESHOLD. Hiding the word rather than
     * scaling the lockup: at 34px the lockup still fits English on a 320px
     * phone with 11px to spare, and stops fitting the moment a label is
     * translated. The mark is a capital C that supplies the word's first
     * letter (see `CommonLogo`), so it carries the brand on its own.
     *
     * The accessible name is unaffected: under `wordmark` the svg is already
     * `aria-hidden`, and the name comes from this link's own `aria-label`.
     *
     * Every dimension inside the lockup is an `em` of `.logo`'s font size, so
     * one declaration re-fits the mark — and a smaller mark also buys back
     * sticky-bar height on the viewport that has the least of it (78px → 60px).
     */
    @include landingBarCollapsed {
        &_brand {
            // 44px of target across, where the mark alone measures ~36.
            padding: $space3 $space2;

            /*
             * NOT A TYPE STEP, so it is off the ramp on purpose and stays a
             * literal with its reason attached, the way `tokens-root.scss`
             * says such values should. `CommonLogo` takes its size as a
             * font-size and derives the mark from it at `1cap × 1.155`
             * (~0.825em), so this is the geometry input that renders a 36px
             * mark — there is no text here to set, the wordmark below is
             * hidden. A detector reading it as type will flag it; it is not.
             */
            :deep(.logo) {
                font-size: 44px;
            }

            :deep(.logo_wordmark) {
                display: none;
            }
        }
    }

    &_nav {
        display: flex;

        // Never the one that shrinks: "Get in touch" is the page's conversion
        // path and a partial button is not a smaller button, it is a broken one.
        flex: none;
        gap: $space6;
        align-items: center;

        // Gives back exactly what `_link`'s touch padding above adds, so the
        // space between the two controls still reads as 16px.
        @include mobileOnly {
            gap: $space4;

            /*
             * The CTA is `size="S"` — 36px rendered, right for the desktop row
             * it was chosen for and too short for a thumb. Raised here rather
             * than in `CommonButton`, because `S` exists precisely to be the
             * compact one and every other caller picked it on purpose; this is
             * the one instance that is also a page's only conversion control.
             */
            :deep(.button--size-S) {
                min-height: 44px;
            }
        }
    }

    &_link {
        // A text link, not a `--type-link` button: it needs a real tap target
        // and the button variant supplies none.
        padding: $space3 0;

        /*
         * A REAL TARGET IN BOTH DIRECTIONS, on the viewport where this is a
         * thumb: it measured 28.6 × 29.5, the text and its padding and nothing
         * else, on the only navigation a phone gets. The nav's gap gives back
         * what the inline padding adds, so the optical rhythm against the
         * button is unchanged. `mobileOnly` because that is the condition this
         * repo already applies the 44px rule under (`ScheduleAgenda`,
         * `ScheduleWeekNav`, `ScheduleToolbar`).
         */
        @include mobileOnly {
            display: inline-flex;
            align-items: center;
            min-height: 44px;
            padding-inline: $space4;
        }

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
