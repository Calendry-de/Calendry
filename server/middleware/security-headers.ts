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
        // Vue's runtime compiler respectively.
        `script-src 'self' 'unsafe-inline' 'unsafe-eval'${__impeccableLiveDev}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        // ws:/wss: for Vite's dev-server HMR socket.
        `connect-src 'self' ws: wss:${__impeccableLiveDev}`,
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
    ];
    headers.setHeader('Content-Security-Policy', cspDirectives.join('; '));

    if (process.env.NODE_ENV === 'production') {
        headers.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
});
