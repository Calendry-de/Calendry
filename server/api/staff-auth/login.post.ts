import { z } from 'zod';
import {
    STAFF_SESSION_COOKIE, STAFF_SESSION_TTL_MS, generateSessionToken, hashToken, verifyPassword,
} from '../../utils/auth';
import {
    checkRateLimit, createStaffSession, findStaffAccountByEmail, resetRateLimit, touchStaffAccountLogin,
} from '../../utils/authDb';
import { writeAuditLog } from '../../utils/auditLog';
import { verifyTurnstileToken } from '../../utils/turnstile';
import { CAPTCHA_ATTEMPT_THRESHOLD } from '../../../shared/turnstile';

const bodySchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    /**
     * Cloudflare Turnstile response token (issue #106, reusing #79's
     * infrastructure). Optional below `CAPTCHA_ATTEMPT_THRESHOLD` failed
     * attempts; required above it — see the check right after
     * `checkRateLimit` below.
     */
    turnstileToken: z.string().optional(),
});

defineRouteMeta({
    openAPI: {
        tags: ['Staff auth'],
        summary: 'Calendry staff: log in',
        description: 'Authenticates a StaffAccount and opens a staff session, distinct from a tenant Account session — issue #76. A staff session never carries a tenant and can never satisfy a tenant permission check; it only unlocks server/api/staff/* (onboarding, support). Rate-limited per email (10 attempts / 15 min), same posture as /api/auth/login. After 3 failed attempts in the window, a valid Cloudflare Turnstile token is also required (issue #106, reusing #79\'s gate).',
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
                            turnstileToken: { type: 'string', description: 'Cloudflare Turnstile response token. Required once 3 failed attempts have been recorded for this email in the current rate-limit window; ignored below that.' },
                        },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Authenticated. The staff session cookie is set.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                staffAccountId: { type: 'string' },
                                email: { type: 'string' },
                            },
                        },
                    },
                },
            },
            400: { description: 'Missing or invalid Turnstile token, required past the failed-attempt threshold.' },
            401: { description: 'Invalid credentials. Deliberately identical for unknown staff account and wrong password.' },
        },
    },
});

/**
 * Authenticate a StaffAccount and open a staff session — issue #76.
 *
 * Deliberately NOT `/api/auth/login`: this is a completely separate
 * credential (`StaffAccount`/`StaffSession`, no `tenant_id`, no RLS) with its
 * own cookie (`STAFF_SESSION_COOKIE`), so a staff login and a tenant login can
 * never be confused by a code path that forgot which one it was reading. No
 * tenant-selection step exists here — a staff principal is never IN a
 * tenant — see `StaffIdentity` in `tenantResolver.ts`.
 *
 * Same care as `/api/auth/login` against account-existence timing: the dummy
 * `verifyPassword` call runs the same scrypt work whether or not the email
 * matches a real StaffAccount.
 *
 * Audited (issue #106, `writeAuditLog` from issue #78, only ever wired into
 * the tenant plane until now): every failure branch past the dummy-verify
 * call, not just "wrong password", plus success. `tenantId` is always `null`
 * — a staff session has no tenant, ever.
 */
export default defineEventHandler(async (event) => {
    const body = await readValidatedBody(event, bodySchema.parse);

    // BEFORE any password work — same reasoning as /api/auth/login: a
    // rate-limited caller's blocked guesses must not cost scrypt work.
    // Route-qualified key (`staff_login`, not `login`) so a tenant login and
    // a staff login against the same email do not share one budget.
    const attemptCount = await checkRateLimit('staff_login', body.email, { maxAttempts: 10, windowMinutes: 15 });

    /*
     * CAPTCHA gate on top of the rate limit — issue #106, reusing #79's
     * infrastructure as-is rather than forking a second copy. Same threshold,
     * same "checked before any password work" placement, same graceful dev
     * fallback (verifyTurnstileToken() returns true when TURNSTILE_SECRET_KEY
     * is unset).
     */
    if (attemptCount > CAPTCHA_ATTEMPT_THRESHOLD) {
        const captchaOk = await verifyTurnstileToken(body.turnstileToken);

        if (!captchaOk) {
            throw createError({ statusCode: 400, statusMessage: 'CAPTCHA verification required.' });
        }
    }

    const account = await findStaffAccountByEmail(body.email);

    const passwordOk = account
        ? await verifyPassword(body.password, account.passwordHash)
        : await verifyPassword(body.password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');

    if (!account || !account.isActive || !passwordOk) {
        // Past the dummy-verify branch, whether or not a StaffAccount exists —
        // same care /api/auth/login.post.ts takes (issue #78): `actorAccountId`
        // (here: the StaffAccount id) is populated when one does, even though
        // the guess was wrong or the account is deactivated. `tenantId` is
        // always null — a staff login predates any tenant, always.
        await writeAuditLog({
            action: 'staff_login.failure',
            outcome: 'FAILURE',
            actorAccountId: account?.id ?? null,
            actorLabel: body.email,
            tenantId: null,
            target: body.email,
            detail: { reason: !account ? 'no_such_staff_account' : !account.isActive ? 'staff_account_inactive' : 'wrong_password' },
        });

        throw createError({ statusCode: 401, statusMessage: 'Invalid credentials.' });
    }

    await resetRateLimit('staff_login', body.email);

    const token = generateSessionToken();

    const session = await createStaffSession({
        staffAccountId: account.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + STAFF_SESSION_TTL_MS),
        userAgent: getRequestHeader(event, 'user-agent') ?? null,
        ipAddress: getRequestIP(event, { xForwardedFor: true }) ?? null,
    });

    await touchStaffAccountLogin(account.id);

    setCookie(event, STAFF_SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: Math.floor(STAFF_SESSION_TTL_MS / 1000),
    });

    await writeAuditLog({
        action: 'staff_login.success',
        outcome: 'SUCCESS',
        actorAccountId: account.id,
        actorLabel: account.email,
        tenantId: null,
        target: body.email,
    });

    return {
        sessionId: session.id,
        staffAccountId: account.id,
        email: account.email,
    };
});
