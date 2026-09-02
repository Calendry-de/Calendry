import { generateSessionToken } from '../utils/auth';
import { CSRF_COOKIE, CSRF_HEADER } from '#shared/csrf';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Paths exempt from the token check below.
 *
 * `/api/auth/login` (and its staff-plane counterpart, `/api/staff-auth/login`):
 * the CSRF cookie is set unconditionally on every response (this same
 * middleware, step 1), so any real browser that has rendered so much as one
 * page before submitting the login form already carries it. Exempted anyway,
 * rather than relying on that: login is the one state-changing route a client
 * can legitimately reach as its very first request of a browsing session (a
 * bookmarked/shared deep link straight to a login form that POSTs without a
 * prior same-origin GET isn't something this app controls), and unlike every
 * other route here, a false rejection has no retry path worth the name: the
 * caller isn't authenticated yet, so there is no session to fall back to.
 *
 * `/api/auth/change-password` and `/api/staff-auth/change-password` are the
 * SAME shape, for the SAME reason: both are "public by necessity" (their own
 * route comments): a forced or expired password issues NO session, so the
 * only way out is re-authenticating from credentials in the body, exactly
 * like login. A caller here may have no prior same-origin request at all
 * (`login.vue`'s own `navigateTo('/change-password?forced=1...')` is a
 * same-session SPA navigation and would carry the cookie, but nothing stops a
 * bookmarked/shared link to this page either, same as login's own argument).
 * This gap shipped un-exempted and broke every test exercising a forced/
 * expired password change with a 403 that had nothing to do with credentials,
 * found via the integration suite, not by inspection.
 *
 * The exemption lives here, at the path level, rather than inside each
 * route file, matching login's own precedent above.
 */
const EXEMPT_PATHS = [
    '/api/auth/login',
    '/api/auth/change-password',
    '/api/staff-auth/login',
    '/api/staff-auth/change-password',
];

/**
 * Double-submit cookie CSRF protection, defense-in-depth alongside the
 * session cookie's `sameSite: 'lax'` (`login.post.ts`): lax blocks the main
 * cross-site POST vector in current browsers but isn't a complete answer on
 * its own (older browsers, subdomain-scoped attacks).
 *
 * 1. Every response gets a CSRF cookie if it doesn't already have one,
 *    readable by JS (NOT httpOnly: the client has to read it back), so this
 *    runs unconditionally, before the method/path checks below, and applies
 *    to every request including a plain page GET. That is what makes it
 *    idempotent and what guarantees the cookie exists by the time any
 *    same-site client makes its first state-changing call.
 * 2. Every state-changing `/api/*` request must echo the cookie's value back
 *    in the `x-csrf-token` header. A cross-site page can make a victim's
 *    browser attach the cookie automatically (that's the attack), but
 *    same-origin policy stops it from ever reading the cookie's value to put
 *    in the header.
 *
 * This only defends session-cookie auth. `Authorization: Bearer <token>`
 * requests (`apiTokenResolver` in `tenantResolver.ts`) aren't vulnerable the
 * same way: there's no way for a cross-site page to make a victim's browser
 * attach an Authorization header, so they're exempt from the token check
 * (they still get the cookie set, harmlessly, like anything else).
 */
export default defineEventHandler((event) => {
    if (!getCookie(event, CSRF_COOKIE)) {
        setCookie(event, CSRF_COOKIE, generateSessionToken(), {
            httpOnly: false,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
        });
    }

    const method = getMethod(event);

    if (!STATE_CHANGING_METHODS.has(method)) {
        return;
    }

    const path = (event.path ?? '').split('?')[0] ?? '';

    if (!path.startsWith('/api/') || EXEMPT_PATHS.includes(path)) {
        return;
    }

    const authHeader = getRequestHeader(event, 'authorization');

    if (authHeader?.startsWith('Bearer ')) {
        return;
    }

    const cookieToken = getCookie(event, CSRF_COOKIE);
    const headerToken = getRequestHeader(event, CSRF_HEADER);

    if (!cookieToken || !headerToken || headerToken !== cookieToken) {
        throw createError({ statusCode: 403, statusMessage: 'Missing or invalid CSRF token.' });
    }
});
