import type { TenantMode } from '#shared/tenantMode';
import { DEFAULT_TENANT_MODE } from '#shared/tenantMode';

/**
 * Client-side view of the authenticated session.
 *
 * Mirrors GET /api/auth/session. This is UI state only — it decides what to
 * render, never what is allowed. Every route re-checks permissions server-side,
 * so tampering with anything here changes what the page looks like and nothing
 * else.
 */
export interface SessionTenant {
    tenantId: string;
    slug: string;
    name: string;
    personId: string;
    isActive: boolean;
}

export interface SessionState {
    accountId: string;
    tenantSelectionRequired: boolean;
    activeTenant: { id: string; slug: string; name: string } | null;
    activePersonId?: string;
    activePerson?: { id: string; givenName: string; familyName: string } | null;
    permissions: string[];
    availableTenants: SessionTenant[];
    /** Resolved server-side (issue #17) — see `shared/locale.ts`'s `resolveLocale`. */
    locale: string;
    /**
     * UI/UX bias only (issue #8) — see `shared/tenantMode.ts`. Never gates
     * what data may be stored; only which form fields and constraint types
     * a page leads with.
     */
    tenantMode: TenantMode;
}

/** The single generic message shown for every authentication failure. */
export const LOGIN_ERROR = 'Incorrect email or password.';

export const useSession = () => useState<SessionState | null>('calendry.session', () => null);

/** True once a fetch has been attempted, so "not loaded" and "no session" differ. */
const useSessionLoaded = () => useState<boolean>('calendry.session.loaded', () => false);

/**
 * Loads the session from the server.
 *
 * On SSR the browser's cookie has to be forwarded explicitly — $fetch does not
 * inherit it — otherwise the first render always looks logged out and the page
 * flashes the login screen before hydrating.
 */
export async function fetchSession(force = false): Promise<SessionState | null> {
    const session = useSession();
    const loaded = useSessionLoaded();

    if (loaded.value && !force) {
        return session.value;
    }

    try {
        const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined;

        session.value = await $fetch<SessionState>('/api/auth/session', { headers });
    } catch {
        // 401 is the expected answer for a signed-out visitor, not an error.
        session.value = null;
    }

    loaded.value = true;

    return session.value;
}

/** Authenticated AND situated in a tenant. Selection-pending does not count. */
export function isSignedIn(session: SessionState | null): boolean {
    return Boolean(session && !session.tenantSelectionRequired && session.activeTenant);
}

export function useIsSignedIn() {
    const session = useSession();

    return computed(() => isSignedIn(session.value));
}

/** Convenience for UI gating. Never a substitute for the server-side check. */
export function useHasPermission(permission: string) {
    const session = useSession();

    return computed(() => session.value?.permissions.includes(permission) ?? false);
}

/**
 * The active tenant's mode bias (issue #8), or the default for a signed-out
 * visitor or a tenant that never set one — same "absent means default" rule
 * every other reader of this setting follows.
 */
export function useTenantMode() {
    const session = useSession();

    return computed<TenantMode>(() => session.value?.tenantMode ?? DEFAULT_TENANT_MODE);
}

export async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' });

    useSession().value = null;
    useSessionLoaded().value = true;

    await navigateTo('/login');
}
