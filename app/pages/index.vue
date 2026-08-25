<template>
    <div class="landing">
        <landing-top-bar/>
        <landing-hero/>

        <landing-section
            id="what"
            eyebrow="What it does"
            title="A timetable you can hold, and one you can ask for"
            lead="Two halves. This application stores and presents the schedule and everything it
                is made of; a separate solver service builds candidate placements from your rules
                and hands them back for a person to accept or reject."
        >
            <landing-feature-list :items="FEATURES"/>
        </landing-section>

        <landing-section
            id="built"
            eyebrow="Built so far"
            title="What works today"
            lead="Not a demo reel. Everything below is implemented, in use against a real database,
                and covered by this repository's integration suite."
        >
            <landing-roadmap-list :items="BUILT"/>
        </landing-section>

        <landing-section
            id="next"
            eyebrow="What's next"
            title="Not built yet, and honest about it"
            lead="Calendry is being built in phases, and each of these is a phase rather than a
                promise with a date on it. Where a decision is still open, it says which one."
        >
            <landing-roadmap-list :items="NEXT"/>
        </landing-section>

        <landing-section
            id="why"
            eyebrow="Why it works this way"
            title="Decisions worth defending"
            lead="Timetabling software fails in specific, recognisable ways. These are the choices
                made against them — each one is a rule the codebase is actually built on, not a
                slogan."
        >
            <landing-feature-list :items="PRINCIPLES"/>
        </landing-section>

        <landing-section
            id="under-the-hood"
            eyebrow="Under the hood"
            title="For the technically curious"
            lead="Skip this if you are here to schedule a term rather than to read about how."
        >
            <landing-feature-list
                :items="TECHNICAL_NOTES"
                :columns="3"
            />
        </landing-section>

        <landing-section
            id="contact"
            eyebrow="Get in touch"
            title="Tell us about your institution"
            lead="Calendry is being built for real timetables, so the useful conversation is about
                yours: how many rooms and cohorts, what your week looks like, and what breaks
                today."
        >
            <landing-contact-capture/>
        </landing-section>

        <landing-footer/>
    </div>
</template>

<script setup lang="ts">
import {
    BUILT,
    FEATURES,
    NEXT,
    PRINCIPLES,
    TECHNICAL_NOTES,
} from '~/utils/landingContent';

/**
 * The public marketing page for calendry.de — the domain ROOT.
 *
 * ROUTE. `/` is this page, and the authenticated home that used to live here is
 * now `/dashboard`. Whoever arrives at calendry.de has, by definition, not
 * signed in yet, so the root belongs to the people who have never heard of
 * Calendry; a visitor who does hold a session lands here too and clicks through.
 * The redirect chain moved with it: an anonymous visit to any protected page
 * still bounces to `/login`, and signing in now lands on `/dashboard` rather
 * than on this page.
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
 * COMPOSITION. Content lives in `~/utils/landingContent`, section markup in
 * `app/components/landing/`. This file only arranges them: pages compose, they
 * do not implement.
 */
definePageMeta({ layout: 'empty' });

useHead({
    // The layout's titleTemplate appends " | Calendry", so naming the product
    // again here would render it twice.
    title: 'Timetabling for schools and universities',
    meta: [
        {
            name: 'description',
            content: 'Calendry is a multi-tenant timetabling platform for schools and '
                + 'universities: a calendar management application plus a solver service that '
                + 'proposes schedules for a person to review. In active development.',
        },
    ],
});
</script>

<style scoped lang="scss">
.landing {
    display: flex;
    flex-direction: column;
    gap: $space11;

    // The reading measure, centred. Wider than a form and narrower than the
    // schedule grid, which is the only surface in this app that wants a whole
    // desktop.
    width: min(1040px, 100%);
    margin: 0 auto;
    padding: $space7 $space7 $space9;

    @include mobileOnly {
        gap: $space9;
        padding: $space6 $space5 $space8;
    }
}
</style>
