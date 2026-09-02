import type { PermissionRequirement } from '#shared/permissions';
import type { Translate } from '~/composables/i18n';
import type { MessageKey } from '~~/i18n/keys';
import { searchKeywords } from '~/utils/i18nKeywords';
import { entityPermission, manageEntities } from '~/utils/manageRegistry';
import { MY_HUB_PERMISSIONS, MY_SECTION_PERMISSIONS } from '~/utils/mySectionPermissions';
import { SCHEDULE_PERMISSIONS } from '~/utils/schedulePermissions';
import { HOME_ROUTE } from '~/utils/routes';

/**
 * The navigation registry: one typed list behind the header, `CommonAppShell`'s
 * sidebar (on `/dashboard` and every `/manage/*` page), and the Ctrl+K palette.
 * What places exist, what they are called, and who may see them; not fetching,
 * not the palette's open/close machine, not permissions themselves.
 *
 * The `manage.*` entries are PROJECTED from `manageEntities()` rather than retyped,
 * which is why the sidebar and the palette cannot drift.
 */
export type NavSection = 'schedule' | 'my' | 'manage' | 'account';

export interface NavEntry {
    /** Stable id. Used as a key and for the palette's recent-selection memory. */
    id: string;
    label: string;
    /** One line. Section card body and palette subtitle. */
    description?: string;
    icon: string;
    section: NavSection;
    /**
     * Extra terms the fuzzy match should hit. Never shown, but translated
     * anyway: they are how Ctrl+K is searched, so English-only synonyms make
     * the palette unusable in the default language. `searchKeywords()` merges
     * the translated list with the English aliases; see its note.
     */
    keywords: string[];
    /**
     * Catalogue permission(s) required to see this entry at all. Absent means
     * "always visible", used only for account actions, which are about the
     * session rather than tenant data.
     *
     * AN AND OF ORS (`PermissionRequirement`, the same shape the relation gates
     * use). A bare string is one permission; a list of strings means ALL of
     * them; a NESTED list is one clause satisfied by ANY of its members.
     *
     *     'session.read'                          that one
     *     ['session.read', 'term.read']           both
     *     [['session.read', 'session.read_own']]  either
     *
     * The all-of form came first, from `/schedule`, which used to draw nothing
     * without six separate reads, so offering the link on the strength of one of
     * them led straight to a blank page. The any-of form arrived with
     * `session.read_own`: the schedule is now reachable two ways, and an entry
     * that could only say "all of" would have to name the more privileged key
     * and hide the page from exactly the people it was added for.
     */
    permission?: string | PermissionRequirement;
    /** Exactly one of `to` / `run` is set. */
    to?: string;
    run?: () => void | Promise<void>;
    /** Promoted to the top-level header nav. */
    inHeader?: boolean;
}

/**
 * The heading each section is announced under, as message keys.
 *
 * A `Record` over the union rather than a `switch`, so adding a `NavSection`
 * is a typecheck error here naming the missing heading, not a section that
 * renders under `undefined`.
 */
const NAV_SECTION_LABEL_KEYS: Record<NavSection, MessageKey> = {
    schedule: 'nav.section.schedule',
    my: 'nav.section.my',
    manage: 'nav.section.manage',
    account: 'nav.section.account',
};

/** The heading the command palette groups this section's results under. */
export function navSectionLabel(section: NavSection, t: Translate): string {
    return t(NAV_SECTION_LABEL_KEYS[section]);
}

/**
 * Manage-area entries, derived from the entity registry. One array, one truth.
 *
 * `t` is threaded through rather than used here: every string below is the
 * REGISTRY's, already resolved by `manageEntities()` (issue #19), so this
 * projection stays what it was, a rename of fields.
 */
function manageEntries(t: Translate): NavEntry[] {
    return manageEntities(t).map((entity) => ({
        id: `manage.${entity.key}`,
        label: entity.plural,
        description: entity.description,
        icon: entity.icon,
        section: 'manage' as const,
        keywords: [entity.label.toLowerCase(), ...entity.keywords],
        permission: entityPermission(entity, 'read'),
        to: `/manage/${entity.key}`,
    }));
}

