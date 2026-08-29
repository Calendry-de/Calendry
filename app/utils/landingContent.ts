/**
 * Copy for the public landing page (`/landing`), in one typed module.
 *
 * WHY CONTENT LIVES HERE AND NOT IN THE TEMPLATES
 *
 * Every claim on a marketing page is a claim about this repository, and the two
 * place that records what is actually true is the project board
 * (what is done, what is not) and `CLAUDE.md` (why it works the way it does).
 * Keeping the copy in one module means a claim can be checked against those two
 * files without reading nine component templates — and it means the page's
 * factual content is testable, which a template is not.
 *
 * THE RULE FOR EDITING THIS FILE: nothing here may describe a capability that
 * the project board does not have in Done. If the board and
 * this file disagree, the checklist wins and this file is wrong. Each list below
 * names the entry it came from.
 */

/**
 * Where enquiries go. The ONE place this address is written.
 *
 * Read by the contact form, the footer, and the tests — so changing the mailbox
 * is a one-line edit here and nothing else. It must be an address that actually
 * receives mail: the page composes a mail draft in the visitor's own client
 * rather than posting to an endpoint (see `~/utils/landingContact` for why), so
 * a wrong address here fails in the visitor's outbox, where nobody here can see
 * it.
 */
export const CONTACT_EMAIL = 'noah@calendry.de';

/**
 * A titled explanation.
 *
 * NO ICON FIELD, deliberately. These were twelve `material-symbols` glyphs at
 * `$primary600` — a generic B2B icon set that said nothing this product does,
 * spent the accent on decoration (which `DESIGN.md` reserves for "where a
 * session may land"), and included `auto-awesome`, the AI sparkle, directly
 * above copy promising numbers off a benchmark rather than a pitch deck. The
 * sections are typographic now; the only icons left on the page are the two
 * roadmap state markers, which encode meaning.
 */
export interface LandingFeature {
    id: string;
    title: string;
    body: string;
}

/** One line of the built/next checklist. */
export interface LandingRoadmapItem {
    id: string;
    /** `done` is shipped and working; `next` is not built. There is no third state. */
    state: 'done' | 'next';
    title: string;
    /** The honest detail — what "done" covers, or what is undecided about "next". */
    note: string;
}

/**
 * WHAT IT DOES — deliberately non-technical.
 *
 * Written for a registrar or timetabling officer, so no wire formats, no
 * "hybrid constructive + local search", no entity names that only mean
 * something inside the schema. The technical framing is a separate section
 * (`TECHNICAL_NOTES`) rather than mixed in here.
 */
export const FEATURES: LandingFeature[] = [
    {
        id: 'model',
        title: 'One place for what a timetable is made of',
        body: 'Rooms, classes and cohorts, staff and students, courses, terms, and your own daily '
            + 'block structure. Your vocabulary stays yours: role names, session types and room '
            + 'equipment are things you define, not a fixed list you have to translate into.',
    },
    {
        id: 'editing',
        title: 'Change a schedule without breaking it quietly',
        body: 'Move a session, swap two, or lock one so nothing may touch it. If a change clashes '
            + 'with something — a double-booked room, a class in two places at once — Calendry '
            + 'lets you make it and records the clash as state you can look up afterwards. It '
            + 'does not block you, and it does not forget.',
    },
    {
        id: 'solver',
        title: 'Ask for a timetable, then judge it',
        body: 'Start a run and watch it work; cancel it if you change your mind. When it finishes '
            + 'you get a proposal shown against the schedule you already have, with what it would '
            + 'change and what it could not satisfy. Nothing is applied until you apply it.',
    },
    {
        id: 'people',
        title: 'Everyone sees their own slice',
        body: 'You compose the permission roles for your institution, so who can read the '
            + 'schedule, who can move a session and who can run the solver are separate '
            + 'questions. Lecturers can enter their own unavailability and preferred teaching '
            + 'days; staff review what they declare.',
    },
];

/**
 * BUILT SO FAR — every line traces to something actually shipped.

 * THIS ARRAY IS THE CLAIM, and since `BACKLOG.md` was retired nothing checks it
 * against reality: `tests/landing-page.test.ts` proves the page renders exactly
 * what is here, not that what is here is true. Moving a card to Done on the
 * project board includes editing this file in the same change.
 *
 * ORDER IS EDITORIAL. It was the old checklist's order, which
 * opened on "Multi-tenant data model and API" and buried "Schedule view and
 * editor" third — answering an architecture question first for a reader whose
 * first question is "can it hold my week". The list now runs from what a
 * timetabling officer touches daily to what an evaluator asks about last.
 *
 * `note` exists to keep the claim narrow. "Solver integration" without a note
 * would be read as "it schedules your whole institution for you"; with one it
 * says exactly which four operations exist.
 */
