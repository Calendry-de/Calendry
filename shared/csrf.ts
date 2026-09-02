/**
 * Double-submit CSRF cookie/header names (issue #81).
 *
 * In `shared/` because three things must agree on the same pair of strings:
 * `server/middleware/csrf.ts` (sets the cookie, verifies the header), the
 * inline fetch-patching script in `nuxt.config.ts` (echoes the cookie back as
 * the header on every state-changing request), and `tests/helpers/client.ts`
 * (does the same for the integration suite, which talks to the API directly
 * rather than through a browser).
 *
 * The inline script (not a Nuxt plugin) is what patches `fetch`: a plugin's
 * `setup()` runs too late to intercept it. Nuxt's own `$fetch` singleton is
 * created by `#build/fetch.mjs`'s top-level code (`globalThis.$fetch =
 * ofetch.create(...)`), which captures `globalThis.fetch` once, at MODULE
 * EVALUATION time. Module evaluation always finishes before any runtime code,
 * including the first plugin's callback, ever runs, so by the time a
 * plugin's `defineNuxtPlugin(() => { ... })` body executes, that capture has
 * already happened and reassigning `globalThis.fetch`/`globalThis.$fetch`
 * from inside it is provably too late. A classic (non-module) inline
 * `<script>`, by contrast, runs during HTML parsing, strictly before any
 * `type="module"` script, which is deferred by spec regardless of its
 * position in the document, so it is the only place that is guaranteed to
 * win the race.
 */

/** Non-httpOnly cookie carrying the CSRF token; the client must be able to read it. */
export const CSRF_COOKIE = 'calendry_csrf';

/** Header a state-changing request must echo the cookie's value back in. */
export const CSRF_HEADER = 'x-csrf-token';
