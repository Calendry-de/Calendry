/**
 * The two route constants more than one file needs to agree on.
 *
 * `/` is the PUBLIC landing page, so "where does a signed-in session belong"
 * stopped being answerable by writing `'/'` — and it was written in four places:
 * the route guard's two redirect fallbacks, its no-redirect-query special case,
 * and the login page's destination resolver. Four literals that must move
 * together is how a redirect ends up pointing at a marketing page.
 */

/** Where signing in lands, and what a protected page redirects back to. */
export const HOME_ROUTE = '/dashboard';

/** The public landing page: the domain root, readable with no session. */
export const LANDING_ROUTE = '/';

/**
 * The lobby-display board. Authenticates with a device KEY in its own query
 * string, never a session cookie — so it is anonymous to the route guard and
 * gated by its data route instead.
 */
export const SCREEN_ROUTE = '/screen';
