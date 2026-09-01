import type { ComputedRef } from 'vue';
import type { PermissionRequirement } from '#shared/permissions';
import { satisfiesPermissionRequirement } from '#shared/permissions';
import { MANAGE_ENTITIES, entityPermission } from '~/utils/manageRegistry';
import { MY_HUB_PERMISSIONS, MY_SECTION_PERMISSIONS } from '~/utils/mySectionPermissions';
import { SCHEDULE_PERMISSIONS } from '~/utils/schedulePermissions';
import { useThemeToggle } from '~/composables/layout';
import { logout, useSession } from '~/composables/session';
import { HOME_ROUTE } from '~/utils/routes';

/**
 * The navigation registry — one typed list behind the header, `CommonAppShell`'s
 * sidebar (on `/dashboard` and every `/manage/*` page), and the Ctrl+K palette.
 * What places exist, what they are called, and who may see them; not fetching,
 * not the palette's open/close machine, not permissions themselves.
 *
 * The `manage.*` entries are PROJECTED from MANAGE_ENTITIES rather than retyped,
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
    /** Extra terms the fuzzy match should hit. Never shown. */
    keywords: string[];
    /**
     * Catalogue permission(s) required to see this entry at all. Absent means
     * "always visible" — used only for account actions, which are about the
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
     * The all-of form came first, from `/schedule` — which used to draw nothing
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

export interface ResolvedNavEntry extends NavEntry {
    active: boolean;
}

export const NAV_SECTION_LABELS: Record<NavSection, string> = {
    schedule: 'Schedule',
    my: 'My settings',
    manage: 'Manage',
    account: 'Account',
};

/** Manage-area entries, derived from the entity registry. One array, one truth. */
function manageEntries(): NavEntry[] {
    return MANAGE_ENTITIES.map((entity) => ({
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
 * Every entry, unfiltered. Must be called from setup: the account actions close
 * over refs (`useCookie`, `useRouter`) that need the Nuxt instance, so they are
 * resolved here rather than inside the click handler that eventually runs them.
 */
export function useNavRegistry(): ComputedRef<NavEntry[]> {
    const session = useSession();
    const toggleTheme = useThemeToggle();

    return computed<NavEntry[]>(() => [
        {
            id: 'home',
            label: 'Home',
            description: 'Session overview.',
            icon: 'material-symbols:other-houses-outline',
            section: 'schedule',
            // Not 'landing': `/` is the PUBLIC landing page and this entry is
            // the signed-in home, so that keyword would send a Ctrl+K search
            // for the marketing page to the dashboard instead.
            keywords: ['home', 'start', 'dashboard', 'overview'],
            // HOME_ROUTE, not the literal: it is the single definition of where
            // a signed-in session belongs, and this entry was the one place that
            // still spelled it out — so changing it would have moved the
            // post-login redirect while leaving the Home link pointing at the
            // old page.
            to: HOME_ROUTE,
            inHeader: true,
        },
        {
            id: 'schedule',
            label: 'Schedule',
            description: 'The week grid — see, select and move sessions.',
            icon: 'material-symbols:calendar-view-week-outline',
            section: 'schedule',
            keywords: ['schedule', 'timetable', 'grid', 'week', 'calendar', 'sessions'],
            /*
             * EITHER read key — see `schedulePermissions.ts`, which the route
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
            label: 'Proposals',
            description: 'Solver-produced schedules awaiting a decision.',
            icon: 'material-symbols:fact-check-outline',
            section: 'manage',
            keywords: ['proposal', 'proposals', 'generation', 'solver', 'review', 'apply', 'pending'],
            /*
             * ONE permission, unlike its sibling `/schedule`: this page and the
             * review screen are gated on `generation.read` alone, matching
             * `GET /api/generations`, and their reference fetches are individually
             * TOLERANT. What matters is that the LINK and the ROUTE agree.
             *
             * It was `session.read`, which is how "anybody who may look at a
             * timetable" came to be offered every solver proposal this tenant had
             * ever produced. A Generation is PROPOSED placements, not the applied
             * ones — a different data set, and now a different key.
             */
            permission: 'generation.read',
            to: '/schedule/proposals',
        },
        {
            id: 'my',
            label: 'My settings',
            description: 'Your own availability and teaching preferences.',
            icon: 'material-symbols:manage-accounts-outline',
            section: 'my',
            keywords: ['my', 'me', 'self', 'own', 'settings', 'availability', 'preferences'],
            /*
             * IN THE HEADER, gated on ANY of the section's own keys
             * (`MY_HUB_PERMISSIONS`) — not one hardcoded permission. Without
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
             * header at all — correctly gated pages, unreachable navigation.
             * `MY_HUB_PERMISSIONS` is the any-of set of every sub-page's key,
             * shared with `middleware/my.ts` so hub and pages cannot drift
             * apart again the same way.
             *
             * Unlike `manage`, this hub DOES name a permission — "may use at
             * least one section" is expressible here because the section is
             * four pages, not an open-ended entity list.
             */
            permission: MY_HUB_PERMISSIONS,
            to: '/my',
            inHeader: true,
        },
        {
            id: 'my.availability',
            label: 'My unavailability',
            description: 'Days and blocks you cannot teach. Submitted for approval.',
            icon: 'material-symbols:event-busy-outline',
            section: 'my',
            keywords: ['availability', 'unavailable', 'veto', 'blackout', 'absence', 'busy', 'my'],
            /*
             * ONE permission, and deliberately not the six-permission shape
             * `/schedule` needs. Everything this page renders — the grid, the
             * block times, the person's own rows — travels in the response of
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
            label: 'My exams',
            description: 'Ask for an exam on a module you lead. Reviewed before it is placed.',
            icon: 'material-symbols:history-edu-outline',
            section: 'my',
            keywords: ['exam', 'klausur', 'assessment', 'request', 'my'],
            /*
             * ONE key, and the page's OWN fetches now match it exactly
             * (issue #108): its own requests and `GET
             * /api/me/exam-requests/context` (offerings led, exam kinds,
             * grids, terms, calendar periods) are both gated on
             * `exam.request_own` alone — replacing four generic CRUD reads
             * that each needed a wider `<resource>.read` a lecturer holding
             * only this key would not have held. `exam.request_own` is the
             * section's authority — "may I ask for an exam" — and gating on
             * anything wider would hide the page from the people it is for.
             */
            permission: MY_SECTION_PERMISSIONS['/my/exams'],
            to: '/my/exams',
        },
        {
            id: 'my.preferences',
            label: 'My teaching preferences',
            description: 'Days and times you would rather teach. Recorded, not yet used by the scheduler.',
            icon: 'material-symbols:favorite-outline',
            section: 'my',
            keywords: ['preference', 'preferred', 'mornings', 'days', 'teaching', 'my'],
            permission: MY_SECTION_PERMISSIONS['/my/preferences'],
            to: '/my/preferences',
        },
        {
            id: 'my.teaching-pattern',
            label: 'My teaching pattern',
            description: 'How each module you lead is placed — spread across the term, or kept together.',
            icon: 'material-symbols:calendar-view-week-outline',
            section: 'my',
            keywords: ['pattern', 'block', 'distributed', 'spread', 'module', 'offering', 'teaching', 'my'],
            /*
             * Same shape as `my.exams`: one key names the section's authority
             * ("may I set my own module's pattern"), and the page's other
             * fetch — the list of modules to choose from — is scoped to the
             * SAME key server-side (`GET /api/me/offerings`), so there is no
             * wider permission for this gate to under-name. Read from
             * `MY_SECTION_PERMISSIONS`, matching `middleware/my.ts`.
             */
            permission: MY_SECTION_PERMISSIONS['/my/teaching-pattern'],
            to: '/my/teaching-pattern',
        },
        {
            id: 'my.account',
            label: 'My account',
            description: 'Your own display locale — dates and numbers, not UI language.',
            icon: 'material-symbols:translate',
            section: 'my',
            keywords: ['locale', 'language', 'date', 'format', 'account', 'my'],
            // Deliberately NO permission — anyone signed in may set their own
            // locale, unlike every other `/my` entry which needs
            // `availability.manage_own`. Reachability still inherits the hub's
            // own gate (the `my` entry above) until that is revisited on its
            // own terms; not this card's fix to make.
            to: '/my/account',
        },
        {
            /*
             * MOVED from `/manage/external-references` (issue #115), and now
             * permission-gated where it previously carried none — see
             * `ics_link.generate_own`/`ics_link.generate`'s own comments in
             * shared/permissions.ts for why. Self-service over the caller's
             * own data (or, with the wider key, over Groups they may target),
             * never institution data, so `section: 'my'` alongside
             * availability/exams/preferences is the right home — it was
             * filed under Management only because it started out
             * permission-less and self-service pages had nowhere else to go.
             */
            id: 'my.calendar-links',
            label: 'Calendar links',
            description: 'Subscribe an external calendar app to your schedule, or a Group\'s.',
            icon: 'material-symbols:link',
            section: 'my',
            keywords: ['ics', 'ical', 'calendar', 'subscribe', 'feed', 'export', 'link', 'external'],
            permission: MY_SECTION_PERMISSIONS['/my/calendar-links'],
            to: '/my/calendar-links',
        },

        ...manageEntries(),

        {
            id: 'manage.display',
            label: 'Display',
            description: 'How the schedule is drawn — colour sources, online marking, fallbacks.',
            icon: 'material-symbols:palette-outline',
            section: 'manage',
            keywords: ['display', 'colour', 'color', 'theme', 'highlight', 'online', 'appearance', 'palette'],
            /*
             * `tenant.read`, and NOT the endpoint's own gate.
             *
             * This entry used to be `session.read` on the reasoning that the page
             * explains why your schedule looks the way it does — which put an
             * institution's settings in the navigation of everybody who can see a
             * timetable, next to Proposals, which had the same problem. Settings
             * are the institution's, so the key is the institution's.
             *
             * `GET /api/display-settings` still accepts `session.read` as well,
             * deliberately: the schedule needs the COLOURS to draw. The endpoint
             * being wider than the link is the point, not an oversight — see that
             * route's own note.
             */
            permission: 'tenant.read',
            to: '/manage/display',
        },
        {
            id: 'manage.access-defaults',
            label: 'Access defaults',
            description: 'Whether a newly created Person is granted an access role automatically.',
            icon: 'material-symbols:admin-panel-settings-outline',
            section: 'manage',
            keywords: ['access', 'role', 'default', 'permission', 'grant', 'auto', 'member'],
            // Same `tenant.read`-to-look pairing `manage.display` uses, for the
            // same reason: this is the institution's setting, so the nav gate
            // is the institution's permission, not the wider write gate the
            // page itself additionally requires (`tenant.update` AND
            // `person_access_role.assign` — see `/api/auth-settings`).
            permission: 'tenant.read',
            to: '/manage/access-defaults',
        },
        {
            id: 'manage.curriculum-progression',
            label: 'Curriculum progression',
            description: 'Which curriculum plan each group is on, and advancing every eligible one at once.',
            icon: 'material-symbols:trending-up',
            section: 'manage',
            keywords: ['phase', 'progression', 'advance', 'curriculum', 'plan', 'semester', 'promote', 'cohort'],
            // The same key `ManageGroupApplyPlan.vue`'s single-Group "Advance"
            // button already needs — this is the bulk form of the identical
            // action, so it needs no wider authority than that one does.
            permission: 'offering_plan.apply',
            to: '/manage/curriculum-progression',
        },
        {
            id: 'manage.exam-reviews',
            label: 'Exam review',
            description: 'Approve or reject exams lecturers have asked for on their own modules.',
            icon: 'material-symbols:history-edu-outline',
            section: 'manage',
            keywords: ['exam', 'klausur', 'review', 'approve', 'reject', 'pending', 'assessment'],
            /*
             * `exam.review` and not `exam.request_own`. A page whose only
             * actions are approve and reject is not worth offering to somebody
             * who can do neither — the same reasoning the unavailability review
             * entry below gives for gating on the narrower key.
             */
            permission: 'exam.review',
            to: '/manage/exams/reviews',
        },
        {
            id: 'manage.availability-reviews',
            label: 'Unavailability review',
            description: 'Approve or reject unavailability people have declared for themselves.',
            icon: 'material-symbols:fact-check-outline',
            section: 'manage',
            keywords: ['review', 'approve', 'reject', 'pending', 'veto', 'unavailability', 'blackout'],
            /*
             * Read needs either administration key; DECIDING needs manage_any.
             * The nav gates on the narrower one because a page whose only
             * actions are approve and reject is not worth offering to somebody
             * who can do neither — the overview below is where `read_any`
             * belongs.
             */
            permission: 'availability.manage_any',
            to: '/manage/availability/reviews',
        },
        {
            id: 'manage.availability-preferences',
            label: 'Teaching preferences',
            description: 'View and set anyone\u2019s preferred days and blocks.',
            icon: 'material-symbols:groups-outline',
            section: 'manage',
            keywords: ['preferences', 'preferred days', 'mornings', 'staff', 'lecturer'],
            /*
             * `read_any` is enough to reach this page — viewing who prefers what
             * without being able to change it is the whole reason that key
             * exists as its own grant rather than being implied by manage_any.
             * The page itself renders read-only without manage_any.
             */
            permission: 'availability.read_any',
            to: '/manage/availability/preferences',
        },

        {
            id: 'account.theme',
            label: 'Toggle theme',
            description: 'Switch between the light and dark ground.',
            icon: 'material-symbols:contrast',
            section: 'account',
            keywords: ['theme', 'dark', 'light', 'appearance', 'contrast'],
            run: toggleTheme,
        },
        ...((session.value?.availableTenants.length ?? 0) > 1
            ? [{
                id: 'account.switch-tenant',
                label: 'Switch institution',
                description: 'Move to another tenant you belong to.',
                icon: 'material-symbols:swap-horiz',
                section: 'account' as const,
                keywords: ['switch', 'tenant', 'institution', 'school', 'university', 'change'],
                to: '/login?select=1',
            }]
            : []),
        {
            id: 'account.logout',
            label: 'Sign out',
            description: 'End this session.',
            icon: 'material-symbols:logout',
            section: 'account',
            keywords: ['sign out', 'logout', 'log off', 'exit', 'leave'],
            run: logout,
        },
    ]);
}

/**
 * The registry as this person may see it.
 *
 * Entries whose permission the caller lacks are REMOVED, not disabled. Every
 * consumer — header, sidebar, index, palette — reads this one function, so
 * there is no second place to forget the filter. That is what makes "Ctrl+K
 * never surfaces something you cannot open" structural rather than a promise.
 */
export function useNavEntries(): ComputedRef<ResolvedNavEntry[]> {
    const registry = useNavRegistry();
    const session = useSession();
    const route = useRoute();

    return computed(() => {
        const held = new Set(session.value?.permissions ?? []);
        const visible = registry.value.filter((entry) => {
            if (!entry.permission) {
                return true;
            }

            /*
             * One evaluator, shared with the server and with the manage
             * relations' gates. A local `.every()` was the same rule for the
             * all-of case and silently wrong for the any-of one — a nested array
             * is truthy, so `held.has([...])` would have been `false` for
             * everybody and hidden the schedule from the whole institution.
             */
            return satisfiesPermissionRequirement(
                held,
                typeof entry.permission === 'string' ? [entry.permission] : entry.permission,
            );
        });

        return visible.map((entry) => ({
            ...entry,
            active: Boolean(entry.to) && isActiveRoute(entry.to as string, route.path),
        }));
    });
}

/**
 * A section is active for its own path and everything beneath it, so
 * /manage/rooms/new keeps "Rooms" lit. Anchored on a segment boundary: a
 * prefix test alone would light /manage/rooms for /manage/rooms-archive.
 */
function isActiveRoute(to: string, current: string): boolean {
    const path = to.split('?')[0] as string;

    if (path === '/') {
        return current === '/';
    }

    return current === path || current.startsWith(`${path}/`);
}

/** Top-level header items. */
export function useHeaderNav(): ComputedRef<ResolvedNavEntry[]> {
    const entries = useNavEntries();

    return computed(() => entries.value.filter((entry) => entry.inHeader));
}

/** The dashboard's manage-entities overview cards: entity sections only. */
export function useManageSections(): ComputedRef<ResolvedNavEntry[]> {
    const entries = useNavEntries();

    return computed(() => entries.value.filter((entry) => entry.id.startsWith('manage.')));
}

/** True when the caller may read at least one managed entity. */
export function useCanManageAnything(): ComputedRef<boolean> {
    const sections = useManageSections();

    return computed(() => sections.value.length > 0);
}

/**
 * `CommonAppShell`'s sidebar source: every reachable destination except
 * 'home' (linking a page to itself is noise) and the 'account' section
 * (theme/switch-tenant/sign-out are actions, not places — `/dashboard`
 * renders those separately, and no other shell page has anywhere to put
 * them). Broader than `useManageSections()` on purpose: the sidebar is the
 * app's one persistent nav, not just the manage area's.
 */
export function useAppSections(): ComputedRef<ResolvedNavEntry[]> {
    const entries = useNavEntries();

    return computed(() => entries.value.filter(
        (entry) => entry.to && entry.id !== 'home' && entry.section !== 'account',
    ));
}
