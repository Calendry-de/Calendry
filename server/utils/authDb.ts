import { Prisma } from '@prisma/client';
import { hashToken } from './auth';

/**
 * Queries against the PRE-TENANT data plane.
 *
 * Everything here runs on the base Prisma client, deliberately NOT inside
 * `withTenant()`, because these reads happen before the tenant is known. That
 * makes this the one module allowed to touch the database without RLS context —
 * every other server module must go through `withTenant`.
 *
 * The two lookups that need to cross into tenant-scoped tables (`person`,
 * `tenant`) go through the narrow SECURITY DEFINER functions defined in the RLS
 * migration, which are keyed only by a secret the caller already holds.
 */

export interface SessionIdentityRow {
    session_id: string;
    account_id: string;
    person_id: string | null;
    tenant_id: string | null;
    federation_id: string | null;
    expires_at: Date;
    revoked_at: Date | null;
    account_active: boolean;
    person_active: boolean;
}

export interface AccountIdentityRow {
    person_id: string;
    given_name: string;
    family_name: string;
    person_active: boolean;
    tenant_id: string;
    tenant_slug: string;
    tenant_name: string;
    federation_id: string | null;
}

/** Resolves a raw bearer token to its session, or null if it is not usable. */
export async function resolveSessionToken(token: string): Promise<SessionIdentityRow | null> {
    const prisma = getPrisma();
    const rows = await prisma.$queryRaw<SessionIdentityRow[]>`
        SELECT * FROM calendry_internal.session_identity(${hashToken(token)})
    `;

    const row = rows[0];

    if (!row) {
        return null;
    }

    // Expiry, revocation and account deactivation are all checked here rather
    // than in SQL so that a disabled account's session dies on its next request
    // instead of lingering until it expires.
    if (row.revoked_at !== null || row.expires_at.getTime() <= Date.now() || !row.account_active) {
        return null;
    }

    return row;
}

export interface ScreenIdentityRow {
    screen_id: string;
    tenant_id: string;
    federation_id: string | null;
    name: string;
    is_active: boolean;
    /** Rooms this screen may show. EMPTY MEANS EVERY ROOM in its tenant. */
    room_ids: string[];
}

/**
 * Resolves a raw screen key to its screen, or null if no screen carries it.
 *
 * IN THIS MODULE, which is the only one permitted to query without tenant
 * context (CLAUDE.md exception 2), because that is exactly what this is: the
 * tenant is not known until the key has been resolved. The privileged step is
 * `calendry_internal.screen_identity()`, parameterised by the secret alone.
 *
 * The room scope is read here, in the same privileged step, rather than in the
 * caller's tenant transaction. It could be read either way — but doing it here
 * keeps "what is this credential" one question with one answer, so a handler
 * cannot accidentally act on a screen whose scope it has not loaded.
 *
 * Returns the row even when `is_active` is false. The caller decides: the
 * resolver treats it as no identity, while the board route reports "revoked", so
 * a display can say why it went blank instead of looking broken.
 */
export async function resolveScreenKey(key: string): Promise<ScreenIdentityRow | null> {
    const prisma = getPrisma();
    const rows = await prisma.$queryRaw<ScreenIdentityRow[]>`
        SELECT * FROM calendry_internal.screen_identity(${hashToken(key)})
    `;

    return rows[0] ?? null;
}

export interface ApiTokenIdentityRow {
    token_id: string;
    tenant_id: string;
    federation_id: string | null;
    person_id: string;
    person_active: boolean;
    /** Ceiling selected at creation; the live intersection happens in heldPermissions(). */
    permissions: string[];
    is_active: boolean;
    expires_at: Date | null;
}

/**
 * Resolves a raw bearer token to its row, or null when none carries it.
 *
 * IN THIS MODULE for the same reason `resolveScreenKey` is: the tenant is not
 * known until the secret has been resolved. The privileged step is
 * `calendry_internal.api_token_identity()`, parameterised by the secret alone.
 *
 * Returns the row even when inactive, expired, or its Person deactivated; the
 * resolver in tenantResolver.ts is the single place those become "no identity",
 * so the policy lives in code the tests can see.
 */
