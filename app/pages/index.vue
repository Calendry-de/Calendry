<template>
    <CommonPageOpener
        v-model="opening"
        :speed="1"
    >
        <div class="landing">
            <LandingTopBar/>

            <main id="main">
                <LandingHero/>

                <LandingSection
                    id="what"
                    title="A timetable you can hold, and one you can ask for"
                    lead="Two halves. This application stores and presents the schedule and everything
                        it is made of; a separate solver service builds candidate placements from your
                        rules and hands them back for a person to accept or reject."
                >
                    <LandingCapabilityList :items="FEATURES"/>
                </LandingSection>

                <LandingSection
                    id="built"
                    title="What works today"
                    lead="Not a demo reel. Everything below is implemented, in use against a real
                        database, and covered by this repository's integration suite."
                >
                    <LandingRoadmapList :items="BUILT"/>

                    <LandingCallout
                        text="If that already covers most of what your week needs, the useful next step is a conversation about your institution."
                        action="Get in touch"
                        href="#contact"
                    />
                </LandingSection>

                <LandingSection
                    id="next"
                    title="Not built yet, and honest about it"
                    lead="Calendry is being built in phases, and each of these is a phase rather than a
                        promise with a date on it. Where a decision is still open, it says which one."
                >
                    <LandingRoadmapList :items="NEXT"/>
                </LandingSection>

                <LandingSection
                    id="why"
                    title="Decisions worth defending"
                    lead="Timetabling software fails in specific, recognisable ways. These are the
                        choices made against them — each one is a rule the codebase is actually built
                        on, not a slogan."
                >
                    <LandingPrincipleList :items="PRINCIPLES"/>
                </LandingSection>

                <LandingSection
                    id="contact"
                    title="Tell us about your institution"
                    lead="Calendry is being built for real timetables, so the useful conversation is
                        about yours: how many rooms and cohorts, what your week looks like, and what
                        breaks today."
                >
                    <LandingContactCapture/>
                </LandingSection>

                <LandingSection
                    id="under-the-hood"
                    title="For the technically curious"
                    tone="inverse"
                >
                    <LandingTechBand
                        :lead="TECH_LEAD"
                        :items="TECHNICAL_NOTES"
                    />
                </LandingSection>
            </main>

            <LandingFooter/>
        </div>
    </CommonPageOpener>
</template>

<script setup lang="ts">
import {
    BUILT,
    FEATURES,
    NEXT,
    PRINCIPLES,
    TECHNICAL_NOTES,
    TECH_LEAD,
} from '~/utils/landingContent';
import { useFirstVisit } from '~/composables/pageOpener';

/**
 * The public marketing page for calendry.de — the domain ROOT.
 *
 * ROUTE. `/` is this page, and the authenticated home that used to live here is
 * now `/dashboard`. Whoever arrives at calendry.de has, by definition, not
 * signed in yet, so the root belongs to the people who have never heard of
 * Calendry; a visitor who does hold a session lands here too and clicks through.
 *
 * PUBLIC. `auth.global.ts` is deny-by-default, so a new page is protected the
 * moment it exists; `/` is listed in that middleware's ANONYMOUS_ROUTES — which
 * is deliberately NOT the same list as the auth pages, because those bounce a
 * signed-in visitor away and this page must not. It calls no API and reads no
 * session: a marketing page that 401s half its content would render its own
 * empty state and look like a broken product, which is this repository's
 * most-repeated failure shape.
 *
 * LAYOUT. `empty`, so the app header — menu, session control, tenant switcher —
 * stays out of a page whose reader has no session.
 *
 * READING ORDER IS THE ARGUMENT, and it changed. It used to run
 * hero → what it does → what works → what's next → why → under the hood →
 * contact, which put the section that opens "skip this if you are here to
 * schedule a term" directly between a registrar and the form, and left the last
 * words before the CTA as an admission that the product cannot send email. The
 * technical band now CLOSES the page, after the form: an evaluator will happily
 * scroll past a contact form, and a timetabling officer will not scroll past a
 * section addressed to somebody else. What a reader leaves with is a measured
 * number rather than a missing feature.
 *
 * COMPOSITION. Content lives in `~/utils/landingContent`, section markup in
 * `app/components/landing/`. This file only arranges them: pages compose, they
 * do not implement.
 *
 * THE OPENER runs here and NOWHERE ELSE, on a visitor's first arrival only.
 * `/` is the one route where a brand moment is the job — every other page in
 * this app is somebody's Tuesday, and a two-and-a-half second animation between
 * a timetabler and their week is a cost with no return. It is also the only
 * route a stranger reaches first.
 *
 * "First arrival" is decided from a COOKIE rather than `localStorage`, because
 * the decision has to be made on the server: the veil has to be in the first
 * HTML to cover the first paint, so a returning visitor whose HTML contained it
 * would see a dark flash on every visit. See `useFirstVisit`.
 *
 * `markSeen()` fires immediately rather than on `done`, so a reload part-way
 * through does not replay it, and so a visitor who leaves during the animation
 * is still counted as having arrived.
 */
definePageMeta({ layout: 'empty' });

const title = 'Timetabling for schools and universities';
const description = 'Calendry is a multi-tenant timetabling platform for schools and universities: '
    + 'a calendar management application plus a solver service that proposes schedules for a person '
    + 'to review. In active development.';

useHead({
    // The layout's titleTemplate appends " | Calendry", so naming the product
    // again here would render it twice.
    title,
    meta: [
        { name: 'description', content: description },
        /*
         * Open Graph and Twitter, because the way this page actually reaches a
         * decision-maker is somebody pasting it into Slack or Teams — and with
         * no tags at all it arrives there as a bare URL. `og:image` is
         * deliberately absent rather than pointed at a file that does not
         * exist: it needs a real asset, and a broken image card is worse than
         * a text one.
         */
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'Calendry' },
        { property: 'og:title', content: `${ title } | Calendry` },
        { property: 'og:description', content: description },
        { property: 'og:locale', content: 'en' },
        { name: 'twitter:card', content: 'summary' },
        { name: 'twitter:title', content: `${ title } | Calendry` },
        { name: 'twitter:description', content: description },
    ],
});
/**
 * `isFirstVisit` is read once, at setup, and copied into a plain ref. It is not
 * reactive on purpose: `markSeen()` writes the cookie, and a computed reading
 * that cookie would flip to `false` on mount and tear the veil out of the DOM
 * one frame into its own animation.
 */
const { isFirstVisit, markSeen } = useFirstVisit('calendry_intro_seen');
const opening = ref(isFirstVisit);

onMounted(markSeen);

</script>

<style scoped lang="scss">
.landing {
    /*
     * Full width, with every section constraining its own content. The page used
     * to be a centred 1040px column, which meant a full-bleed band — the
     * inverse-toned technical section — could only be drawn with a `100vw`
     * breakout, and that overflows horizontally as soon as a scrollbar takes up
     * space. Sections own their ground; `_measure` owns the reading width.
     */
    display: flex;
    flex-direction: column;
    width: 100%;
}
</style>
