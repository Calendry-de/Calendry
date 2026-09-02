import type { Translate } from '~/composables/i18n';

/**
 * Copy for the public landing page (`/`), in one typed module.
 *
 * WHY CONTENT LIVES HERE AND NOT IN THE TEMPLATES
 *
 * Every claim on a marketing page is a claim about this repository, and the two
 * place that records what is actually true is the project board
 * (what is done, what is not) and `CLAUDE.md` (why it works the way it does).
 * Keeping the copy in one module means a claim can be checked against those two
 * files without reading nine component templates, and it means the page's
 * factual content is testable, which a template is not.
 *
 * THE RULE FOR EDITING THIS FILE: nothing here may describe a capability that
 * the project board does not have in Done. If the board and
 * this file disagree, the checklist wins and this file is wrong. Each list below
 * names the entry it came from.
 *
 * WHAT ISSUE #19 CHANGED, AND WHAT IT DELIBERATELY DID NOT
 *
 * The SENTENCES now live in `i18n/locales/<lang>/landing.json`; this module
 * keeps the STRUCTURE, which is the part that carries meaning a translator has
 * no business editing: the ids, the reading order, the `done`/`next` state, the
 * cluster each built row belongs under, and which timetable figure acts out
 * which claim. `i18n/CONVENTIONS.md` forbids arrays in the message tree (they
 * would make a branch a valid leaf and break `MessageKey`), so each list below
 * is an array of message KEYS and a builder function maps `t` over it.
 *
 * The builders take `t` rather than calling `useT()` themselves, for the reason
 * `Translate`'s own doc comment gives: this module is imported by
 * `tests/landing-page.test.ts`, which runs in plain Node with no Nuxt instance
 * at all. Required, never optional with an identity fallback, so a caller that
 * forgets it is a typecheck error rather than a page of raw keys.
 */

/**
 * Where enquiries go. The ONE place this address is written.
 *
 * Read by the contact form, the footer, and the tests, so changing the mailbox
 * is a one-line edit here and nothing else. It must be an address that actually
 * receives mail: the page composes a mail draft in the visitor's own client
 * rather than posting to an endpoint (see `~/utils/landingContact` for why), so
 * a wrong address here fails in the visitor's outbox, where nobody here can see
 * it.
 *
 * NOT COPY, and so not in the message catalogue: an address is the same string
 * in every language, and a translator given one could only break it.
 */
export const CONTACT_EMAIL = 'noah@calendry.de';

/**
 * Where the page's ONE call to action goes.
 *
 * The design system allows a landing page exactly one primary action, and this
 * page's is "book a walkthrough". Paste the scheduling link here and every CTA
 * on the page points at it, because they all resolve through
 * `landingCtaTarget()` rather than writing a URL of their own.
 *
 * NULL IS A SUPPORTED STATE, not a placeholder waiting to be filled in, and it
 * is the reason this is a resolver rather than a bare constant. A button
 * pointing at `#` is forbidden (a dead link is worse than a different link), so
 * with no scheduling link configured the action degrades to the enquiry mailbox
 * and the LABEL changes with it: `landingCtaTarget()` reports which target it
 * returned, and the caller picks the message key to match. A page that says
 * "book a walkthrough" and opens a blank email has lied about what the click
 * does, which is the one thing a call to action may never do.
 *
 * NOT COPY, so not in the message catalogue: a URL is the same string in every
 * language, for the same reason `CONTACT_EMAIL` is not a message.
 */
export const BOOKING_URL: string | null = null;

/**
 * The public repository, as one string.
 *
 * The page claims a reader can go and check it, so the claim needs somewhere to
 * point. Written without a scheme because it is rendered as label text as well
 * as used as a link, and "https://" in the middle of a sentence is noise;
 * `REPO_HREF` is the navigable form.
 *
 * READABLE, NOT OPEN SOURCE, and the page says so. There is no licence file on
 * this repository, which means all rights are reserved and a visitor may read
 * the code without being permitted to reuse it. Calling it open source here
 * would be the one kind of overclaim this page exists to avoid.
 */
export const REPO_LABEL = 'github.com/Calendry-de/Calendry';

/** The same repository, navigable. */
export const REPO_HREF = `https://${ REPO_LABEL }`;

/** Where the primary action points, and which of the two it turned out to be. */
export interface LandingCtaTarget {
    href: string;
    /**
     * `true` when a real scheduling link is configured. Discriminates the
     * LABEL as well as the destination: the caller must not assume it can
     * promise a booking.
     */
    booking: boolean;
}

