import type { ComputedRef } from 'vue';
import type { PermissionRequirement } from '#shared/permissions';
import { satisfiesPermissionRequirement } from '#shared/permissions';
import { MANAGE_ENTITIES, entityPermission } from '~/utils/manageRegistry';
import { SCHEDULE_PERMISSIONS } from '~/utils/schedulePermissions';
import { useThemeToggle } from '~/composables/layout';
import { logout, useSession } from '~/composables/session';

/**
 * The navigation registry — one typed list behind the header, the /manage sidebar,
 * the /manage index and the Ctrl+K palette. What places exist, what they are
 * called, and who may see them; not fetching, not the palette's open/close
 * machine, not permissions themselves.
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
            to: '/dashboard',
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
            id: 'manage',
            label: 'Manage',
            description: 'Configure the entities the timetable is built from.',
            icon: 'material-symbols:tune',
            section: 'manage',
            keywords: ['manage', 'admin', 'setup', 'configure', 'settings'],
            // No permission of its own: the index page is meaningful only if at
            // least one section is readable, which `useNavEntries` decides from
            // the projected entries rather than from a hardcoded guess.
            to: '/manage',
            inHeader: true,
        },

        {
            id: 'my',
            label: 'My settings',
            description: 'Your own availability and teaching preferences.',
            icon: 'material-symbols:manage-accounts-outline',
            section: 'my',
            keywords: ['my', 'me', 'self', 'own', 'settings', 'availability', 'preferences'],
            /*
             * IN THE HEADER, gated on the one permission both its pages need.
             * Without this entry the section was unreachable by clicking:
             * `ViewMenu` renders only entries carrying `inHeader`, and the two
             * pages deliberately do not. The pages rendered, the middleware gated
             * correctly, and every test passed while a lecturer had no way in.
             *
             * Unlike `manage`, this hub DOES name a permission — that one has none
             * because "may read at least one section" is not a single key.
             */
            permission: 'availability.manage_own',
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
             * lead somewhere that then 403s on a reference fetch.
             */
            permission: 'availability.manage_own',
            to: '/my/availability',
        },
        {
            id: 'my.preferences',
            label: 'My teaching preferences',
            description: 'Days and times you would rather teach. Recorded, not yet used by the scheduler.',
            icon: 'material-symbols:favorite-outline',
            section: 'my',
            keywords: ['preference', 'preferred', 'mornings', 'days', 'teaching', 'my'],
            permission: 'availability.manage_own',
            to: '/my/preferences',
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

        // The Manage index earns its place only if it leads somewhere. Showing a
        // hub whose every section is hidden is the "empty state that means
        // broken" failure in miniature.
        const hasManageSection = visible.some((entry) => entry.id.startsWith('manage.'));
        const shown = hasManageSection ? visible : visible.filter((entry) => entry.id !== 'manage');

        return shown.map((entry) => ({
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

/** The /manage sidebar and index: entity sections only, never the hub itself. */
export function useManageSections(): ComputedRef<ResolvedNavEntry[]> {
    const entries = useNavEntries();

    return computed(() => entries.value.filter((entry) => entry.id.startsWith('manage.')));
}

/** True when the caller may read at least one managed entity. */
export function useCanManageAnything(): ComputedRef<boolean> {
    const sections = useManageSections();

    return computed(() => sections.value.length > 0);
}
