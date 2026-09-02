import type { ComputedRef } from 'vue';
import type { NavEntry } from '~/utils/navPlaces';
import { satisfiesPermissionRequirement } from '#shared/permissions';
import { isSidebarPlace, navPlaces } from '~/utils/navPlaces';
import { searchKeywords } from '~/utils/i18nKeywords';
import { useT } from '~/composables/i18n';
import { useThemeToggle } from '~/composables/layout';
import { logout, useSession } from '~/composables/session';

/**
 * The composable layer over the navigation registry: permission filtering,
 * active-route resolution, and the session ACTIONS (theme, switch institution,
 * sign out) that cannot be static data because they close over Nuxt refs.
 *
 * The destinations themselves are `navPlaces()` in `~/utils/navPlaces`, pure,
 * module-level, and therefore unit-testable. See that module's note.
 */
export interface ResolvedNavEntry extends NavEntry {
    active: boolean;
}

/**
 * Every entry, unfiltered. Must be called from setup: the account actions close
 * over refs (`useCookie`, `useRouter`) that need the Nuxt instance, so they are
 * resolved here rather than inside the click handler that eventually runs them.
 *
 * The places come from `navPlaces()`; what is added here is exactly the
 * `account` section, which is the session-dependent part and the reason this
 * has to be a composable at all.
 *
 * `t` is resolved HERE, at setup, and handed to `navPlaces()` inside the
 * computed. `useT()` needs the Vue injection context, so calling it in the
 * getter (or in `navPlaces` itself) would throw; capturing it here also means
 * the computed re-evaluates on a language change, since vue-i18n's locale is
 * reactive and `t` reads it.
 */
export function useNavRegistry(): ComputedRef<NavEntry[]> {
    const session = useSession();
    const toggleTheme = useThemeToggle();
    const { t } = useT();

    return computed<NavEntry[]>(() => [
        ...navPlaces(t),

        {
            id: 'account.theme',
            label: t('nav.place.accountTheme.label'),
            description: t('nav.place.accountTheme.description'),
            icon: 'material-symbols:contrast',
            section: 'account',
            keywords: searchKeywords(t, 'nav.place.accountTheme.keywords', ['theme', 'dark', 'light', 'appearance', 'contrast']),
            run: toggleTheme,
        },
        ...((session.value?.availableTenants.length ?? 0) > 1
            ? [{
                id: 'account.switch-tenant',
                label: t('nav.place.accountSwitchTenant.label'),
                description: t('nav.place.accountSwitchTenant.description'),
                icon: 'material-symbols:swap-horiz',
                section: 'account' as const,
                keywords: searchKeywords(t, 'nav.place.accountSwitchTenant.keywords', ['switch', 'tenant', 'institution', 'school', 'university', 'change']),
                to: '/login?select=1',
            }]
            : []),
        {
            id: 'account.logout',
            label: t('nav.place.accountLogout.label'),
            description: t('nav.place.accountLogout.description'),
            icon: 'material-symbols:logout',
            section: 'account',
            keywords: searchKeywords(t, 'nav.place.accountLogout.keywords', ['sign out', 'logout', 'log off', 'exit', 'leave']),
            run: logout,
        },
    ]);
}

/**
 * The registry as this person may see it.
 *
 * Entries whose permission the caller lacks are REMOVED, not disabled. Every
 * consumer (header, sidebar, index, palette) reads this one function, so
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
             * all-of case and silently wrong for the any-of one: a nested array
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
 * (theme/switch-tenant/sign-out are actions, not places; `/dashboard`
 * renders those separately, and no other shell page has anywhere to put
 * them). Broader than `useManageSections()` on purpose: the sidebar is the
 * app's one persistent nav, not just the manage area's.
 */
export function useAppSections(): ComputedRef<ResolvedNavEntry[]> {
    const entries = useNavEntries();

    return computed(() => entries.value.filter(isSidebarPlace));
}