export async function resolveApiToken(token: string): Promise<ApiTokenIdentityRow | null> {
    const prisma = getPrisma();
    const rows = await prisma.$queryRaw<ApiTokenIdentityRow[]>`
        SELECT * FROM calendry_internal.api_token_identity(${hashToken(token)})
    `;

    return rows[0] ?? null;
}

/**
 * Stamp `last_used_at`, throttled to once a minute inside the SECURITY DEFINER
 * function itself. A plain UPDATE from here would match zero rows under FORCE
 * ROW LEVEL SECURITY — the exact bug the screen board's `lastSeenAt` shipped
 * with — because no tenant context exists at resolution time.
 */
export async function touchApiToken(tokenId: string): Promise<void> {
    await getPrisma().$executeRaw`SELECT calendry_internal.touch_api_token(${tokenId})`;
}

export interface IcsLinkIdentityRow {
    link_id: string;
    tenant_id: string;
    federation_id: string | null;
    person_id: string;
    person_active: boolean;
    scope: 'ALL' | 'TERM';
    term_id: string | null;
    weeks_ahead: number | null;
}

/**
 * Resolves a raw ics_link token to its row, or null when none carries it.
 *
 * IN THIS MODULE for the same reason `resolveScreenKey`/`resolveApiToken`
 * are: the tenant is not known until the token has been resolved. The
 * privileged step is `calendry_internal.ics_link_identity()`, parameterised
 * by the token alone. Unlike the other two, the token itself is not hashed —
 * see `IcsLink`'s own comment — but the lookup still needs to happen before
 * `withTenant()` can open, so the SECURITY DEFINER function stays.
 */
export async function resolveIcsLink(token: string): Promise<IcsLinkIdentityRow | null> {
    const prisma = getPrisma();
    const rows = await prisma.$queryRaw<IcsLinkIdentityRow[]>`
        SELECT * FROM calendry_internal.ics_link_identity(${token})
    `;

    return rows[0] ?? null;
}

/** Stamp `last_used_at`, throttled to once a minute — same shape as `touchApiToken`. */
export async function touchIcsLink(linkId: string): Promise<void> {
    await getPrisma().$executeRaw`SELECT calendry_internal.touch_ics_link(${linkId})`;
}

/** The tenants this account can act in. */
export async function listAccountIdentities(accountId: string): Promise<AccountIdentityRow[]> {
    const prisma = getPrisma();

    return prisma.$queryRaw<AccountIdentityRow[]>`
        SELECT * FROM calendry_internal.account_identities(${accountId})
    `;
}

export async function findAccountByEmail(email: string) {
    return getPrisma().account.findUnique({ where: { email: email.toLowerCase() } });
}

export async function createSession(input: {
    accountId: string;
    activePersonId: string | null;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
}) {
    return getPrisma().authSession.create({ data: input });
}

export async function setSessionActivePerson(sessionId: string, personId: string) {
    return getPrisma().authSession.update({
        where: { id: sessionId },
        data: { activePersonId: personId },
    });
}

export async function revokeSession(sessionId: string) {
    return getPrisma().authSession.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
    });
}

/**
 * Set a new password hash and revoke every open session, atomically.
 *
 * One transaction: whoever prompted the change may be locking someone out, so
 * the new credential and the revocations must land together — a crash between
 * the two would leave a "changed" password with the old sessions still live.
 */
