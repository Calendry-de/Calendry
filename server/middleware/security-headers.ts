export default defineEventHandler(event => {
    const headers = event.node.res;

    headers.setHeader('X-Content-Type-Options', 'nosniff');

    // '0' disables the legacy XSS auditor, per current OWASP guidance: the
    // auditor is gone from modern browsers, and in old ones it could be abused
    // to selectively neuter scripts. CSP below is the real control.
    headers.setHeader('X-XSS-Protection', '0');

    headers.setHeader('X-Frame-Options', 'SAMEORIGIN');
    headers.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // Dev-only allowance so impeccable live mode can load. Guarded by NODE_ENV.
    const __impeccableLiveDev =
        process.env.NODE_ENV === 'development' ? ' http://localhost:8400' : '';

    const cspDirectives = [
        "default-src 'self'",
        // unsafe-inline and unsafe-eval are required by Nuxt's hydration and
        // Vue's runtime compiler respectively. challenges.cloudflare.com is
        // Turnstile's widget script (issue #79), loaded from login.vue only
        // once the failed-attempt threshold is reached.
        `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com${__impeccableLiveDev}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        // ws:/wss: for Vite's dev-server HMR socket. challenges.cloudflare.com
        // is Turnstile's own client-side verification traffic.
        `connect-src 'self' ws: wss: https://challenges.cloudflare.com${__impeccableLiveDev}`,
        // Turnstile renders its challenge in an iframe — no frame-src existed
        // before issue #79 because nothing on this site framed anything.
        "frame-src https://challenges.cloudflare.com",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
    ];
    headers.setHeader('Content-Security-Policy', cspDirectives.join('; '));

    if (process.env.NODE_ENV === 'production') {
        headers.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
});
