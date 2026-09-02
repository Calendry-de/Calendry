<template>
    <CommonPageOpener
        v-model="opening"
        :speed="1"
    >
        <div class="landing">
            <LandingTopBar/>

            <main id="main">
                <LandingHero/>

                <LandingAudience/>

                <LandingSection
                    id="problem"
                    :title="t('landing.section.problem.title')"
                    :lead="t('landing.section.problem.lead')"
                >
                    <LandingProblem :items="problem"/>
                </LandingSection>

                <LandingSection
                    id="benefits"
                    :title="t('landing.section.benefits.title')"
                    :lead="t('landing.section.benefits.lead')"
                >
                    <LandingCapabilityRows :items="benefits"/>
                </LandingSection>

                <LandingTaglineReveal/>

                <LandingSection
                    id="how"
                    :title="t('landing.section.how.title')"
                    :lead="t('landing.section.how.lead')"
                >
                    <LandingSteps :items="steps"/>
                </LandingSection>

                <LandingSection
                    id="built"
                    :title="t('landing.section.built.title')"
                    :lead="t('landing.section.built.lead')"
                >
                    <LandingBuiltClusters :items="built"/>
                </LandingSection>

                <LandingSection
                    id="roadmap"
                    :title="t('landing.section.next.title')"
                    :lead="t('landing.section.next.lead')"
                    layout="narrow"
                >
                    <LandingNextList :items="next"/>
                </LandingSection>

                <LandingSection
                    id="why"
                    :title="t('landing.section.why.title')"
                    :lead="t('landing.section.why.lead')"
                    layout="aside"
                >
                    <LandingPrincipleList :items="principles"/>
                </LandingSection>

                <LandingSection
                    id="technical"
                    :title="t('landing.section.underTheHood.title')"
                    layout="narrow"
                >
                    <LandingTechBand
                        :lead="techLead"
                        :items="technicalNotes"
                    />
                </LandingSection>

                <LandingSection
                    id="faq"
                    :title="t('landing.section.faq.title')"
                    :lead="t('landing.section.faq.lead')"
                    layout="narrow"
                >
                    <LandingFaq :items="faq"/>
                </LandingSection>

                <LandingFinalCta/>

                <LandingSection
                    id="contact"
                    :title="t('landing.section.contact.title')"
                    :lead="t('landing.section.contact.lead')"
                >
                    <LandingContactCapture/>
                </LandingSection>
            </main>

            <LandingFooter/>
        </div>
    </CommonPageOpener>
</template>

<script setup lang="ts">
import {
    landingBenefits,
    landingBuilt,
    landingFaq,
    landingNext,
    landingPrinciples,
    landingProblem,
    landingSteps,
    landingTechLead,
    landingTechnicalNotes,
} from '~/utils/landingContent';
import { useLanguage, useT } from '~/composables/i18n';
import { openGraphLocale } from '#shared/language';
import { useFirstVisit } from '~/composables/pageOpener';

/**
 * The public marketing page for calendry.de: the domain ROOT.
 *
 * ROUTE. `/` is this page, and the authenticated home that used to live here is
 * now `/dashboard`. Whoever arrives at calendry.de has, by definition, not
 * signed in yet, so the root belongs to the people who have never heard of
 * Calendry; a visitor who does hold a session lands here too and clicks through.
 *
 * PUBLIC. `auth.global.ts` is deny-by-default, so a new page is protected the
 * moment it exists; `/` is listed in that middleware's ANONYMOUS_ROUTES, which
 * is deliberately NOT the same list as the auth pages, because those bounce a
 * signed-in visitor away and this page must not. It calls no API and reads no
 * session: a marketing page that 401s half its content would render its own
 * empty state and look like a broken product, which is this repository's
 * most-repeated failure shape.
 *
 * LAYOUT. `empty`, so the app header (menu, session control, tenant switcher)
 * stays out of a page whose reader has no session.
 *
 * ONE OFFER, ONE AUDIENCE, ONE ACTION, which is the frame the whole page is now
 * built to. The offer is a walkthrough of a timetabling platform; the audience
 * is the person who owns the week; the action is `LandingCta`, which appears
 * exactly twice, in the hero and in `LandingFinalCta`, and is the same
 * component both times. Nothing else on the page is styled as a primary
 * action, and there is no competing action above the fold at all: the hero's
 * old second button is gone.
 *
 * READING ORDER IS THE ARGUMENT, and it is now the conversion order rather than
 * a tour. Hero states the outcome; the audience line tells a reader whether it
 * is addressed to them; `problem` earns the right to describe a solution;
 * `benefits` gives five outcomes; the tagline is the one large-type beat that
 * ties them together; `how` makes the process concrete in three steps; `built`
 * and `roadmap` are the proof and the honest limit, in that order, because a
 * roadmap read before the evidence is a list of things that do not work;
 * `why` and `technical` are for the evaluator who is already convinced;
 * `faq` handles the objections that survived all of it; and the closing action
 * is the same one the hero offered.
 *
 * OBJECTIONS COME LATE HERE, and that is a deliberate choice against the
 * general rule that a high-friction offer moves its FAQ earlier. The two
 * heaviest objections ("can it run our term", "can it take our spreadsheets")
 * are already answered ABOVE the FAQ, in `roadmap`, in the page's own voice
 * rather than in a disclosure a reader has to click. The FAQ repeats them for
 * whoever scrolled straight to it, which is why its first two rows are those
 * two and not the friendly ones.
 *
 * WHY THE CONTACT FORM IS STILL HERE, below the closing action. It is not a
 * second primary action: it is the fallback path for a reader who will not book
 * a call, and it sits after the action rather than competing with it. It also
 * currently does a better job than the button does, and that is worth stating
 * plainly: `BOOKING_URL` is null, so `landingCtaTarget()` degrades the action to
 * a bare `mailto:` with no context in it, while this form composes a draft that
 * already names the institution. When a real scheduling link is configured, the
 * button becomes the better path and this section is worth revisiting.
 *
 * EVERY SECTION IS A DIFFERENT SHAPE, and that is a rule rather than a
 * flourish. The page once ran four consecutive sections of hairline-separated
 * title-and-body rows: correct, legible, and completely undifferentiated, so
 * twelve hundred words of the middle of the page offered a scanner no landmark
 * at all. They are now paired figure rows, a two-panel contrast, a numbered
 * sequence, a grouped list, a single-column marker rail, a sticky aside, a
 * disclosure list and two inverse bands. Adding a section means picking a shape
 * none of its neighbours already use.
 *
 * `benefits` IS THE ONLY SECTION WITH DRAWINGS IN IT, and that is deliberate
 * too. Four of its five claims describe something a schedule DOES, so they are
 * the only ones a moving timetable can state better than a sentence can. The
 * fifth, isolation, is a drawing of nothing happening, so it runs as prose.
 * Putting a figure beside the roadmap rows or the architectural principles
 * would be decoration, because those claims are about what exists and why, not
 * about behaviour.
 *
 * `who` IS THE ONE SECTION WITH NO HEADING, deliberately: it is a single
 * sentence naming the reader, lifted out of the hero (where it was the fourth
 * text element and pushed the buttons down) into the one position where it is
 * the only thing on the line. A heading above one sentence would be longer than
 * the sentence.
 *
 * THE OPENER runs here and NOWHERE ELSE, on a visitor's first arrival only.
 * `/` is the one route where a brand moment is the job: every other page in
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
 *
 * COMPOSITION. The page's structure lives in `~/utils/landingContent` and its
 * sentences in `i18n/locales/<lang>/landing.json`; section markup is in
 * `app/components/landing/`. This file only arranges them: pages compose, they
 * do not implement. Each list is a `computed` over the builder rather than a
 * value read once at setup, so a language change re-renders the page instead of
 * freezing it in whatever language it first mounted in.
 */