export async function updatePasswordAndRevokeSessions(accountId: string, passwordHash: string): Promise<void> {
    await getPrisma().$transaction(async (tx) => {
        await tx.account.update({
            where: { id: accountId },
            data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
        });

        await tx.authSession.updateMany({
            where: { accountId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    });
}

export async function touchAccountLogin(accountId: string) {
    return getPrisma().account.update({
        where: { id: accountId },
        data: { lastLoginAt: new Date() },
    });
}

/**
 * How long a dead session's row is kept before it is swept.
 *
 * Sessions live 12 hours (`SESSION_TTL_MS`), so this retains each row roughly
 * 60x its useful life. The window is not about the session — an expired row can
 * never authenticate anyone again — it is about `user_agent` and `ip_address`,
 * which exist to answer "where was this account used from" and are worth
 * nothing if they are deleted the moment they become interesting.
 */
export const SESSION_RETENTION_MS = 1000 * 60 * 60 * 24 * 30;

/**
 * Delete sessions that expired more than `SESSION_RETENTION_MS` ago.
 *
 * WHY `expires_at` ALONE IS THE WHOLE PREDICATE
 * ---------------------------------------------
 * A row whose `expires_at` has passed can never authenticate again:
 * `resolveSessionToken()` rejects it before returning, and nothing in this
 * codebase un-expires a session. Revoked-but-unexpired rows need no second
 * clause, because the 12-hour TTL means every revoked row expires within half a
 * day and is then caught by the same test. One condition instead of a
 * `LEAST(expires_at, COALESCE(revoked_at, ...))` expression that would need its
 * own correctness argument.
 *
 * WHY THIS NEEDS NO TENANT CONTEXT AND NO NEW EXCEPTION
 * -----------------------------------------------------
 * `auth_session` carries no RLS at all — that is the second of the deliberate
 * exceptions in CLAUDE.md, because a session must be read before the tenant is
 * known. Verified rather than assumed: `relrowsecurity = f`, and `calendry_app`
 * already holds DELETE on the table. So this is an ordinary statement on the
 * runtime connection, and adds no fourth SECURITY DEFINER path.
 *
 * Returns the count and the cutoff so the caller can report BOTH — a sweep that
 * deleted nothing and a sweep that never ran must not look the same.
 */
export async function deleteExpiredSessions(now = new Date()): Promise<{ deleted: number; before: Date }> {
    const before = new Date(now.getTime() - SESSION_RETENTION_MS);

    const { count } = await getPrisma().authSession.deleteMany({
        where: { expiresAt: { lt: before } },
    });

    return { deleted: count, before };
}

/**
 * Guards `login` and `change-password` against repeated guessing — issue #13
 * item 3. Both take an email plus a secret and answer a generic failure
 * either way, so a rate limit is the only thing standing between an attacker
 * and an unlimited number of tries at one account's password.
 *
 * ROUTE-QUALIFIED KEY, not just the email: `login` and `change_password` are
 * two different doors accepting the same secret, and succeeding at one must
 * not spend the other's budget — see the migration's own note.
 *
 * ONE ATOMIC STATEMENT, not a read-then-write. Two concurrent guesses reading
 * the same count and both incrementing from it would let an attacker double
 * their effective rate exactly at the point that matters — the threshold.
 * Postgres's own row-level locking inside `INSERT … ON CONFLICT DO UPDATE`
 * makes the reset-if-expired-else-increment logic a single round trip with no
 * race to reason about.
 *
 * NO RLS, NO TENANT CONTEXT — this runs on the base Prisma client for the
 * identical reason every other function in this file does: the routes it
 * guards are pre-tenant.
 */
export async function checkRateLimit(
    route: string,
    identifier: string,
    options: { maxAttempts: number; windowMinutes: number },
): Promise<void> {
    const key = `${route}:${identifier.toLowerCase()}`;

    const [row] = await getPrisma().$queryRaw<{ attempt_count: number }[]>(
        Prisma.sql`
            INSERT INTO "auth_rate_limit" ("key", "attempt_count", "window_start")
            VALUES (${key}, 1, now())
            ON CONFLICT ("key") DO UPDATE SET
                "attempt_count" = CASE
                    WHEN "auth_rate_limit"."window_start" < now() - make_interval(mins => ${options.windowMinutes})
                        THEN 1
                    ELSE "auth_rate_limit"."attempt_count" + 1
                END,
                "window_start" = CASE
                    WHEN "auth_rate_limit"."window_start" < now() - make_interval(mins => ${options.windowMinutes})
                        THEN now()
                    ELSE "auth_rate_limit"."window_start"
                END
            RETURNING "attempt_count"
        `,
    );

    if ((row?.attempt_count ?? 0) > options.maxAttempts) {
        throw createError({
            statusCode: 429,
            statusMessage: 'Too many attempts. Wait a few minutes and try again.',
        });
    }
}

/**
 * Clears the counter after a SUCCESSFUL attempt, so one earlier typo does not
 * count against someone who then got it right. Never called on failure —
 * that would let an attacker reset their own budget by alternating a
 * deliberately-wrong guess pattern, which defeats the whole mechanism.
 */
export async function resetRateLimit(route: string, identifier: string): Promise<void> {
    await getPrisma().authRateLimit.deleteMany({
        where: { key: `${route}:${identifier.toLowerCase()}` },
    });
}
