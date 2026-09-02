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
                :aria-label="t('landing.topbar.navLabel')"
            >
                <NuxtLink
                    v-for="entry in sections"
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
                >{{ t('landing.action.signIn') }}</NuxtLink>

                <CommonButton
                    class="topbar_cta"
                    type="primary"
                    size="S"
                    :href="target.href"
                >{{ ctaLabel }}</CommonButton>

                <button
                    ref="toggle"
                    class="topbar_toggle"
                    type="button"
                    :aria-expanded="open"
                    :aria-label="t('landing.topbar.menuLabel')"
                    aria-controls="landing-menu"
                    @click="open = !open"
                >
                    <span
                        class="topbar_bars"
                        :class="{ 'topbar_bars--open': open }"
                        aria-hidden="true"
                    >
                        <span class="topbar_bar"/>
                        <span class="topbar_bar"/>
                    </span>
                </button>
            </div>
        </div>

        <div
            id="landing-menu"
            ref="menu"
            class="topbar_menu"
            :class="{ 'topbar_menu--open': open }"
            :aria-hidden="!open"
        >
            <nav
                class="topbar_menuNav"
                :aria-label="t('landing.topbar.navLabel')"
            >
                <NuxtLink
                    v-for="(entry, index) in sections"
                    :key="entry.href"
                    class="topbar_menuLink"
                    :style="{ '--i': index }"
                    :tabindex="open ? undefined : -1"
                    :to="entry.href"
                    @click="open = false"
                >{{ entry.label }}</NuxtLink>

                <NuxtLink
                    class="topbar_menuLink"
                    :style="{ '--i': sections.length }"
                    :tabindex="open ? undefined : -1"
                    to="/login"
                    @click="open = false"
                >{{ t('landing.action.signIn') }}</NuxtLink>
            </nav>
        </div>
    </header>
</template>

<script setup lang="ts">
import { landingCtaTarget } from '~/utils/landingContent';
import { useT } from '~/composables/i18n';

/**
 * The public page's own bar: a floating capsule rather than a full-width shelf.
 *
 * STICKY, because the page is long and the only way back to the action was
 * scrolling. On a phone this is the ONLY navigation, which is why the CTA lives
 * here rather than in the in-page anchors that used to carry it: those were
 * `display: none` below 699px, so a phone reader had no affordance at all.
 *
 * Still no "Sign up". Accounts are created by an administrator, and a button
 * that cannot do what it says is worse than its absence. `tests/landing-page`
 * asserts the string is absent from the whole page.
 *
 * THE SECTION LINKS are what make this a menu rather than a logo with a button.
 * A reader who lands here has one of about six questions, and the page answers
 * them a long way apart; before they existed, the only way to find "does it do
 * X" was to scroll a twelve-screen document. They are in-page anchors, not
 * routes, because the answers genuinely live on this page. `/pricing` is the
 * exception, and the only entry that leaves it.
 *
 * THERE IS NOW A HAMBURGER, AND THERE DELIBERATELY WAS NOT. The note this
 * replaces argued that a drawer would hold "five anchors into a page the reader
 * can already scroll", and that was a real argument, not an oversight: the
 * links were simply hidden below `pc` and a phone got no navigation at all. The
 * design system decides it the other way, and the balance had shifted anyway,
 * because the list is six entries now and the page it indexes is longer. What
 * the old note got right is kept: the drawer holds ANCHORS, so every one of
 * them closes it on click, and none of them is a destination a reader can get
 * lost in.
 *
 * THE MENU IS ALWAYS IN THE DOM, hidden rather than conditionally rendered, so
 * the staggered entrance has something to transition FROM. A `v-if` menu enters
 * from no previous state at all, so the first frame is already arrived and the
 * stagger never runs. It is taken out of the accessibility tree and out of the
 * tab order while closed, which is the part a hidden-not-removed element has to
 * get right: `aria-hidden` plus `tabindex="-1"` on every link, or a keyboard
 * user tabs into an invisible menu.
 *
 * THE CTA'S DESTINATION COMES FROM `landingCtaTarget()`, the same resolver the
 * hero and the closing band use. It is NOT `LandingCta`: that component is the
 * page's primary action at the system's full button size, and there are exactly
 * two of those. This is a persistent shortcut to the same place, at nav scale,
 * and routing it through the resolver is what stops the bar offering a
 * destination the page's actual action does not.
 */