definePageMeta({ layout: 'empty' });

const { t } = useT();
const { language } = useLanguage();

const problem = computed(() => landingProblem(t));
const benefits = computed(() => landingBenefits(t));
const steps = computed(() => landingSteps(t));
const built = computed(() => landingBuilt(t));
const next = computed(() => landingNext(t));
const principles = computed(() => landingPrinciples(t));
const techLead = computed(() => landingTechLead(t));
const technicalNotes = computed(() => landingTechnicalNotes(t));
const faq = computed(() => landingFaq(t));

// A getter, not a plain object: `useHead` re-evaluates it, so the tab title and
// the link-preview tags follow a language change rather than freezing at
// whatever was active when this page first rendered. Same reason `login.vue`
// does it.
useHead(() => {
    const title = t('landing.meta.title');
    const description = t('landing.meta.description');

    return {
        // The layout's titleTemplate appends " | Calendry", so naming the
        // product again here would render it twice.
        title,
        meta: [
            { name: 'description', content: description },
            /*
             * INDEXED, and stated rather than left to the default. This page is
             * an evergreen offer whose promise matches what somebody searching
             * for timetabling software is looking for, which is the case where
             * indexing is wanted; a campaign page tied to an ad or a dated
             * offer would carry `noindex` here instead. Writing it out means
             * the decision is visible to whoever adds the next public page.
             */
            { name: 'robots', content: 'index, follow' },
            /*
             * Open Graph and Twitter, because the way this page actually
             * reaches a decision-maker is somebody pasting it into Slack or
             * Teams, and with no tags at all it arrives there as a bare URL.
             * `og:image` is deliberately absent rather than pointed at a file
             * that does not exist: it needs a real asset, and a broken image
             * card is worse than a text one.
             *
             * The " | Calendry" suffix is composed here rather than keyed: it
             * is the product name and a separator, which is the same string in
             * every language, and it mirrors what the layout's titleTemplate
             * appends to the tag itself.
             *
             * `og:locale` derives from the message language, via
             * `openGraphLocale()`, which also supplies the
             * `language_TERRITORY` form Open Graph actually wants (a bare
             * `de` is not a valid value).
             */
            { property: 'og:type', content: 'website' },
            { property: 'og:site_name', content: 'Calendry' },
            { property: 'og:title', content: `${ title } | Calendry` },
            { property: 'og:description', content: description },
            { property: 'og:locale', content: openGraphLocale(language.value) },
            { name: 'twitter:card', content: 'summary' },
            { name: 'twitter:title', content: `${ title } | Calendry` },
            { name: 'twitter:description', content: description },
        ],
    };
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
     * to be a centred 1040px column, which meant a full-bleed band (the
     * inverse-toned technical section) could only be drawn with a `100vw`
     * breakout, and that overflows horizontally as soon as a scrollbar takes up
     * space. Sections own their ground; `_measure` owns the reading width.
     */
    display: flex;
    flex-direction: column;
    width: 100%;
}
</style>