/**
 * Resolve the primary action's destination.
 *
 * The one place that decides between the scheduling link and the mailbox, so
 * the hero CTA, the closing CTA and the nav capsule cannot disagree about where
 * the page's single action goes.
 */
export function landingCtaTarget(): LandingCtaTarget {
    if (BOOKING_URL === null) {
        return { href: `mailto:${ CONTACT_EMAIL }`, booking: false };
    }

    return { href: BOOKING_URL, booking: true };
}

/**
 * A titled explanation.
 *
 * NO ICON FIELD, deliberately. These were twelve `material-symbols` glyphs at
 * `$primary600`, a generic B2B icon set that said nothing this product does,
 * spent the accent on decoration (which `DESIGN.md` reserves for "where a
 * session may land"), and included `auto-awesome`, the AI sparkle, directly
 * above copy promising numbers off a benchmark rather than a pitch deck. The
 * sections are typographic now; the only icons left on the page are the two
 * roadmap state markers, which encode meaning.
 *
 * `title` and `body` are RESOLVED strings, not keys: every reader of this shape
 * renders them straight into a template, and making the fields callable would
 * push `t` outward into all five of them (`i18n/CONVENTIONS.md`, "thread `t`
 * into the function that BUILDS the structure").
 */
export interface LandingFeature {
    id: string;
    title: string;
    body: string;
    /**
     * Which timetable script runs beside this paragraph, on the sections that
     * pair the two. Optional because `landingPrinciples()` and
     * `landingTechnicalNotes()` reuse this shape and are set as plain prose.
     */
    figure?: TimetableVariant;
}

/**
 * The four things a small timetable can act out beside a paragraph.
 *
 * Named for what the schedule DOES rather than for the section it appears in,
 * because the figure is the claim being demonstrated: assembling a week, moving
 * a session and recording the clash, receiving a whole proposal, and reducing
 * the field to one person's sessions.
 */
export type TimetableVariant = 'model' | 'editing' | 'solver' | 'people';

/** One line of the built/next checklist. */
export interface LandingRoadmapItem {
    id: string;
    /** `done` is shipped and working; `next` is not built. There is no third state. */
    state: 'done' | 'next';
    title: string;
    /** The honest detail: what "done" covers, or what is undecided about "next". */
    note: string;
    /**
     * Which cluster of `BUILT_CLUSTERS` this row belongs under. Present on every
     * `done` row and on none of the `next` ones, because only the built list is
     * long enough to need grouping.
     *
     * NOT a taxonomy and not a feature category: purely a reading aid, so that
     * fourteen rows arrive as four answerable questions instead of one wall. A
     * new row picks the cluster a reader would look under, and `BUILT_CLUSTERS`
     * is the whole list of choices.
     */
    cluster?: BuiltCluster;
}

/**
 * The four questions the built list answers, in reading order.
 *
 * ORDER IS THE SAME EDITORIAL ARGUMENT the flat list already made: what a
 * timetabling officer touches daily comes first, what an evaluator asks about
 * last comes last. Grouping did not reorder the claims, it only put a heading
 * every three or four rows so the spine of the page can be scanned rather than
 * only read.
 *
 * THESE ARE IDS, NOT HEADINGS, and that changed with issue #19. They used to be
 * the English headings themselves, which made the value a row is matched on and
 * the text a reader sees the same string: translating one would have silently
 * unmatched every row. `builtClusterTitle()` is where the heading comes from
 * now.
 */
export const BUILT_CLUSTERS = [
    'runningTerm',
    'askingForTimetable',
    'whoCanReachWhat',
    'moreThanOneInstitution',
] as const;

export type BuiltCluster = typeof BUILT_CLUSTERS[number];

/**
 * The heading for one cluster.
 *
 * An explicit map rather than a key built by string concatenation, so a cluster
 * added to `BUILT_CLUSTERS` without a message is a typecheck error here instead
 * of a raw `landing.built.cluster.whatever` rendered as an `<h3>`.
 */
const BUILT_CLUSTER_TITLES = {
    runningTerm: 'landing.built.cluster.runningTerm',
    askingForTimetable: 'landing.built.cluster.askingForTimetable',
    whoCanReachWhat: 'landing.built.cluster.whoCanReachWhat',
    moreThanOneInstitution: 'landing.built.cluster.moreThanOneInstitution',
} as const satisfies Record<BuiltCluster, string>;

export function builtClusterTitle(cluster: BuiltCluster, t: Translate): string {
    return t(BUILT_CLUSTER_TITLES[cluster]);
}

