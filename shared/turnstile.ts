/**
 * Cloudflare Turnstile policy shared between client and server (issue #79).
 *
 * A CONSTANT, NOT A CONFIG VALUE: both `server/utils/turnstile.ts` (which
 * enforces it) and `app/pages/login.vue` (which decides when to render the
 * widget) must agree on the exact same number, or the client could fail to
 * show the widget for a request the server is about to reject — the worst
 * version of this feature, a login that cannot succeed with no visible reason.
 */

/**
 * After this many failed login attempts recorded for one email in the
 * current rate-limit window, the NEXT attempt must carry a valid Turnstile
 * token. Chosen well below `checkRateLimit`'s own `maxAttempts: 10`, so a
 * human is pulled into the loop before the rate limit itself would trigger.
 */
export const CAPTCHA_ATTEMPT_THRESHOLD = 3;
