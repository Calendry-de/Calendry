/**
 * The two route constants more than one file needs to agree on.
 *
 * `/` is the PUBLIC landing page, so "where does a signed-in session belong"
 * stopped being answerable by writing `'/'`, and it was written in four places:
 * the route guard's two redirect fallbacks, its no-redirect-query special case,
 * and the login page's destination resolver. Four literals that must move
 * together is how a redirect ends up pointing at a marketing page.
 */

/** Where signing in lands, and what a protected page redirects back to. */
export const HOME_ROUTE = '/dashboard';

/**
 * Issue #107. `/dashboard` is no longer reachable unconditionally: it needs
 * `dashboard.view` (shared/permissions.ts). A caller who lacks it (the
 * `member` AccessRole, or any tenant's own AccessRole shaped the same way:
 * exactly `session.read_own`) belongs at `/schedule` instead, which is the
 * whole of what such a caller may see.
 *
 * The single place that decision is made, so the route guard and the login
 * page's destination resolver cannot disagree about it, same reasoning as
 * `HOME_ROUTE` itself. `HOME_ROUTE` stays a bare constant for call sites that
 * are not deciding a destination (see `auth.global.ts`'s `to.fullPath ===
 * HOME_ROUTE` check, which only avoids double-decorating a redirect query).
 */
export function resolveHomeRoute(permissions: readonly string[]): string {
    return permissions.includes('dashboard.view') ? HOME_ROUTE : '/schedule';
}

/** The public landing page: the domain root, readable with no session. */
export const LANDING_ROUTE = '/';

/**
 * The public pricing page, reachable from the landing bar.
 *
 * Anonymous for exactly the reason `/` is: somebody deciding whether to start a
 * conversation has no account yet, and bouncing them to a login form is the end
 * of the conversation. Like `/`, it reads no session and calls no API, so a
 * signed-in visitor is not bounced off it either.
 */
export const PRICING_ROUTE = '/pricing';

/**
 * The lobby-display board. Authenticates with a device KEY in its own query
 * string, never a session cookie, so it is anonymous to the route guard and
 * gated by its data route instead.
 */
export const SCREEN_ROUTE = '/screen';

/**
 * Calendry staff's own area (issue #76): a StaffAccount session, not a
 * tenant Account one, so `auth.global.ts`'s tenant-session guard must treat
 * both routes below as anonymous (no tenant session needed, and nobody
 * signed into a TENANT is bounced away from them either). Each page checks
 * for its OWN staff session itself; see `app/pages/staff/index.vue`.
 */
export const STAFF_LOGIN_ROUTE = '/staff/login';
export const STAFF_ROUTE = '/staff';
/** Clears a forced or expired StaffAccount password (issue #106's other half). */
export const STAFF_CHANGE_PASSWORD_ROUTE = '/staff/change-password';

/**
 * Whether a `?redirect=` value is safe to navigate to: ONE definition, used by
 * both the route guard and the login page's destination resolver, so the two
 * cannot disagree about what counts as internal.
 *
 * Internal means one leading `/` followed by neither `/` nor `\`: `//host` is a
 * scheme-relative URL, and browsers normalise `\` to `/` in a Location header,
 * so `/\evil.com` is `//evil.com` in disguise.
 */
export function isInternalPath(path: string): boolean {
    return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}
