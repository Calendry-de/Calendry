/**
 * Cloudflare Turnstile verification: issue #79's brute-force hardening.
 *
 * WHY A CAPTCHA ON TOP OF THE RATE LIMIT, AND WHY THIS THRESHOLD
 * ----------------------------------------------------------------
 * `checkRateLimit()` (authDb.ts) already caps guesses at 10 per 15-minute
 * window per email, but a rate limit alone still lets an attacker burn the
 * whole window unattended. Requiring a Turnstile token after
 * `CAPTCHA_ATTEMPT_THRESHOLD` failed attempts forces a human into the loop
 * well before the rate limit itself would kick in, without adding friction to
 * the overwhelming majority of logins that get the password right on the
 * first or second try.
 *
 * WHY TURNSTILE OVER RECAPTCHA
 * ----------------------------
 * Decided in issue #79: Turnstile's free tier is unlimited, it does not show
 * image puzzles to most visitors, and, per this project's GDPR-conscious
 * posture (issue #84), it does not fingerprint visitors across sites the way
 * reCAPTCHA's risk-analysis model does.
 *
 * THE VERIFY CALL IS STATELESS
 * -----------------------------
 * `siteverify` has no side effects and no local state to corrupt: verifying
 * the same token twice, or never persisting the result, is exactly as correct
 * as verifying it once. Nothing here needs idempotency handling.
 *
 * `CAPTCHA_ATTEMPT_THRESHOLD` itself lives in `shared/turnstile.ts`, not here.
 * `app/pages/login.vue` needs the identical number to know when to render
 * the widget, and a client/server copy that drifted would mean a request the
 * server rejects for a widget the client never showed. Import it from there
 * directly rather than re-exporting it through this file.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileVerifyResponse {
    success: boolean;
    'error-codes'?: string[];
}

/**
 * Verifies a Turnstile token server-side against Cloudflare's `siteverify`
 * endpoint.
 *
 * GRACEFUL DEV FALLBACK: when `TURNSTILE_SECRET_KEY` is unset (local
 * development with no Cloudflare keys configured), this returns `true`
 * unconditionally, so login is never broken by a missing key; the existing
 * rate-limit throttle is still the defense in that case.
 *
 * PRODUCTION MUST SET A REAL `TURNSTILE_SECRET_KEY`, or every request past
 * `CAPTCHA_ATTEMPT_THRESHOLD` silently skips this check.
 */
export async function verifyTurnstileToken(token: string | undefined): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY;

    if (!secret) {
        return true;
    }

    if (!token) {
        return false;
    }

    try {
        const result = await $fetch<TurnstileVerifyResponse>(VERIFY_URL, {
            method: 'POST',
            body: new URLSearchParams({ secret, response: token }),
        });

        return result.success === true;
    } catch {
        // A network failure against Cloudflare is not proof the token was
        // valid: fail closed, the same direction every other guard in this
        // file fails.
        return false;
    }
}
