<template>
    <header class="topbar">
        <div class="topbar_pill">
            <NuxtLink
                class="topbar_brand"
                to="/"
                aria-label="Calendry"
            >
                <CommonLogo :size="34"/>
            </NuxtLink>

            <nav
                class="topbar_nav"
                aria-label="Landing page"
            >
                <NuxtLink
                    v-for="entry in SECTIONS"
                    :key="entry.href"
                    class="topbar_link"
                    :to="entry.href"
                >{{ entry.label }}</NuxtLink>
            </nav>

            <span
                class="topbar_divider"
                aria-hidden="true"
            />

            <div class="topbar_actions">
                <NuxtLink
                    class="topbar_link topbar_link--persistent"
                    to="/login"
                >Sign in</NuxtLink>
                <CommonButton
                    class="topbar_cta"
                    type="primary"
                    size="S"
                    href="/#contact"
                >Get in touch</CommonButton>
            </div>
        </div>
    </header>
</template>

<script setup lang="ts">
/**
 * The public page's own bar: a floating capsule rather than a full-width shelf.
 *
 * STICKY, because the page is long and the only way back to the form was
 * scrolling. On a phone this is the ONLY navigation, which is why the CTA lives
 * here rather than in the two in-page anchors that used to carry it: those were
 * `display: none` below 699px, so a phone reader had no affordance at all.
 *
 * Still no "Sign up". Accounts are created by an administrator, and a button
 * that cannot do what it says is worse than its absence. `tests/landing-page`
 * asserts the string is absent from the whole page.
 *
 * THE SECTION LINKS ARE NEW, and they are what makes this a menu rather than a
 * logo with a button. A reader who lands here has one of about four questions,
 * and the page answers all four a long way apart; before this, the only way to
 * find "does it do X" was to scroll a twelve-screen document. They are in-page
 * anchors, not routes, because the answers genuinely live on this page.
 *
 * `/pricing` is the exception, and the only entry that leaves the page.
 *
 * DESKTOP ONLY, for the section links. Below `pc` the capsule keeps the mark,
 * "Sign in" and the CTA, which is what it carried before this change and what
 * fits: five labels plus two controls is a two-line bar on a tablet, and a
 * two-line nav is broken. There is deliberately no hamburger, because the
 * drawer would hold five anchors into a page the reader can already scroll.
 */
const SECTIONS = [
    { href: '/#what', label: 'What it does' },
    { href: '/#built', label: 'What works' },
    { href: '/#next', label: 'Roadmap' },
    { href: '/#under-the-hood', label: 'Technical' },
    { href: '/pricing', label: 'Pricing' },
] as const;
</script>

<style scoped lang="scss">
.topbar {
    pointer-events: none;

    /*
     * FIXED, NOT STICKY, and the difference is the whole visual idea. A sticky
     * bar occupies a block of flow at the top of the document, so the strip it
     * reserves would show the PAGE ground above the hero: a light band sitting
     * on top of the inverse block the bar is supposed to belong to. Fixed takes
     * it out of flow, so the capsule floats over the hero instead of standing on
     * it, and the hero's own top padding is what keeps the copy clear of it.
     */
    position: fixed;
    z-index: 20;
    top: 0;
    right: 0;
    left: 0;

    display: flex;
    justify-content: center;

    // The bar floats, so the strip behind it belongs to whatever section is
    // under it. Padding rather than a ground: a full-width bar with its own
    // colour is the shelf this replaced.
    padding: $space5 $space7;

    @include mobileOnly {
        padding: $space4 $space5;
    }

    &_pill {

        // The bar itself is interactive again; the strip around it is not, so a
        // click beside the capsule reaches the page.
        pointer-events: auto;

        display: flex;
        gap: $space6;
        align-items: center;

        max-width: 100%;

        /*
         * ROOM FOR THE BUTTON. At 6px of right padding the CTA's own corners sat
         * outside the capsule's 999px curve, so the button visibly broke the
         * bar's edge. A pill containing a pill needs the inner one inset by more
         * than the outer curve deflects, which is what the even 8px gives it;
         * the left side keeps more because a wordmark needs optical space that a
         * filled button does not.
         */
        padding: $space4 $space4 $space4 $space6;

        /*
         * A HAIRLINE, because the capsule opens on top of a hero painted in the
         * SAME inverse ground. Without an edge the bar simply disappears into
         * the hero on first paint and reads as loose text floating over the
         * headline: the pill only becomes a pill several screens later, once it
         * is over a light section, which is exactly backwards. `content2`
         * against the hero's `content1` lifts it very slightly and the stroke
         * finishes the job.
         *
         * `varToRgba` rather than one of `colorsList`'s `whiteAlpha` values:
         * those are literal hex and would not swap with the theme, and this
         * whole band depends on inverting cleanly.
         */
        border: 1px solid varToRgba('surface1', 0.16);

        /*
         * THE ONE CAPSULE ON THE SURFACE, and the only place the radius scale is
         * not used. `radius-xl` is 10px, which on a 52px bar reads as a
         * rounded rectangle rather than as a floating object, and floating is
         * the whole point: the bar has to look like it sits ON the page instead
         * of being part of it. Everything inside the page keeps the scale.
         */
        border-radius: 999px;

        background: $content2;

        @include mobileOnly {
            gap: $space4;
            padding: $space3 $space3 $space3 $space5;
        }
    }

    /*
     * CONCENTRIC, not square-in-round. The button keeps the app's 4px radius
     * everywhere else in the product; inside a capsule that radius reads as a
     * rectangle jammed into a curve. This is the one caller that overrides it,
     * and it overrides it to match the shape it sits in.
     */
    &_cta {
        border-radius: 999px !important;
    }

    &_brand {
        display: inline-flex;
        flex: none;
        align-items: center;

        color: $surface1;
        text-decoration: none;
    }

    &_nav {
        display: flex;
        flex: none;
        gap: $space6;
        align-items: center;

        // Five labels plus two controls do not fit a tablet capsule. See the
        // component note: no drawer, because these are anchors into a page the
        // reader can scroll anyway.
        @include mobile {
            display: none;
        }
    }

    &_divider {
        flex: none;

        width: 1px;
        height: $space7;

        opacity: 0.35;
        background: $surface5;

        @include mobile {
            display: none;
        }
    }

    &_actions {
        display: flex;
        flex: none;

        // Never the one that shrinks: "Get in touch" is the page's conversion
        // path, and a partial button is not a smaller button, it is a broken one.
        gap: $space5;
        align-items: center;

        @include mobileOnly {
            gap: $space4;

            /*
             * The CTA is `size="S"` (36px rendered), right for the desktop row
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
        flex: none;

        padding: $space3 0;

        font-size: $fontSizeMd;
        font-weight: 600;
        color: $surface3;
        text-decoration: none;
        white-space: nowrap;

        @include hover {
            &:hover {
                color: $surface1;
                text-decoration: underline;
            }
        }

        /*
         * A REAL TARGET IN BOTH DIRECTIONS, on the viewport where this is a
         * thumb: it measured 28.6 × 29.5, the text and its padding and nothing
         * else, on the only navigation a phone gets. `mobileOnly` because that
         * is the condition this repo already applies the 44px rule under
         * (`ScheduleAgenda`, `ScheduleWeekNav`, `ScheduleToolbar`).
         */
        &--persistent {
            @include mobileOnly {
                display: inline-flex;
                align-items: center;
                min-height: 44px;
                padding-inline: $space3;
            }
        }
    }
}
</style>