const { t } = useT();

const target = landingCtaTarget();

const ctaLabel = computed(() => (target.booking
    ? t('landing.action.bookWalkthrough')
    : t('landing.action.askForWalkthrough')));

// A `computed`, not a module constant: the labels are messages now, so the list
// has to be rebuilt when the language changes rather than resolved once at
// import time, before any i18n instance exists.
const sections = computed(() => [
    { href: '/#benefits', label: t('landing.topbar.nav.benefits') },
    { href: '/#how', label: t('landing.topbar.nav.how') },
    { href: '/#built', label: t('landing.topbar.nav.built') },
    { href: '/#roadmap', label: t('landing.topbar.nav.roadmap') },
    { href: '/#faq', label: t('landing.topbar.nav.faq') },
    { href: '/pricing', label: t('landing.topbar.nav.pricing') },
]);

const open = ref(false);
const toggle = useTemplateRef<HTMLButtonElement | null>('toggle');

/*
 * Escape closes, and focus goes back to the control that opened it. Without the
 * second half, dismissing the menu with the keyboard drops focus at the top of
 * the document and the reader has to tab through the whole bar again.
 */
function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open.value) {
        open.value = false;
        toggle.value?.focus();
    }
}

onMounted(() => {
    window.addEventListener('keydown', onKeydown);

    onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
});

/*
 * The body stops scrolling while the overlay is up. Applied through a body
 * class rather than by writing `document.body.style` directly, so the rule
 * lives in the stylesheet with everything else and there is nothing to undo by
 * hand if the component unmounts while open. The class is defined in
 * `app/scss/layout.scss`, which is the app's one global sheet.
 */