export const BUILT: LandingRoadmapItem[] = [
    {
        id: 'schedule',
        state: 'done',
        title: 'Schedule view and editor',
        note: 'Week grid on a desktop, day agenda on a phone. Move, swap and lock, with clashes '
            + 'recorded rather than refused, and every edit appended to a log with an actor.',
    },
    {
        id: 'manage',
        state: 'done',
        title: 'Management screens for the core entities',
        note: 'Rooms, groups, people, courses, terms, the daily block grid and its breaks, plus a '
            + 'Ctrl+K palette that jumps to any of them.',
    },
    {
        id: 'calendar',
        state: 'done',
        title: 'Academic calendar periods',
        note: 'Holidays, breaks and exam weeks, with a preview of exactly which weeks change '
            + 'classification before you save — because two dates do not obviously imply four '
            + 'exam weeks, and sometimes they do.',
    },
    {
        id: 'events',
        state: 'done',
        title: 'One-off events alongside recurring courses',
        note: 'Create a session that belongs to no course — an open day, a guest lecture — with '
            + 'its own room, groups and people.',
    },
    {
        id: 'availability',
        state: 'done',
        title: 'Self-service availability',
        note: 'A lecturer declares when they cannot teach, and which days, times and kinds of '
            + 'room they would rather have; staff approve or reject each declaration. Reaching '
            + 'only your own data is the point of that section.',
    },
    {
        id: 'solver-integration',
        state: 'done',
        title: 'Solver integration, end to end',
        note: 'Start a run, keep the result even if the solver restarts, review the proposal '
            + 'against the current schedule, then apply or discard it. A run that succeeds with '
            + 'rules still broken is still offered — with the breaches listed — rather than '
            + 'thrown away. A clash made by hand can be repaired without rebuilding the term: '
            + 'the repair moves as little as it can, and still produces a proposal to review.',
    },
    {
        id: 'constraints',
        state: 'done',
        title: 'Rules each institution configures for itself',
        note: 'Thirty rule types, switched on and weighted per institution: double-booking, '
            + 'session counts, unavailability, online share, room rank and exam periods, plus '
            + 'the shape of a day — idle gaps, teaching without a break, how long it runs, and '
            + 'whether it crosses buildings. Rooms can be reserved institution-wide, sized to '
            + 'the group actually attending, and kept consistent for a class across the week.',
    },
    {
        id: 'federation',
        state: 'done',
        title: 'Shared rooms across a federation',
        note: 'Institutions in a consortium can share a lecture hall and see each other\'s '
            + 'occupancy of it, without seeing each other\'s schedules.',
    },
    {
        id: 'determinism',
        state: 'done',
        title: 'Reproducible runs',
        note: 'The same inputs and the same seed produce a byte-identical timetable — as long as '
            + 'the run ended on its move budget rather than on a clock, which the run itself '
            + 'reports.',
    },
    {
        id: 'auth',
        state: 'done',
        title: 'Sign-in and per-institution permission roles',
        note: 'One account can act in several institutions and picks which at sign-in. Roles are '
            + 'composed from a fixed catalogue of permissions, per institution, in the UI.',
    },
    {
        id: 'tenancy',
        state: 'done',
        title: 'Multi-tenant data model and API',
        note: 'Institutions are isolated in the database itself, not only in application code. A '
            + 'query issued without institution context returns nothing rather than everything.',
    },
];

/**
 * WHAT'S NEXT — what the project board has not finished, plus the
 * items from § "Features not built" and § "Needs a decision" that a customer
 * would actually notice.
 *
 * "Needs a decision" items say so. A roadmap that presents an undecided idea as
 * a dated commitment is the thing this page is trying not to be.
 */
