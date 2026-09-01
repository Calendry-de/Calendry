import { resolveIdentity } from '../utils/tenantResolver';

/** Paths that must work without an established tenant identity. */
const PUBLIC_API_PATHS = [
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/session',
    '/api/auth/select-tenant',
    // Must be public: a forced reset issues no session, so requiring one here
    // would make the flag unclearable and lock the account out permanently.
    // The handler re-authenticates from the credentials in the body instead.
    '/api/auth/change-password',
    // The staff-plane equivalents of the two lines above — issue #76. A
    // staff login obviously has no cookie yet; a staff logout must still
    // clear one even if `resolveIdentity` cannot resolve it (an expired or
    // already-revoked token), exactly like `/api/auth/logout`.
    '/api/staff-auth/login',
    '/api/staff-auth/logout',
    // Same reasoning as '/api/auth/change-password' above, for the staff
    // plane — issue #106. A staff forced reset issues no staff session, so
    // requiring one here would make the flag unclearable.
    '/api/staff-auth/change-password',
    /*
     * The board is reachable without an ACCOUNT, never without identity. A
     * screen key resolves to a real `ScreenIdentity` through the resolver like
     * any other principal — this exemption only stops the middleware answering
     * 401 before the handler can say something more useful ("not recognised" vs
     * "deactivated"), which on a wall-mounted display is the difference between
     * a fixable message and an apparently dead screen.
     *
     * The handler itself calls `requireIdentity`, so a request with no key and
     * no cookie still gets 401 — one line further down.
     */
    '/api/screens/board',
    /*
     * The ics_link stream is reachable with no cookie for the same reason the
     * board is: the `token` query parameter IS its credential, verified by
     * the handler itself via `icsLinkResolver` — deliberately NOT through
     * this middleware's `activeResolver`, which excludes it on purpose (see
     * `IcsLinkIdentity`'s comment in tenantResolver.ts). Listing it here only
     * stops this middleware answering a bare 401 before the handler can name
     * the actual reason.
     */
    '/api/ics/stream.ics',
];

/**
 * Attaches request identity to `event.context.identity` for /api routes.
 *
 * Authentication is enforced here for everything except the auth endpoints
 * themselves, which have to be reachable before a tenant exists on the session
 * (login) or when it never will (logout). Those four handle their own checks.
 *
 * Authorization is not done here — permissions are per-route and need an open
 * tenant transaction to read, so `requirePermission` runs inside the handler.
 */
export default defineEventHandler(async (event) => {
    const path = (event.path ?? '').split('?')[0] ?? '';

    if (!path.startsWith('/api/')) {
        return;
    }

    const identity = await resolveIdentity(event);

    if (identity) {
        event.context.identity = identity;

        return;
    }

    if (!PUBLIC_API_PATHS.includes(path)) {
        throw createError({ statusCode: 401, statusMessage: 'Authentication required.' });
    }
});
