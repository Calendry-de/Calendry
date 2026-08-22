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
