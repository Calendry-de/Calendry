import { fetchSession, isSignedIn, useSession } from '~/composables/session';
import { useStore } from '~/store';
import {
    HOME_ROUTE, LANDING_ROUTE, SCREEN_ROUTE, STAFF_LOGIN_ROUTE, STAFF_ROUTE, isInternalPath,
} from '~/utils/routes';

/**
 * Route guard: every page needs a session except the ones listed here.
 *
 * Deny-by-default. A new page is protected the moment it is created, rather
 * than protected only once someone remembers to add middleware to it — the
 * same reasoning as the server's fail-closed RLS.
 *
 * This is a convenience, not a security boundary. The API enforces
 * authentication and permissions independently; a user who defeats this
 * middleware reaches a page whose every request still returns 401.
 */
const PUBLIC_ROUTES = ['/login', '/change-password'];

/**
 * Pages that need no session AND care about nobody's.
 *
 * Distinct from PUBLIC_ROUTES, which are the AUTH pages: those bounce a
 * signed-in visitor into the app, because a sign-in form is meaningless once you
 * are signed in. The public landing page is not meaningless to a signed-in
 * visitor — bouncing someone off it because they happen to hold a cookie would
 * make the roadmap unreadable to the people most likely to want it.
 *
 * `/` is that page. The authenticated home is `/dashboard`, which is where
 * signing in lands and what a protected page redirects back to.
 *
 * `/screen` is the other, for a different reason: it authenticates with a device
 * KEY in its own URL rather than a session cookie, so a session check here would
 * bounce a wall-mounted display to a login form nobody is standing at. Its data
 * route enforces the key; this list only keeps the client-side guard from
 * intercepting a page that answers to a different credential.
 *
 * `/staff` and `/staff/login` (issue #76) are the third reason: a Calendry
 * STAFF session is a completely separate credential
 * (`STAFF_SESSION_COOKIE`/`StaffIdentity`, never a tenant Account session), so
 * this guard — which only ever fetches and checks the TENANT session — must
 * neither block a staff visitor for lacking one nor bounce a tenant-signed-in
 * visitor away from staff pages. Each staff page checks for its own staff
 * session itself.
 */
const ANONYMOUS_ROUTES = [LANDING_ROUTE, SCREEN_ROUTE, STAFF_LOGIN_ROUTE, STAFF_ROUTE];

export default defineNuxtRouteMiddleware(async (to) => {
    // Before anything else, and before any session fetch: this page renders the
    // same for everyone, so there is nothing to resolve and nowhere to redirect.
    if (ANONYMOUS_ROUTES.includes(to.path)) {
        return;
    }

    const session = useSession();

    // Fetch once per navigation cycle; cached across subsequent route changes.
    if (session.value === null) {
        await fetchSession();
    }

    const signedIn = isSignedIn(session.value);
    const isPublic = PUBLIC_ROUTES.includes(to.path);
    const store = useStore();

    if (isPublic) {
        // Already signed in and situated — nothing to do on the login page.
        // A session still awaiting tenant selection must stay, to finish.
        // `?select=1` is the exception: a signed-in user deliberately going back
        // to change institution, which is a session mutation rather than a
        // re-login.
        if (signedIn && to.query.select !== '1') {
            // #73: no explicit `?redirect=` means this wasn't a bounce FROM
            // somewhere, so "home" is wherever this visitor last was, not
            // unconditionally HOME_ROUTE.
            const redirect = typeof to.query.redirect === 'string'
                ? to.query.redirect
                : (store.lastVisitedPage || HOME_ROUTE);

            // Only internal paths: an open redirect would let a crafted link
            // bounce a freshly authenticated user to another origin. `/\` is
            // rejected too — browsers treat a backslash in a Location header
            // as `/`, so `/\evil.com` is `//evil.com` in disguise.
            return navigateTo(isInternalPath(redirect) ? redirect : HOME_ROUTE);
        }

        return;
    }

    if (!signedIn) {
        return navigateTo({
            path: '/login',
            query: to.fullPath === HOME_ROUTE ? undefined : { redirect: to.fullPath },
        });
    }

    // Reached only by a signed-in visit to a protected route — remember it as
    // "where the user left off," matching the fallback above and the login
    // page's own destination resolver.
    store.lastVisitedPage = to.fullPath;
});
