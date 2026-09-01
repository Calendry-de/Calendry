import { z } from 'zod';
import {
    MAX_PASSWORD_AGE_MS, SESSION_COOKIE, SESSION_TTL_MS, generateSessionToken, hashToken, verifyPassword,
} from '../../utils/auth';
import {
    checkRateLimit, createSession, findAccountByEmail, listAccountIdentities,
    resetRateLimit, touchAccountLogin,
} from '../../utils/authDb';
import { verifyTurnstileToken } from '../../utils/turnstile';
import { CAPTCHA_ATTEMPT_THRESHOLD } from '../../../shared/turnstile';

const bodySchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    /** Optional: skip tenant selection when the caller already knows the slug. */
    tenantSlug: z.string().optional(),
    /**
     * Cloudflare Turnstile response token (issue #79). Optional below
     * `CAPTCHA_ATTEMPT_THRESHOLD` failed attempts; required above it — see
     * the check right after `checkRateLimit` below.
     */
    turnstileToken: z.string().optional(),
});

defineRouteMeta({
    openAPI: {
        tags: ['Auth'],
        summary: 'Log in',
        description: 'Authenticates an Account and opens a cookie session. Login is global, not tenant-scoped: if the account maps to exactly one Person (or tenantSlug is given) the tenant is selected implicitly, otherwise the session opens with no active Person and the client must call /api/auth/select-tenant. A forced or expired password authenticates but sets no cookie and returns requiresPasswordChange: true; clear it via /api/auth/change-password. Rate-limited per email (10 attempts / 15 min). After 3 failed attempts in the window, a valid Cloudflare Turnstile token is also required (issue #79).',
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['email', 'password'],
                        properties: {
                            email: { type: 'string', format: 'email' },
                            password: { type: 'string' },
                            tenantSlug: { type: 'string', description: 'Optional: skip tenant selection when the caller already knows the slug.' },
                            turnstileToken: { type: 'string', description: 'Cloudflare Turnstile response token. Required once 3 failed attempts have been recorded for this email in the current rate-limit window; ignored below that.' },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Authenticated. The session cookie is set unless requiresPasswordChange is true.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                sessionId: { type: 'string' },
                                requiresPasswordChange: { type: 'boolean' },
                                tenantSelectionRequired: { type: 'boolean' },
                                activeTenant: { type: 'object', nullable: true, properties: { id: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' } } },
                                availableTenants: { type: 'array', items: { type: 'object', properties: { tenantId: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' } } } },
                            },
                        },
                    },
                },
            },
            400: { description: 'Missing or invalid Turnstile token, required past the failed-attempt threshold.' },
            401: { description: 'Invalid credentials. Deliberately identical for unknown email and wrong password.' },
            403: { description: 'Account is active in no tenant, or has no identity in the requested tenantSlug.' },
        },
    },
});

/**
 * Authenticate an Account and open a session.
 *
 * Login is global, not tenant-scoped: `person.tenant_id` is NOT NULL, so a
 * human working at two institutions has two Person rows, and making Person the
 * credential holder would give them two passwords. The Account owns both; the
 * tenant is chosen afterwards.
 *
 * If the Account maps to exactly one Person the tenant is selected implicitly.
 * Otherwise the session opens with no active Person and the caller must call
 * /api/auth/select-tenant — authenticated, but not yet situated.
 */
export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, bodySchema.parse);

    // BEFORE any password work — issue #13 item 3. Failing fast on a rate
    // limit also means an attacker's blocked guesses cost no scrypt work.
    const attemptCount = await checkRateLimit('login', body.email, { maxAttempts: 10, windowMinutes: 15 });

    /*
     * CAPTCHA gate on top of the rate limit — issue #79. Below the threshold
     * this is a no-op; at and above it, a valid Turnstile token is required
     * for the login to proceed at all. Checked here, before any password
     * work, for the same reason the rate limit itself is: a blocked guess
     * should cost no scrypt work. Additive — the rate limit above is
     * unchanged and still the backstop if this is ever misconfigured.
     */
    if (attemptCount > CAPTCHA_ATTEMPT_THRESHOLD) {
        const captchaOk = await verifyTurnstileToken(body.turnstileToken);

        if (!captchaOk) {
            throw createError({ statusCode: 400, statusMessage: 'CAPTCHA verification required.' });
        }
    }

    const account = await findAccountByEmail(body.email);

    // Same response shape and roughly the same work for "no such account" and
    // "wrong password", so the endpoint does not become an account-existence
    // oracle. The dummy verify keeps the timing comparable.
    const passwordOk = account
        ? await verifyPassword(body.password, account.passwordHash)
        : await verifyPassword(body.password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');

    if (!account || !account.isActive || !passwordOk) {
        throw createError({ statusCode: 401, statusMessage: 'Invalid credentials.' });
    }

    // A correct guess, whatever happens next (tenant selection, a forced
    // reset). The attacker's job — and a legitimate user's — is done here;
    // penalising an earlier typo past this point would only hurt the latter.
    await resetRateLimit('login', body.email);

    /*
     * EXPIRY READS THE SAME BRANCH AS A FORCED RESET, deliberately — issue
     * #13 item 1. Both mean "authenticate, but issue no session until the
     * password changes", and a route two steps downstream should not have to
     * know there are two different reasons that state can be true. Checked
     * AFTER `mustChangePassword` rather than instead of it, so an operator's
     * explicit reset is never silently overridden by the age check finding
     * the OLD password's timestamp still on the row.
     */
    const passwordAge = Date.now() - account.passwordChangedAt.getTime();
    const passwordExpired = passwordAge > MAX_PASSWORD_AGE_MS;

    // A forced reset OR an expired password authenticates but issues NO
    // session and NO cookie. The account must clear the state through
    // /api/auth/change-password first. Deliberately not a "restricted
    // session": every route would then have to know about a half-privileged
    // state, and one that forgot would be a hole.
    if (account.mustChangePassword || passwordExpired) {
        return {
            requiresPasswordChange: true,
            tenantSelectionRequired: false,
            activeTenant: null,
            availableTenants: [],
        };
    }

    const identities = (await listAccountIdentities(account.id)).filter((i) => i.person_active);

    if (identities.length === 0) {
        throw createError({
            statusCode: 403,
            statusMessage: 'This account is not active in any tenant.',
        });
    }

    const selected = body.tenantSlug
        ? identities.find((i) => i.tenant_slug === body.tenantSlug)
        : identities.length === 1
            ? identities[0]
            : undefined;

    if (body.tenantSlug && !selected) {
        throw createError({ statusCode: 403, statusMessage: 'No identity in that tenant.' });
    }

    const token = generateSessionToken();

    const session = await createSession({
        accountId: account.id,
        activePersonId: selected?.person_id ?? null,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        userAgent: getRequestHeader(event, 'user-agent') ?? null,
        ipAddress: getRequestIP(event, { xForwardedFor: true }) ?? null,
    });

    await touchAccountLogin(account.id);

    setCookie(event, SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });

    return {
        sessionId: session.id,
        tenantSelectionRequired: selected === undefined,
        activeTenant: selected
            ? { id: selected.tenant_id, slug: selected.tenant_slug, name: selected.tenant_name }
            : null,
        availableTenants: identities.map((i) => ({
            tenantId: i.tenant_id,
            slug: i.tenant_slug,
            name: i.tenant_name,
        })),
    };
});
