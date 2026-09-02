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
                    id="what"
                    :title="t('landing.section.what.title')"
                    :lead="t('landing.section.what.lead')"
                >
                    <LandingCapabilityRows :items="features"/>
                </LandingSection>


                <LandingSection
                    id="built"
                    :title="t('landing.section.built.title')"
                    :lead="t('landing.section.built.lead')"
                >
                    <LandingBuiltClusters :items="built"/>

                    <LandingCallout
                        :text="t('landing.callout.builtText')"
                        :action="t('landing.action.getInTouch')"
                        href="#contact"
                    />
                </LandingSection>

                <LandingSection
                    id="next"
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
                    id="contact"
                    :title="t('landing.section.contact.title')"
                    :lead="t('landing.section.contact.lead')"
                >
                    <LandingContactCapture/>
                </LandingSection>

                <LandingSection
                    id="under-the-hood"
                    :title="t('landing.section.underTheHood.title')"
                    tone="inverse"
                >
                    <LandingTechBand
                        :lead="techLead"
                        :items="technicalNotes"
                    />
                </LandingSection>
            </main>

            <LandingFooter/>
        </div>
    </CommonPageOpener>
</template>

<script setup lang="ts">
import {
    landingBuilt,
    landingFeatures,
    landingNext,
    landingPrinciples,
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
 * COMPOSITION. The page's structure lives in `~/utils/landingContent` and its
 * sentences in `i18n/locales/<lang>/landing.json`; section markup is in
 * `app/components/landing/`. This file only arranges them: pages compose, they
 * do not implement. Each list is a `computed` over the builder rather than a
 * value read once at setup, so a language change re-renders the page instead of
 * freezing it in whatever language it first mounted in.
 *
 * EVERY SECTION IS A DIFFERENT SHAPE, and that is a rule rather than a
 * flourish. The page previously ran `what`, `built`, `next` and `why` as four
 * consecutive sections of hairline-separated title-and-body rows: correct,
 * legible, and completely undifferentiated, so twelve hundred words of the
 * middle of the page offered a scanner no landmark at all. They are now paired
 * figure rows, a grouped list, a single-column marker rail and a sticky aside.
 * Adding a section means picking a shape none of its neighbours already use.
 *
 * `what` IS THE ONLY SECTION WITH DRAWINGS IN IT, and that is deliberate too.
 * Its four claims are the only ones on the page that describe something a
 * schedule DOES, so they are the only ones a moving timetable can state better
 * than a sentence can. Putting a figure beside the roadmap rows or the
 * architectural principles would be decoration, because those claims are about
 * what exists and why, not about behaviour.
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
 */
definePageMeta({ layout: 'empty' });

const { t } = useT();
const { language } = useLanguage();

const features = computed(() => landingFeatures(t));
const built = computed(() => landingBuilt(t));
const next = computed(() => landingNext(t));
const principles = computed(() => landingPrinciples(t));
const techLead = computed(() => landingTechLead(t));
const technicalNotes = computed(() => landingTechnicalNotes(t));

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
             *
             * The case for leaving it a literal `en` during the migration was
             * real and was argued: while extraction has copied English into
             * the German tree, a page reporting `de_DE` announces a language
             * it is not yet fully serving. True, and equally true of
             * `<html lang>`, which `useCalendryLayout` already derives. Two
             * mechanisms for one fact, disagreeing for the length of a
             * migration, is worse than one mechanism briefly ahead of its
             * content: the inconsistency outlives the migration, because
             * nothing reminds anybody to converge them.
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
