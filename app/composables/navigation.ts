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
export type NavSection = 'schedule' | 'manage' | 'account';

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
            keywords: ['home', 'start', 'landing'],
            to: '/',
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

        ...manageEntries(),

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