/**
 * An entry's identity and its two message keys, in the order the page renders
 * them.
 *
 * BENEFITS, NOT FEATURES, and the rename is the point rather than tidying. The
 * four entries here were `landing.feature.*` and were titled by what the
 * software HAS ("One place for what a timetable is made of"). A landing page
 * has to be titled by what the reader GETS, so every title is now an outcome
 * and the mechanism moved into the body, where somebody who wants it will
 * still find it.
 *
 * FIVE, AND ONLY FOUR CARRY A FIGURE. `TimetableVariant` has exactly four
 * scripts because there are four things a small timetable can act out, and
 * isolation is not one of them: a drawing of two institutions not seeing each
 * other's data is a drawing of nothing happening. It runs as prose, which is
 * also why `figure` is optional on `LandingFeature`.
 *
 * ORDER IS THE ARGUMENT. Speed first, because it is the only claim with a
 * measurement attached and the one a sceptical reader tests everything else
 * against; isolation last, because it is the question an evaluator asks after
 * they already want the product.
 */
const BENEFIT_KEYS = [
    { id: 'solver', figure: 'solver', title: 'landing.benefit.solver.title', body: 'landing.benefit.solver.body' },
    { id: 'editing', figure: 'editing', title: 'landing.benefit.editing.title', body: 'landing.benefit.editing.body' },
    { id: 'model', figure: 'model', title: 'landing.benefit.model.title', body: 'landing.benefit.model.body' },
    { id: 'people', figure: 'people', title: 'landing.benefit.people.title', body: 'landing.benefit.people.body' },
    { id: 'isolation', title: 'landing.benefit.isolation.title', body: 'landing.benefit.isolation.body' },
] as const satisfies readonly { id: string; figure?: TimetableVariant; title: string; body: string }[];

/**
 * WHAT THE READER GETS: deliberately non-technical in the title, specific in
 * the body.
 *
 * Written for a registrar or timetabling officer, so no wire formats, no
 * "hybrid constructive + local search", no entity names that only mean
 * something inside the schema. The technical framing is a separate section
 * (`landingTechnicalNotes()`) rather than mixed in here.
 */
export function landingBenefits(t: Translate): LandingFeature[] {
    return BENEFIT_KEYS.map((entry): LandingFeature => ({
        id: entry.id,
        ...('figure' in entry ? { figure: entry.figure } : {}),
        title: t(entry.title),
        body: t(entry.body),
    }));
}

/** The two halves of the problem-to-solution contrast, in reading order. */
export function landingProblem(t: Translate): LandingFeature[] {
    return [
        {
            id: 'before',
            title: t('landing.problem.before.title'),
            body: t('landing.problem.before.body'),
        },
        {
            id: 'after',
            title: t('landing.problem.after.title'),
            body: t('landing.problem.after.body'),
        },
    ];
}

/**
 * The tagline reveal's two lines.
 *
 * TWO MESSAGES RATHER THAN ONE WITH A BREAK IN IT, for the same reason the hero
 * headline is two: the design system requires the break to be authored at a
 * meaningful point rather than left to the browser, and a translator has to be
 * able to move it. German puts its verb somewhere English does not, so a break
 * position that works in one language is arbitrary in the other.
 *
 * The section animates this a WORD at a time, so the component splits these
 * strings. That is safe to do to a translated sentence in a way that splitting
 * on characters would not be.
 */
export function landingTagline(t: Translate): { lineOne: string; lineTwo: string } {
    return {
        lineOne: t('landing.tagline.lineOne'),
        lineTwo: t('landing.tagline.lineTwo'),
    };
}

/** One numbered step of "how it works". */
export interface LandingStep {
    id: string;
    title: string;
    body: string;
}

const STEP_KEYS = [
    { id: 'describe', title: 'landing.step.describe.title', body: 'landing.step.describe.body' },
    { id: 'ask', title: 'landing.step.ask.title', body: 'landing.step.ask.body' },
    { id: 'judge', title: 'landing.step.judge.title', body: 'landing.step.judge.body' },
] as const;

/**
 * HOW IT WORKS: three steps, and the third is the reader's.
 *
 * Three because the design system asks for three, and because the process
 * genuinely has three parts. The number is NOT rendered from this list's index
 * by the component doing arithmetic on it: the component numbers them from
 * their position, so adding a fourth step cannot leave a "3" beside the fourth
 * item.
 */
export function landingSteps(t: Translate): LandingStep[] {
    return STEP_KEYS.map((entry): LandingStep => ({
        id: entry.id,
        title: t(entry.title),
        body: t(entry.body),
    }));
}

/** One question and its answer. */
export interface LandingFaqEntry {
    id: string;
    question: string;
    answer: string;
}

