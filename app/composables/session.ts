import type { MessageKey } from '~~/i18n/keys';
import type { TenantMode } from '#shared/tenantMode';
import { DEFAULT_TENANT_MODE } from '#shared/tenantMode';

/**
 * Client-side view of the authenticated session.
 *
 * Mirrors GET /api/auth/session. This is UI state only: it decides what to
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
    /** Null when this Tenant belongs to no Federation. */
    federationId: string | null;
}

export interface SessionState {
    accountId: string;
    tenantSelectionRequired: boolean;
    activeTenant: { id: string; slug: string; name: string } | null;
    activePersonId?: string;
    activePerson?: { id: string; givenName: string; familyName: string } | null;
    permissions: string[];
    availableTenants: SessionTenant[];
    /** Resolved server-side (issue #17); see `shared/locale.ts`'s `resolveLocale`. */
    locale: string;
    /**
     * UI/UX bias only (issue #8); see `shared/tenantMode.ts`. Never gates
     * what data may be stored; only which form fields and constraint types
     * a page leads with.
     */
    tenantMode: TenantMode;
}

/**
 * The single generic message shown for every authentication failure.
 *
 * A KEY rather than the sentence since issue #19, because this is module
 * scope: `t()` needs a Vue instance, so the string cannot be resolved here
 * and the two pages that show it (`login.vue`, `change-password.vue`) call
 * `t(LOGIN_ERROR_KEY)` at render instead. What the constant is FOR survives
 * the change unaltered: one name, so a wrong password and an unknown email
 * cannot drift into two distinguishable messages and turn the login form into
 * an account-enumeration oracle.
 */
export const LOGIN_ERROR_KEY = 'auth.error.credentials' as const satisfies MessageKey;

export const useSession = () => useState<SessionState | null>('calendry.session', () => null);

/** True once a fetch has been attempted, so "not loaded" and "no session" differ. */
const useSessionLoaded = () => useState<boolean>('calendry.session.loaded', () => false);

/**
 * Loads the session from the server.
 *
 * On SSR the browser's cookie has to be forwarded explicitly, since $fetch does
 * not inherit it, otherwise the first render always looks logged out and the
 * page flashes the login screen before hydrating.
 *
 * `accept-language` IS FORWARDED FOR THE SAME REASON, and leaving it out was a
 * bug from issue #17 that issue #19 made visible. `session.get.ts` reads that
 * header as the last tier of `resolveLocale()` (Person, then Tenant, then the
 * browser's own preference), and a header this call does not forward is a
 * header that endpoint cannot see: it fell through to `FALLBACK_LOCALE` for
 * every signed-in viewer whose Person and Tenant both stated no locale, which
 * is the default state of every account.
 *
 * It was nearly undetectable while the fallback was `en-GB` and the only
 * consequence was date shape, and it was never merely cosmetic: on the CLIENT
 * the browser attaches `Accept-Language` to this same request automatically,
 * so SSR resolved one locale and hydration resolved another, which is the
 * mismatch class this codebase has been bitten by repeatedly. Issue #19 turned
 * it into a whole page rendering in the wrong LANGUAGE on the server and the
 * right one on the client. Forwarding it makes both sides ask the identical
 * question.
 */
export async function fetchSession(force = false): Promise<SessionState | null> {
    const session = useSession();
    const loaded = useSessionLoaded();

    if (loaded.value && !force) {
        return session.value;
    }

    try {
        const headers = import.meta.server ? useRequestHeaders(['cookie', 'accept-language']) : undefined;

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
 * visitor or a tenant that never set one, the same "absent means default" rule
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