/**
 * Every PLACE: the entries that are a destination rather than a session action.
 *
 * Module-level and PURE, unlike the account entries in `useNavRegistry` below:
 * nothing here closes over a ref, a cookie or the router, so it needs no Nuxt
 * instance. That is the point: it makes the registry's destinations importable
 * from a plain unit test, which is how `tests/nav-groups.test.ts` can check
 * that `CommonAppShell`'s sidebar grouping covers every one of them.
 *
 * All of this used to live inside `useNavRegistry`'s computed, where no test
 * could reach it, and `/manage/data-export` sat unclassified by `NAV_GROUPS`
 * for exactly that reason, reachable in the header and in Ctrl+K but silently
 * missing from the app's one persistent nav.
 *
 * Still pure after issue #19: `t` is a PARAMETER, so the only thing a caller
 * needs is a translator, not a Nuxt instance. `Translate`
 * (`~/composables/i18n`) carries the reasoning for why this module cannot
 * call `useT()` itself, and why the parameter is on the function rather than
 * on each `label`. The manage entries' copy is NOT
 * translated here: labels, descriptions AND keywords are projected from
 * `manageEntities()`, so they belong to the `manage` namespace and are
 * translated at their source.
 */
export function navPlaces(t: Translate): NavEntry[] {
    return [
        {
            id: 'home',
            label: t('nav.place.home.label'),
            description: t('nav.place.home.description'),
            icon: 'material-symbols:other-houses-outline',
            section: 'schedule',
            // Not 'landing': `/` is the PUBLIC landing page and this entry is
            // the signed-in home, so that keyword would send a Ctrl+K search
            // for the marketing page to the dashboard instead.
            keywords: searchKeywords(t, 'nav.place.home.keywords', ['home', 'start', 'dashboard', 'overview']),
            // HOME_ROUTE, not the literal: it is the single definition of where
            // a signed-in session belongs, and this entry was the one place that
            // still spelled it out, so changing it would have moved the
            // post-login redirect while leaving the Home link pointing at the
            // old page.
            to: HOME_ROUTE,
            inHeader: true,
        },
        {
            id: 'schedule',
            label: t('nav.place.schedule.label'),
            description: t('nav.place.schedule.description'),
            icon: 'material-symbols:calendar-view-week-outline',
            section: 'schedule',
            keywords: searchKeywords(t, 'nav.place.schedule.keywords', ['schedule', 'timetable', 'grid', 'week', 'calendar', 'sessions']),
            /*
             * EITHER read key: see `schedulePermissions.ts`, which the route
             * middleware reads too, so the link and the destination cannot
             * disagree. It was six permissions, all required, until the page
             * stopped assembling the institution's directory in order to draw
             * itself.
             */
            permission: SCHEDULE_PERMISSIONS,
            to: '/schedule',
            inHeader: true,
        },
        {
            /*
             * IN THE MANAGE SECTION though the route lives under /schedule:
             * membership is decided by the id prefix, so this appears in the manage
             * sidebar, index and palette while `to` keeps the path alongside the
             * schedule routes, sharing their `review` middleware.
             */
            id: 'manage.proposals',
            label: t('nav.place.manageProposals.label'),
            description: t('nav.place.manageProposals.description'),
            icon: 'material-symbols:fact-check-outline',
            section: 'manage',
            keywords: searchKeywords(t, 'nav.place.manageProposals.keywords', ['proposal', 'proposals', 'generation', 'solver', 'review', 'apply', 'pending']),
            /*
             * ONE permission, unlike its sibling `/schedule`: this page and the
             * review screen are gated on `generation.read` alone, matching
             * `GET /api/generations`, and their reference fetches are individually
             * TOLERANT. What matters is that the LINK and the ROUTE agree.
             *
             * It was `session.read`, which is how "anybody who may look at a
             * timetable" came to be offered every solver proposal this tenant had
             * ever produced. A Generation is PROPOSED placements, not the applied
             * ones: a different data set, and now a different key.
             */
            permission: 'generation.read',
            to: '/schedule/proposals',
        },
        {
            id: 'my',
            label: t('nav.place.my.label'),
            description: t('nav.place.my.description'),
            icon: 'material-symbols:manage-accounts-outline',
            section: 'my',
            keywords: searchKeywords(t, 'nav.place.my.keywords', ['my', 'me', 'self', 'own', 'settings', 'availability', 'preferences']),
            /*
             * IN THE HEADER, gated on ANY of the section's own keys
             * (`MY_HUB_PERMISSIONS`), not one hardcoded permission. Without
             * this entry the section was unreachable by clicking: `ViewMenu`
             * renders only entries carrying `inHeader`, and its sub-pages
             * deliberately do not.
             *
             * ISSUE #108: this used to be the single literal
             * `'availability.manage_own'`, correct back when
             * `/my/availability` and `/my/preferences` were the whole
             * section and both needed it. `/my/exams` (`exam.request_own`)
             * and `/my/teaching-pattern` (`offering.set_scheduling_pattern`)
             * joined later without this entry changing, so a lecturer holding
             * only one of THOSE two keys never saw "My settings" in the
             * header at all: correctly gated pages, unreachable navigation.
             * `MY_HUB_PERMISSIONS` is the any-of set of every sub-page's key,
             * shared with `middleware/my.ts` so hub and pages cannot drift
             * apart again the same way.
             *
             * Unlike `manage`, this hub DOES name a permission: "may use at
             * least one section" is expressible here because the section is
             * four pages, not an open-ended entity list.
             */
            permission: MY_HUB_PERMISSIONS,
            to: '/my',
            inHeader: true,
        },
        {
            id: 'my.availability',
            label: t('nav.place.myAvailability.label'),
            description: t('nav.place.myAvailability.description'),
            icon: 'material-symbols:event-busy-outline',
            section: 'my',
            keywords: searchKeywords(t, 'nav.place.myAvailability.keywords', ['availability', 'unavailable', 'veto', 'blackout', 'absence', 'busy', 'my']),
            /*
             * ONE permission, and deliberately not the six-permission shape
             * `/schedule` needs. Everything this page renders (the grid, the
             * block times, the person's own rows) travels in the response of
             * the single endpoint behind this key, precisely so the link cannot
             * lead somewhere that then 403s on a reference fetch. Read from
             * `MY_SECTION_PERMISSIONS`, the same map `middleware/my.ts` reads,
             * so this entry and the route guard cannot disagree.
             */
            permission: MY_SECTION_PERMISSIONS['/my/availability'],
            to: '/my/availability',
        },
        {
            id: 'my.exams',
            label: t('nav.place.myExams.label'),
            description: t('nav.place.myExams.description'),
            icon: 'material-symbols:history-edu-outline',
            section: 'my',
            keywords: searchKeywords(t, 'nav.place.myExams.keywords', ['exam', 'klausur', 'assessment', 'request', 'my']),
            /*
             * ONE key, and the page's OWN fetches now match it exactly
             * (issue #108): its own requests and `GET
             * /api/me/exam-requests/context` (offerings led, exam kinds,
             * grids, terms, calendar periods) are both gated on
             * `exam.request_own` alone, replacing four generic CRUD reads
             * that each needed a wider `<resource>.read` a lecturer holding
             * only this key would not have held. `exam.request_own` is the
             * section's authority ("may I ask for an exam"), and gating on
             * anything wider would hide the page from the people it is for.
             */
            permission: MY_SECTION_PERMISSIONS['/my/exams'],
            to: '/my/exams',
        },
        {
            id: 'my.preferences',
            label: t('nav.place.myPreferences.label'),
            description: t('nav.place.myPreferences.description'),
            icon: 'material-symbols:favorite-outline',
            section: 'my',
            keywords: searchKeywords(t, 'nav.place.myPreferences.keywords', ['preference', 'preferred', 'mornings', 'days', 'teaching', 'my']),
            permission: MY_SECTION_PERMISSIONS['/my/preferences'],
            to: '/my/preferences',
        },
        {
            id: 'my.teaching-pattern',
            label: t('nav.place.myTeachingPattern.label'),
            description: t('nav.place.myTeachingPattern.description'),
            icon: 'material-symbols:calendar-view-week-outline',
            section: 'my',
            keywords: searchKeywords(t, 'nav.place.myTeachingPattern.keywords', ['pattern', 'block', 'distributed', 'spread', 'module', 'offering', 'teaching', 'my']),
            /*
             * Same shape as `my.exams`: one key names the section's authority
             * ("may I set my own module's pattern"), and the page's other
             * fetch (the list of modules to choose from) is scoped to the
             * SAME key server-side (`GET /api/me/offerings`), so there is no
             * wider permission for this gate to under-name. Read from
             * `MY_SECTION_PERMISSIONS`, matching `middleware/my.ts`.
             */
            permission: MY_SECTION_PERMISSIONS['/my/teaching-pattern'],
            to: '/my/teaching-pattern',
        },
        {
            id: 'my.account',
            label: t('nav.place.myAccount.label'),
            description: t('nav.place.myAccount.description'),
            icon: 'material-symbols:translate',
            section: 'my',
            keywords: searchKeywords(t, 'nav.place.myAccount.keywords', ['locale', 'language', 'date', 'format', 'account', 'my']),
            // Deliberately NO permission: anyone signed in may set their own
            // locale, unlike every other `/my` entry which needs
            // `availability.manage_own`. Reachability still inherits the hub's
            // own gate (the `my` entry above) until that is revisited on its
            // own terms; not this card's fix to make.
            to: '/my/account',
        },
        {
            /*
             * MOVED from `/manage/external-references` (issue #115), and now
             * permission-gated where it previously carried none; see
             * `ics_link.generate_own`/`ics_link.generate`'s own comments in
             * shared/permissions.ts for why. Self-service over the caller's
             * own data (or, with the wider key, over Groups they may target),
             * never institution data, so `section: 'my'` alongside
             * availability/exams/preferences is the right home. It was
             * filed under Management only because it started out
             * permission-less and self-service pages had nowhere else to go.
             */
            id: 'my.calendar-links',
            label: t('nav.place.myCalendarLinks.label'),
            description: t('nav.place.myCalendarLinks.description'),
            icon: 'material-symbols:link',
            section: 'my',
            keywords: searchKeywords(t, 'nav.place.myCalendarLinks.keywords', ['ics', 'ical', 'calendar', 'subscribe', 'feed', 'export', 'link', 'external']),
            permission: MY_SECTION_PERMISSIONS['/my/calendar-links'],
            to: '/my/calendar-links',
        },

        {
            /*
             * SPLIT OUT of `/my/account` (which hosted both panels under its
             * locale form), so the two things a script author comes here for
             * are reachable without knowing they sit at the bottom of a
             * settings page. Grouped with the export below under
             * `nav.group.accessData`.
             */
            id: 'my.api-tokens',
            label: t('nav.place.myApiTokens.label'),
            description: t('nav.place.myApiTokens.description'),
            icon: 'material-symbols:key-outline',
            section: 'my',
            keywords: searchKeywords(t, 'nav.place.myApiTokens.keywords', ['api', 'token', 'script', 'automation', 'bearer', 'integration', 'key']),
            /*
             * `api_token.manage_own`, read from `MY_SECTION_PERMISSIONS` so
             * this entry and `middleware/my.ts` cannot disagree. It carried NO
             * permission until that key existed, on the reasoning
             * `/my/account` still uses: a token is the caller's own authority
             * delegated and NARROWED, never a new grant. Still true; the
             * institution now gets to decide who may automate at all, which is
             * a policy about the credential rather than about the permissions
             * inside it.
             *
             * ONE KEY names the whole section's authority, and the page's own
             * fetches need nothing wider: all three token routes are gated on
             * exactly it, and the minting form reads the caller's permissions
             * from the session, not from `/api/persons`.
             */
            permission: MY_SECTION_PERMISSIONS['/my/api-tokens'],
            to: '/my/api-tokens',
        },
        {
            id: 'my.data-export',
            label: t('nav.place.myDataExport.label'),
            description: t('nav.place.myDataExport.description'),
            icon: 'material-symbols:download',
            section: 'my',
            keywords: searchKeywords(t, 'nav.place.myDataExport.keywords', ['export', 'download', 'gdpr', 'data', 'copy', 'subject access', 'my data']),
            // No permission: this exports the caller's OWN row and nobody
            // else's. The tenant-wide export is a different capability behind
            // `tenant.export` at `/manage/data-export`.
            to: '/my/data-export',
        },

        ...manageEntries(t),

        {
            id: 'manage.display',
            label: t('nav.place.manageDisplay.label'),
            description: t('nav.place.manageDisplay.description'),
            icon: 'material-symbols:palette-outline',
            section: 'manage',
            keywords: searchKeywords(t, 'nav.place.manageDisplay.keywords', ['display', 'colour', 'color', 'theme', 'highlight', 'online', 'appearance', 'palette']),
            /*
             * `tenant.read`, and NOT the endpoint's own gate.
             *
             * This entry used to be `session.read` on the reasoning that the page
             * explains why your schedule looks the way it does, which put an
             * institution's settings in the navigation of everybody who can see a
             * timetable, next to Proposals, which had the same problem. Settings
             * are the institution's, so the key is the institution's.
             *
             * `GET /api/display-settings` still accepts `session.read` as well,
             * deliberately: the schedule needs the COLOURS to draw. The endpoint
             * being wider than the link is the point, not an oversight; see that
             * route's own note.
             */
            permission: 'tenant.read',
            to: '/manage/display',
        },
        {
            id: 'manage.access-defaults',
            label: t('nav.place.manageAccessDefaults.label'),
            description: t('nav.place.manageAccessDefaults.description'),
            icon: 'material-symbols:admin-panel-settings-outline',
            section: 'manage',
            keywords: searchKeywords(t, 'nav.place.manageAccessDefaults.keywords', ['access', 'role', 'default', 'permission', 'grant', 'auto', 'member']),
            // Same `tenant.read`-to-look pairing `manage.display` uses, for the
            // same reason: this is the institution's setting, so the nav gate
            // is the institution's permission, not the wider write gate the
            // page itself additionally requires (`tenant.update` AND
            // `person_access_role.assign`; see `/api/auth-settings`).
            permission: 'tenant.read',
            to: '/manage/access-defaults',
        },
        {
            id: 'manage.data-export',
            label: t('nav.place.manageDataExport.label'),
            description: t('nav.place.manageDataExport.description'),
            icon: 'material-symbols:download',
            section: 'manage',
            keywords: searchKeywords(t, 'nav.place.manageDataExport.keywords', ['export', 'download', 'gdpr', 'data', 'backup', 'right to access', 'portability']),
            // The page's own gate, unlike `manage.display`/`manage.access-defaults`
            // above: there is no wider "look" permission this splits from; reading
            // and downloading are the same action here.
            permission: 'tenant.export',
            to: '/manage/data-export',
        },
        {
            id: 'manage.curriculum-progression',
            label: t('nav.place.manageCurriculumProgression.label'),
            description: t('nav.place.manageCurriculumProgression.description'),
            icon: 'material-symbols:trending-up',
            section: 'manage',
            keywords: searchKeywords(t, 'nav.place.manageCurriculumProgression.keywords', ['phase', 'progression', 'advance', 'curriculum', 'plan', 'semester', 'promote', 'cohort']),
            // The same key `ManageGroupApplyPlan.vue`'s single-Group "Advance"
            // button already needs. This is the bulk form of the identical
            // action, so it needs no wider authority than that one does.
            permission: 'offering_plan.apply',
            to: '/manage/curriculum-progression',
        },
        {
            id: 'manage.exam-reviews',
            label: t('nav.place.manageExamReviews.label'),
            description: t('nav.place.manageExamReviews.description'),
            icon: 'material-symbols:history-edu-outline',
            section: 'manage',
            keywords: searchKeywords(t, 'nav.place.manageExamReviews.keywords', ['exam', 'klausur', 'review', 'approve', 'reject', 'pending', 'assessment']),
            /*
             * `exam.review` and not `exam.request_own`. A page whose only
             * actions are approve and reject is not worth offering to somebody
             * who can do neither; the same reasoning the unavailability review
             * entry below gives for gating on the narrower key.
             */
            permission: 'exam.review',
            to: '/manage/exams/reviews',
        },
        {
            id: 'manage.availability-reviews',
            label: t('nav.place.manageAvailabilityReviews.label'),
            description: t('nav.place.manageAvailabilityReviews.description'),
            icon: 'material-symbols:fact-check-outline',
            section: 'manage',
            keywords: searchKeywords(t, 'nav.place.manageAvailabilityReviews.keywords', ['review', 'approve', 'reject', 'pending', 'veto', 'unavailability', 'blackout']),
            /*
             * Read needs either administration key; DECIDING needs manage_any.
             * The nav gates on the narrower one because a page whose only
             * actions are approve and reject is not worth offering to somebody
             * who can do neither. The overview below is where `read_any`
             * belongs.
             */
            permission: 'availability.manage_any',
            to: '/manage/availability/reviews',
        },
        {
            id: 'manage.availability-preferences',
            label: t('nav.place.manageAvailabilityPreferences.label'),
            description: t('nav.place.manageAvailabilityPreferences.description'),
            icon: 'material-symbols:groups-outline',
            section: 'manage',
            keywords: searchKeywords(t, 'nav.place.manageAvailabilityPreferences.keywords', ['preferences', 'preferred days', 'mornings', 'staff', 'lecturer']),
            /*
             * `read_any` is enough to reach this page: viewing who prefers what
             * without being able to change it is the whole reason that key
             * exists as its own grant rather than being implied by manage_any.
             * The page itself renders read-only without manage_any.
             */
            permission: 'availability.read_any',
            to: '/manage/availability/preferences',
        },
    ];
}

/**
 * Whether an entry belongs in `CommonAppShell`'s sidebar, permissions aside.
 *
 * Used by BOTH `useAppSections()` (`~/composables/navigation`) and
 * `tests/nav-groups.test.ts`, so the set the sidebar renders and the set the
 * test demands `NAV_GROUPS` classify are the same set by construction. Written
 * out at two call sites, they could agree today and disagree after the next
 * entry.
 */
export function isSidebarPlace(entry: NavEntry): boolean {
    return Boolean(entry.to) && entry.id !== 'home' && entry.section !== 'account';
}