/**
 * THE OBJECTION LIST, in the order a sceptical reader raises it.
 *
 * These are objections, not features restated as questions, which is what an
 * FAQ becomes when it is written by the people who built the thing. The first
 * two are the ones that lose the sale ("can it run our term", "can it take our
 * spreadsheets") and both are answered with a no or a partial no, because the
 * page's whole credibility rests on the roadmap section being believed.
 *
 * EVERY ANSWER TRACES TO A FACT, the same rule the built list follows: to
 * something in `CLAUDE.md`, in the built list below, or on the pricing page.
 * An FAQ is the easiest place on a marketing page to write a reassuring
 * sentence nobody checked, and it is read by exactly the people who will check.
 *
 * The section renders these into FAQ structured data as well as into the page,
 * from this one list, so the two cannot drift.
 */
const FAQ_KEYS = [
    { id: 'runTerm', q: 'landing.faq.runTerm.q', a: 'landing.faq.runTerm.a' },
    { id: 'import', q: 'landing.faq.import.q', a: 'landing.faq.import.a' },
    { id: 'decides', q: 'landing.faq.decides.q', a: 'landing.faq.decides.a' },
    { id: 'breaks', q: 'landing.faq.breaks.q', a: 'landing.faq.breaks.a' },
    { id: 'week', q: 'landing.faq.week.q', a: 'landing.faq.week.a' },
    { id: 'federation', q: 'landing.faq.federation.q', a: 'landing.faq.federation.a' },
    { id: 'permissions', q: 'landing.faq.permissions.q', a: 'landing.faq.permissions.a' },
    { id: 'reproducible', q: 'landing.faq.reproducible.q', a: 'landing.faq.reproducible.a' },
    { id: 'cost', q: 'landing.faq.cost.q', a: 'landing.faq.cost.a' },
    { id: 'accounts', q: 'landing.faq.accounts.q', a: 'landing.faq.accounts.a' },
    { id: 'code', q: 'landing.faq.code.q', a: 'landing.faq.code.a' },
] as const;

export function landingFaq(t: Translate): LandingFaqEntry[] {
    return FAQ_KEYS.map((entry): LandingFaqEntry => ({
        id: entry.id,
        question: t(entry.q),
        answer: t(entry.a),
    }));
}

/**
 * BUILT SO FAR: every line traces to something actually shipped.
 *
 * THIS LIST IS THE CLAIM, and since `BACKLOG.md` was retired nothing checks it
 * against reality: `tests/landing-page.test.ts` proves the page renders exactly
 * what is here, not that what is here is true. Moving a card to Done on the
 * project board includes editing this file in the same change.
 *
 * ORDER IS EDITORIAL. It was the old checklist's order, which
 * opened on the multi-institution data model and buried "Schedule view and
 * editor" third, answering an architecture question first for a reader whose
 * first question is "can it hold my week". The list now runs from what a
 * timetabling officer touches daily to what an evaluator asks about last.
 *
 * The `note` message exists to keep the claim narrow. "Solver integration"
 * without a note would be read as "it schedules your whole institution for
 * you"; with one it says exactly which four operations exist.
 */
const BUILT_KEYS = [
    {
        id: 'schedule',
        cluster: 'runningTerm',
        title: 'landing.built.schedule.title',
        note: 'landing.built.schedule.note',
    },
    {
        id: 'manage',
        cluster: 'runningTerm',
        title: 'landing.built.manage.title',
        note: 'landing.built.manage.note',
    },
    {
        id: 'calendar',
        cluster: 'runningTerm',
        title: 'landing.built.calendar.title',
        note: 'landing.built.calendar.note',
    },
    {
        id: 'events',
        cluster: 'runningTerm',
        title: 'landing.built.events.title',
        note: 'landing.built.events.note',
    },
    {
        id: 'ical-export',
        cluster: 'whoCanReachWhat',
        title: 'landing.built.icalExport.title',
        note: 'landing.built.icalExport.note',
    },
    {
        id: 'person-search',
        cluster: 'runningTerm',
        title: 'landing.built.personSearch.title',
        note: 'landing.built.personSearch.note',
    },
    {
        id: 'exams',
        cluster: 'whoCanReachWhat',
        title: 'landing.built.exams.title',
        note: 'landing.built.exams.note',
    },
    {
        id: 'availability',
        cluster: 'whoCanReachWhat',
        title: 'landing.built.availability.title',
        note: 'landing.built.availability.note',
    },
    {
        id: 'solver-integration',
        cluster: 'askingForTimetable',
        title: 'landing.built.solverIntegration.title',
        note: 'landing.built.solverIntegration.note',
    },
    {
        id: 'constraints',
        cluster: 'askingForTimetable',
        title: 'landing.built.constraints.title',
        note: 'landing.built.constraints.note',
    },
    {
        id: 'federation',
        cluster: 'moreThanOneInstitution',
        title: 'landing.built.federation.title',
        note: 'landing.built.federation.note',
    },
    {
        id: 'determinism',
        cluster: 'askingForTimetable',
        title: 'landing.built.determinism.title',
        note: 'landing.built.determinism.note',
    },
    {
        id: 'auth',
        cluster: 'whoCanReachWhat',
        title: 'landing.built.auth.title',
        note: 'landing.built.auth.note',
    },
    {
        id: 'tenancy',
        cluster: 'moreThanOneInstitution',
        title: 'landing.built.tenancy.title',
        note: 'landing.built.tenancy.note',
    },
] as const satisfies readonly { id: string; cluster: BuiltCluster; title: string; note: string }[];