useHead(() => ({ bodyAttrs: { class: open.value ? 'landing-menu-open' : '' } }));
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

        position: relative;
        z-index: 2;

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
         * headline. `content2` against the hero's `content1` lifts it very
         * slightly and the stroke finishes the job.
         *
         * `varToRgba` rather than one of `colorsList`'s `whiteAlpha` values:
         * those are literal hex and would not swap with the theme, and this
         * whole band depends on inverting cleanly.
         */
        border: 1px solid varToRgba('surface1', 0.16);

        /*
         * THE ONE CAPSULE ON THE SURFACE, and the only place the radius scale is
         * not used. The design system asks a floating nav to be a `rounded-full`
         * pill, and it is right that the scale does not apply: `radius-xl` on a
         * 52px bar reads as a rounded rectangle rather than as a floating
         * object, and floating is the whole point. Everything inside the page
         * keeps the scale.
         */
        border-radius: 999px;

        // Glass, per the design system's closed state: the pill samples the
        // band it floats over rather than sitting on an opaque slab of its own.
        // `@supports` because a browser without backdrop-filter must get the
        // solid ground instead of a translucent bar over live text.
        background: $content2;

        @supports (backdrop-filter: blur(1px)) {
            background: varToRgba('content2', 0.72);
            backdrop-filter: blur(12px);
        }

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

        // Six labels plus two controls do not fit a tablet capsule, so below
        // `pc` these move into the overlay and the hamburger appears in their
        // place. See the component note on why there is a hamburger at all.
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

        // Never the one that shrinks: the CTA is the page's conversion path,
        // and a partial button is not a smaller button, it is a broken one.
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

        transition: color 320ms cubic-bezier(0.32, 0.72, 0, 1);

        @include hover {
            &:hover {
                color: $surface1;
                text-decoration: underline;
            }
        }

        /*
         * A REAL TARGET IN BOTH DIRECTIONS, on the viewport where this is a
         * thumb: it measured 28.6 x 29.5, the text and its padding and nothing
         * else, on the only navigation a phone gets.
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

    /*
     * THE HAMBURGER, and it only exists where the inline links do not. A
     * hamburger beside six visible labels is a second door into the same room.
     */
    &_toggle {
        display: none;

        @include mobile {
            cursor: pointer;

            display: inline-flex;
            flex: none;
            align-items: center;
            justify-content: center;

            // 44px, the same thumb target the persistent link takes.
            width: 44px;
            height: 44px;
            padding: 0;
            border: 0;
            border-radius: 999px;

            appearance: none;
            background: none;
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: $space1;
        }
    }

    /*
     * TWO BARS THAT ROTATE INTO A CROSS, rather than three where the middle one
     * vanishes. Both bars are absolutely positioned on the same centre line and
     * offset apart in the closed state, so opening is a rotation and a
     * translation back to zero: nothing appears or disappears, which is what
     * the design system means by a fluid morph. A third bar would have to be
     * hidden, and a bar that fades out is the pattern this replaces.
     */
    &_bars {
        position: relative;
        display: block;
        width: 18px;
        height: 12px;
    }

    &_bar {
        position: absolute;
        left: 0;

        display: block;

        width: 100%;
        height: 2px;
        border-radius: 999px;

        background: $surface1;

        transition: transform 700ms cubic-bezier(0.32, 0.72, 0, 1);

        &:first-child {
            transform: translateY(1px);
        }

        &:last-child {
            transform: translateY(9px);
        }
    }

    &_bars--open &_bar {
        &:first-child {
            transform: translateY(5px) rotate(45deg);
        }

        &:last-child {
            transform: translateY(5px) rotate(-45deg);
        }
    }

    /*
     * THE OVERLAY: screen filling, heavy glass, and the page's ink on it. Kept
     * in the DOM at all times so the stagger has a state to run from; see the
     * component note.
     */
    &_menu {
        pointer-events: none;

        position: fixed;
        z-index: 1;
        inset: 0;

        display: flex;
        align-items: center;
        justify-content: center;

        opacity: 0;

        // The solid ground is the fallback, so a browser without
        // `backdrop-filter` never renders live text through a translucent sheet.
        background: $content1;

        transition: opacity 700ms cubic-bezier(0.32, 0.72, 0, 1);

        @supports (backdrop-filter: blur(1px)) {
            background: varToRgba('content1', 0.8);
            backdrop-filter: blur(48px);
        }

        @include pc {
            display: none;
        }

        &--open {
            pointer-events: auto;
            opacity: 1;
        }
    }

    &_menuNav {
        display: flex;
        flex-direction: column;
        gap: $space6;
        align-items: center;
    }

    /*
     * THE STAGGERED REVEAL: each link rises out of an invisible box, one after
     * the next, in reading order. The delay is computed from the item's index
     * rather than written as a class per position, so a seventh entry staggers
     * without anybody remembering to add a delay for it.
     */
    &_menuLink {
        transform: translateY(48px);

        font-size: $fontSize2Xl;
        font-weight: 600;
        line-height: $lineHeight2Xl;
        color: $surface1;
        text-decoration: none;

        opacity: 0;

        transition:
            transform 700ms cubic-bezier(0.32, 0.72, 0, 1),
            opacity 700ms cubic-bezier(0.32, 0.72, 0, 1);

        @include hover {
            &:hover {
                text-decoration: underline;
            }
        }

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: $space1;
        }
    }

    &_menu--open &_menuLink {
        transform: none;
        opacity: 1;
        transition-delay: calc(100ms + var(--i) * 50ms);
    }

    @media (prefers-reduced-motion: reduce) {
        &_bar, &_menu, &_menuLink, &_link {
            transition: none;
        }

        &_menu--open &_menuLink {
            transition-delay: 0ms;
        }
    }
}
</style>
