import { CSRF_COOKIE, CSRF_HEADER } from '../../shared/csrf';

/** Minimal HTTP client that carries a session cookie, like a browser would. */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * session-cookie value -> the CSRF token issued alongside it (issue #81).
 *
 * `csrf.ts` stamps a CSRF cookie on every response and `login.post.ts` always
 * issues the session cookie in that SAME response (even mid tenant-selection —
 * see `login.post.ts`), so this pairing is learned for free every time `api()`
 * sees both Set-Cookie headers together. That lets `api()` echo the right
 * token back on a later state-changing call automatically, the same way the
 * browser-side script in `nuxt.config.ts` does for a real client — without
 * every one of this suite's test files needing to know CSRF exists, or
 * `login()`'s return shape (relied on elsewhere, e.g. to read the raw session
 * token back out) having to change to carry a second cookie.
 */
const csrfBySession = new Map<string, string>();

/** Reads one cookie's value out of a `name=value[; ...]` or comma-joined Set-Cookie string. */
function cookieValue(raw: string, name: string): string | null {
    const match = raw.match(new RegExp(`(?:^|;\\s*|,\\s*)${name}=([^;,]*)`));

    return match?.[1] ?? null;
}

export interface ApiResponse<T = unknown> {
    status: number;
    body: T;
    setCookie: string | null;
}

export async function api<T = unknown>(
    path: string,
    init: RequestInit & { cookie?: string | null } = {},
): Promise<ApiResponse<T>> {
    const { cookie, ...rest } = init;

    const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(rest.headers as Record<string, string> | undefined),
    };

    if (cookie) {
        headers.cookie = cookie;

        const method = (rest.method ?? 'GET').toUpperCase();
        const hasExplicitCsrfHeader = Object.keys(headers).some((h) => h.toLowerCase() === CSRF_HEADER);

        // Mirrors the real client's plugin: echo the token back automatically
        // so a test doesn't have to. A caller that wants to exercise the
        // rejection path (missing/wrong token) can still set its own header
        // explicitly — that always wins.
        if (STATE_CHANGING_METHODS.has(method) && !hasExplicitCsrfHeader) {
            const session = cookieValue(cookie, 'calendry_session');
            const csrfToken = session ? csrfBySession.get(session) : undefined;

            if (csrfToken) {
                headers[CSRF_HEADER] = csrfToken;
            }
        }
    }

    const res = await fetch(`${BASE}${path}`, { ...rest, headers });
    const text = await res.text();

    let body: unknown = text;

    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        // Non-JSON error page — keep the raw text for assertion messages.
    }

    // Learn the session<->CSRF pairing whenever a response sets both at once.
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    const sessionFromResponse = setCookies.map((c) => cookieValue(c, 'calendry_session')).find(Boolean);
    const csrfFromResponse = setCookies.map((c) => cookieValue(c, CSRF_COOKIE)).find(Boolean);

    if (sessionFromResponse && csrfFromResponse) {
        csrfBySession.set(sessionFromResponse, csrfFromResponse);
    }

    return { status: res.status, body: body as T, setCookie: res.headers.get('set-cookie') };
}

/**
 * Extracts just the session cookie's `name=value` pair. `setCookie` may now
 * combine two Set-Cookie headers (session + the CSRF cookie every response
 * carries, issue #81) — `Headers.get('set-cookie')` joins multiple headers
 * with ", " rather than returning only one, so this looks the session cookie
 * up by name instead of assuming it's whatever comes first.
 */
export function cookieFrom(setCookie: string | null): string {
    if (!setCookie) {
        throw new Error('Expected a Set-Cookie header but got none.');
    }

    const session = cookieValue(setCookie, 'calendry_session');

    if (!session) {
        throw new Error(`Expected a calendry_session cookie but got: ${setCookie}`);
    }

    return `calendry_session=${session}`;
}

/** Logs in and returns the session cookie plus the login payload. */
export async function login(email: string, password: string, tenantSlug?: string) {
    const res = await api<{
        tenantSelectionRequired: boolean;
        activeTenant: { id: string; slug: string } | null;
        availableTenants: { tenantId: string; slug: string }[];
    }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, ...(tenantSlug ? { tenantSlug } : {}) }),
    });

    if (res.status !== 200) {
        throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    }

    return { cookie: cookieFrom(res.setCookie), ...res.body };
}