export const NEXT: LandingRoadmapItem[] = [
    {
        id: 'import',
        state: 'next',
        title: 'Import from CSV and Excel',
        note: 'For institutions arriving with years of spreadsheets. How the column mapping works '
            + '— guided, or a fixed template — is not decided yet.',
    },
    {
        id: 'export',
        state: 'next',
        title: 'Export to iCal, Google Calendar and Outlook',
        note: 'Not started. Today a schedule lives in Calendry and is read there.',
    },
    {
        id: 'notifications',
        state: 'next',
        title: 'Notification delivery',
        note: 'Calendry already works out who an edit affects. Nothing sends anything yet, so the '
            + 'answer currently goes to a screen instead of an inbox.',
    },
    {
        id: 'event-edit',
        state: 'next',
        title: 'Editing a one-off event after creating it',
        note: 'Its time can be moved, but its room, groups and people cannot be changed — '
            + 'correcting a mistake means deleting and recreating it.',
    },
    {
        id: 'person-search',
        state: 'next',
        title: 'A searchable person picker',
        note: 'The current control lists everyone in the institution. Fine for twenty people, '
            + 'wrong for two thousand — and the screen says so where it matters.',
    },
    {
        id: 'candidates',
        state: 'next',
        title: 'Several candidate schedules to choose between',
        note: 'Needs a design pass before it needs code: candidates that differ only trivially '
            + 'would be worse than one result. It may not be built at all.',
    },
    {
        id: 'i18n',
        state: 'next',
        title: 'A translated interface',
        note: 'Decided in principle and deliberately not started in pieces: a long half-'
            + 'translated interface was judged worse than an English one.',
    },
];

/**
 * WHY IT WORKS THIS WAY — architectural decisions from CLAUDE.md, not invented
 * differentiators. Each one is a real rule this codebase is built on, and each
 * is stated with its consequence rather than as a virtue.
 */
export const PRINCIPLES: LandingFeature[] = [
    {
        id: 'warn',
        title: 'Warn, never block',
        body: 'A person editing a timetable usually knows something the rules do not. So an edit '
            + 'that breaks a hard rule is permitted, and the breach becomes queryable state '
            + 'attached to the schedule — findable next week, not a toast you dismissed.',
    },
    {
        id: 'groups',
        title: 'Nested groups really do clash',
        body: 'Booking a programme blocks its cohorts, and booking a cohort blocks the '
            + 'programme. Clash detection walks the whole ancestor-and-descendant relationship '
            + 'through a maintained closure, rather than comparing the two names it was handed.',
    },
    {
        id: 'isolation',
        title: 'Isolation in the database, not in the code',
        body: 'Every institution-scoped table is guarded by row-level security, and the '
            + 'application connects as a role that owns nothing. The failure mode of a mistake '
            + 'is seeing no rows, which is loud, rather than seeing someone else\'s, which is '
            + 'not.',
    },
    {
        id: 'time',
        title: 'Nothing about time is hardcoded',
        body: 'Days per week, blocks per day, block length and the uneven breaks between blocks '
            + 'come from each institution\'s own grid. There is no assumed Monday-to-Friday and '
            + 'no fallback shape anywhere — an institution without a grid gets an empty state, '
            + 'not a guess.',
    },
    {
        id: 'events',
        title: 'Every edit is an event',
        body: 'Creates, moves, swaps, deletes and locks are appended to a log, on top of the '
            + 'generation they started from, with the person who did it. Reading that history '
            + 'back has no screen yet — the log is being kept properly before there is anything '
            + 'to show it in.',
    },
];

/**
 * The one measurement set large enough to read as the argument it is.
 *
 * ONE number, in running text — not a three-up stat row with an accent, which
 * is the stock template and would put "27,000", "350ms" and "4s" at equal
 * weight when only the first pair is the claim. `figure` carries tabular
 * numerals for the same reason every clock time in the schedule does.
 */
export const TECH_LEAD = {
    figure: '27,000 sessions, placed in about 350 milliseconds.',
    note: 'That is a synthetic large-university instance. The development '
        + 'database\'s own term runs all the way to convergence in about four '
        + 'seconds. Both numbers came off a benchmark rather than a pitch deck, '
        + 'and both will move as the constraint set grows.',
};

/** The technically-curious section. Plain sentences, real numbers, no adjectives. */
export const TECHNICAL_NOTES: LandingFeature[] = [
    {
        id: 'app',
        title: 'The application',
        body: 'Nuxt and TypeScript over PostgreSQL. Tenant isolation is enforced by row-level '
            + 'security policies; the schedule\'s history is an append-only event log applied on '
            + 'top of a versioned snapshot.',
    },
    {
        id: 'solver',
        title: 'The solver',
        body: 'A separate stateless Rust service, reached over gRPC against a shared schema. '
            + 'Hybrid constructive placement followed by large-neighbourhood local search with '
            + 'simulated annealing, over thirty constraint types. It holds no database: every '
            + 'run is a complete snapshot the application sends it.',
    },
];