export function landingBuilt(t: Translate): LandingRoadmapItem[] {
    return BUILT_KEYS.map((entry): LandingRoadmapItem => ({
        id: entry.id,
        state: 'done',
        cluster: entry.cluster,
        title: t(entry.title),
        note: t(entry.note),
    }));
}

/**
 * WHAT'S NEXT: what the project board has not finished, plus the
 * items from § "Features not built" and § "Needs a decision" that a customer
 * would actually notice.
 *
 * "Needs a decision" items say so. A roadmap that presents an undecided idea as
 * a dated commitment is the thing this page is trying not to be.
 */
const NEXT_KEYS = [
    { id: 'import', title: 'landing.next.import.title', note: 'landing.next.import.note' },
    { id: 'export', title: 'landing.next.export.title', note: 'landing.next.export.note' },
    { id: 'notifications', title: 'landing.next.notifications.title', note: 'landing.next.notifications.note' },
    { id: 'event-edit', title: 'landing.next.eventEdit.title', note: 'landing.next.eventEdit.note' },
    { id: 'candidates', title: 'landing.next.candidates.title', note: 'landing.next.candidates.note' },
    { id: 'i18n', title: 'landing.next.i18n.title', note: 'landing.next.i18n.note' },
] as const;

export function landingNext(t: Translate): LandingRoadmapItem[] {
    return NEXT_KEYS.map((entry): LandingRoadmapItem => ({
        id: entry.id,
        state: 'next',
        title: t(entry.title),
        note: t(entry.note),
    }));
}

/**
 * WHY IT WORKS THIS WAY: architectural decisions from CLAUDE.md, not invented
 * differentiators. Each one is a real rule this codebase is built on, and each
 * is stated with its consequence rather than as a virtue.
 */
const PRINCIPLE_KEYS = [
    { id: 'warn', title: 'landing.principle.warn.title', body: 'landing.principle.warn.body' },
    { id: 'groups', title: 'landing.principle.groups.title', body: 'landing.principle.groups.body' },
    { id: 'isolation', title: 'landing.principle.isolation.title', body: 'landing.principle.isolation.body' },
    { id: 'time', title: 'landing.principle.time.title', body: 'landing.principle.time.body' },
    { id: 'events', title: 'landing.principle.events.title', body: 'landing.principle.events.body' },
] as const;

export function landingPrinciples(t: Translate): LandingFeature[] {
    return PRINCIPLE_KEYS.map((entry): LandingFeature => ({
        id: entry.id,
        title: t(entry.title),
        body: t(entry.body),
    }));
}

/**
 * The one measurement set large enough to read as the argument it is.
 *
 * ONE number, in running text, not a three-up stat row with an accent, which
 * is the stock template and would put "27,000", "350ms" and "4s" at equal
 * weight when only the first pair is the claim. `figure` carries tabular
 * numerals for the same reason every clock time in the schedule does.
 *
 * The numerals stay INSIDE the message rather than being interpolated into it.
 * They are not data this app measures at runtime, they are two figures off a
 * benchmark, and a locale that writes 27.000 has to be able to write it.
 */
export function landingTechLead(t: Translate): { figure: string; note: string } {
    return {
        figure: t('landing.techLead.figure'),
        note: t('landing.techLead.note'),
    };
}

/** The technically-curious section. Plain sentences, real numbers, no adjectives. */
const TECHNICAL_NOTE_KEYS = [
    { id: 'app', title: 'landing.technical.app.title', body: 'landing.technical.app.body' },
    { id: 'solver', title: 'landing.technical.solver.title', body: 'landing.technical.solver.body' },
] as const;

export function landingTechnicalNotes(t: Translate): LandingFeature[] {
    return TECHNICAL_NOTE_KEYS.map((entry): LandingFeature => ({
        id: entry.id,
        title: t(entry.title),
        body: t(entry.body),
    }));
}
