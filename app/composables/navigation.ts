import type { ComputedRef } from 'vue';
import { MANAGE_ENTITIES, entityPermission } from '~/utils/manageRegistry';
import { SCHEDULE_PERMISSIONS } from '~/utils/schedulePermissions';
import { useThemeToggle } from '~/composables/layout';
import { logout, useSession } from '~/composables/session';

/**
 * The navigation registry — one typed list behind the header, the /manage
 * sidebar, the /manage index and the Ctrl+K palette.
 *
 * OWNERSHIP BOUNDARY: what places exist, what they are called, and who may see
 * them. Not fetching, not the palette's open/close machine (that is
 * `useCommandPalette`), not permissions themselves (that is the server).
 *
 * The `manage.*` entries are PROJECTED from MANAGE_ENTITIES rather than
 * retyped. That is the whole reason the sidebar and the palette cannot drift:
 * there is one array, rendered three ways.
 *
 * This file replaced the template's `useHeaderMenu`, which gated on
 * `store.me?.isAdmin` from the `WebUser` stub. That stub had no relationship to
 * the real auth model and is now deleted; gating runs on the permission
 * catalogue like everything else.
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
     * A LIST means ALL of them, not any: an entry needing several is hidden
     * unless the caller holds every one. `/schedule` is the case that forced
     * this — it draws nothing without six separate reads, and offering the link
     * on the strength of one of them led straight to a blank page.
     */
    permission?: string | readonly string[];
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
             * The page needs six permissions, not this one — see
             * `schedulePermissions.ts`. Gating the LINK on the same set stops
             * offering a destination that answers 403; the nav and the route
             * agree because they read one list.
             */
            permission: SCHEDULE_PERMISSIONS,
            to: '/schedule',
            inHeader: true,
        },
        {
            /*
             * IN THE MANAGE SECTION, though the route lives under /schedule.
             *
             * Section membership is decided by the id prefix — `useManageSections`
             * filters on `manage.` — so this entry appears in the /manage
             * sidebar, the /manage index and the palette, while `to` keeps the
             * path where it belongs: alongside the schedule routes, sharing
             * their `review` middleware. Same shape as
             * `manage.availability-reviews`, which is also a review queue rather
             * than a managed entity.
             *
             * Both menus render `entry.to` directly, so a manage-section entry
             * pointing outside /manage needs nothing special.
             */
            id: 'manage.proposals',
            label: 'Proposals',
            description: 'Solver-produced schedules awaiting a decision.',
            icon: 'material-symbols:fact-check-outline',
            section: 'manage',
            keywords: ['proposal', 'proposals', 'generation', 'solver', 'review', 'apply', 'pending'],
            /*
             * ONE permission, unlike its sibling `/schedule`.
             *
             * This page and the review screen it leads to are gated on
             * `session.read` alone, matching `GET /api/generations`. Their
             * reference fetches are individually TOLERANT — a caller who cannot
             * read terms sees "Term unknown" rather than a refusal — so the
             * six-permission schedule gate would deny people the data allows.
             * The rule that matters is that the LINK and the ROUTE agree, and
             * both name this key.
             */
            permission: 'session.read',
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
             * IN THE HEADER, and gated on the one permission both of its pages
             * need.
             *
             * Without this entry the whole section was unreachable by clicking:
             * `ViewMenu` renders `useHeaderNav()`, which is entries carrying
             * `inHeader`, and the two pages below deliberately do not carry it —
             * they are section contents, exactly as the manage entities are.
             * So the pages rendered, the middleware gated them correctly, and
             * every test passed while a lecturer had no way to get there short
             * of typing the URL or opening the palette.
             *
             * Unlike `manage`, this one DOES name a permission. That hub has
             * none because "may read at least one section" is not a single key
             * and has to be derived from the projected entries; here both pages
             * are behind `availability.manage_own`, so the hub is too, and
             * deriving it would be a rule with one input.
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
             * READ is `session.read`, and that is what gates the entry: the page
             * is meaningful to anyone who looks at a schedule, and it renders
             * read-only without `session_kind.update`. Gating the link on the
             * WRITE permission would hide from most people a page that explains
             * why their schedule looks the way it does.
             */
            permission: 'session.read',
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

            // ALL of them when it is a list — see the note on `permission`.
            return typeof entry.permission === 'string'
                ? held.has(entry.permission)
                : entry.permission.every((key) => held.has(key));
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
