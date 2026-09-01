import { z } from 'zod';
import { writeAuditLog } from './auditLog';
import type { Tx } from './tenantDb';
import { PASSWORD_MIN_LENGTH, randomPassword } from '../../shared/password';

/**
 * The tenant-facing view of the LOGIN plane.
 *
 * WHY THIS IS NOT IN `RESOURCES`
 * ------------------------------
 * `account` and `account_person` are the pre-tenant auth plane: no `tenant_id`,
 * no RLS (CLAUDE.md, exception 2). The generic CRUD routes put
 * `where: { tenantId }` on every statement, which against these tables matches
 * nothing — not "everything", but nothing, so the failure would look like an
 * empty institution rather than a broken query. Accounts therefore get their own
 * handlers, and this module holds the part all of them must agree on.
 *
 * THE SUBSTITUTE FOR RLS IS THE JOIN, and it is the whole security model here:
 * an Account is visible to a tenant if and only if `account_person` links it to
 * a Person IN that tenant. `accountScope()` is the only place that rule is
 * written; every route resolves through it rather than filtering for itself.
 *
 * WHY A TENANT MAY NOT ALWAYS TOUCH THE CREDENTIAL
 * ------------------------------------------------
 * One Account can act in several tenants (that is the point of a
 * tenant-independent login). Letting tenant A reset the password of an Account
 * that also acts in tenant B would be cross-tenant account takeover dressed up
 * as ordinary administration — A's admin sets a password, signs in, and picks
 * B's identity. So credential operations (password, email, activation, deletion)
 * are permitted only while THIS tenant is the account's only tenant, which
 * `scope.isSoleTenant` reports and every such route asserts. A shared account is
 * still fully manageable in the one way that cannot leak: attaching and
 * detaching this tenant's own Person.
 *
 * The mirror image of that rule keeps orphans unrepresentable — see
 * `assertDetachable`.
 */

/**
 * The floor and the generator both come from `shared/password.ts`, so the form
 * that tells the admin "at least 12" and the boundary that enforces it read one
 * number. Re-exported here only as a convenience for the account routes.
 */
export const passwordSchema = z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);

/** A one-time password, shown once by the caller and never stored in the clear. */
export const generatePassword = randomPassword;

export interface CreateAccountRowInput {
    email: string;
    passwordHash: string;
    mustChangePassword: boolean;
    /** Omitted keeps the column's own default — stated because callers vary on this. */
    isActive?: boolean;
}

/**
 * Creates a new `account` row. The caller decides whether to reuse an
 * existing one by email first — this always creates, never upserts, matching
 * how both callers already treat "an existing Account for this email" as a
 * question they answer themselves before reaching here.
 *
 * Shared by `POST /api/accounts` and `scripts/create-account.ts`, which used
 * to each write this same `tx.account.create()` call independently.
 */
export async function createAccountRow(tx: Tx, input: CreateAccountRowInput): Promise<{ id: string }> {
    return tx.account.create({
        data: {
            email: input.email,
            passwordHash: input.passwordHash,
            mustChangePassword: input.mustChangePassword,
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
        select: { id: true },
    });
}

/**
 * Links an Account to a Person — the `account_person` row every
 * account-creation or account-attach path ends with, whether the Account was
 * just created or an existing one is being reused. Shared for the same
 * reason `createAccountRow` is.
 */
export async function linkAccountToPerson(tx: Tx, accountId: string, personId: string): Promise<void> {
    await tx.accountPerson.create({ data: { accountId, personId } });
}

/** One row of `account_person`, resolved to the tenant it acts in. */
interface Identity {
    personId: string;
    tenantId: string;
    givenName: string;
    familyName: string;
    personActive: boolean;
}

export interface AccountScope {
    id: string;
    email: string;
    isActive: boolean;
    mustChangePassword: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    /** Every identity this account holds, in every tenant. */
    identities: Identity[];
    /** The identity inside the calling tenant. Never null for a visible account. */
    own: Identity;
    /** Distinct OTHER tenants this account acts in. Count only — see below. */
    otherTenantCount: number;
    /**
     * Whether the calling tenant is the only one this account serves, and
     * therefore whether it may touch the credential at all.
     */
    isSoleTenant: boolean;
}

/**
 * Resolves an Account the calling tenant may see, or throws 404.
 *
 * 404 AND NOT 403 for an account that exists but has no identity here: the
 * question "does this id name an account somewhere in the deployment" is not one
 * a tenant is entitled to an answer to, which is the same reasoning the generic
 * routes' `findFirst`-with-tenant-predicate follows for cross-tenant ids.
 *
 * Reads the FULL identity set, including other tenants', because two of this
 * module's rules are about exactly that set. Only its SIZE ever leaves the
 * server — never the names or slugs of the other institutions.
 */
export async function accountScope(tx: Tx, tenantId: string, accountId: string): Promise<AccountScope> {
    /*
     * `account` itself has no RLS, so this reads by primary key exactly as the
     * auth plane does. It is the JOIN below, not this query, that decides
     * whether the caller may see the row.
     */
    const account = await tx.account.findUnique({
        where: { id: accountId },
        select: {
            id: true,
            email: true,
            isActive: true,
            mustChangePassword: true,
            lastLoginAt: true,
            createdAt: true,
        },
    });

    /*
     * NOT `account.persons.person` — `person` is behind RLS and this runs inside
     * the tenant transaction, so a nested select returns only THIS tenant's rows.
     * `otherTenantCount` would then be permanently 0 and both guards below would
     * silently pass for every shared account. The identity set is read through
     * the same SECURITY DEFINER function the auth plane uses, parameterised by
     * the account id alone and by no tenant id.
     */
    const identities = account
        ? await tx.$queryRaw<{
            person_id: string;
            tenant_id: string;
            given_name: string;
            family_name: string;
            person_active: boolean;
        }[]>`SELECT person_id, tenant_id, given_name, family_name, person_active
               FROM calendry_internal.account_identities(${accountId})`
        : [];

    const resolved: Identity[] = identities.map((row) => ({
        personId: row.person_id,
        tenantId: row.tenant_id,
        givenName: row.given_name,
        familyName: row.family_name,
        personActive: row.person_active,
    }));

    const own = resolved.find((identity) => identity.tenantId === tenantId);

    if (!account || !own) {
        throw createError({ statusCode: 404, statusMessage: 'Not found.' });
    }

    const otherTenantIds = new Set(
        resolved.filter((identity) => identity.tenantId !== tenantId).map((identity) => identity.tenantId),
    );

    return {
        id: account.id,
        email: account.email,
        isActive: account.isActive,
        mustChangePassword: account.mustChangePassword,
        lastLoginAt: account.lastLoginAt,
        createdAt: account.createdAt,
        identities: resolved,
        own,
        otherTenantCount: otherTenantIds.size,
        isSoleTenant: otherTenantIds.size === 0,
    };
}

/**
 * The shape every account route returns, and the one the management UI edits.
 *
 * `personId` travels as a plain field rather than as a relation, because from
 * the tenant's side it is single-valued: `account_person` is
 * `@@unique([personId])` and a Person belongs to one Account, so within one
 * tenant an Account has at most one identity. The many-to-many-ness only exists
 * ACROSS tenants, which is precisely the part no tenant may edit.
 */
export interface AccountView {
    id: string;
    email: string;
    isActive: boolean;
    mustChangePassword: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    personId: string;
    personName: string;
    personActive: boolean;
    activeSessions: number;
    otherTenantCount: number;
    isSoleTenant: boolean;
}

export async function accountView(tx: Tx, scope: AccountScope): Promise<AccountView> {
    const activeSessions = await tx.authSession.count({
        where: { accountId: scope.id, revokedAt: null, expiresAt: { gt: new Date() } },
    });

    return {
        id: scope.id,
        email: scope.email,
        isActive: scope.isActive,
        mustChangePassword: scope.mustChangePassword,
        lastLoginAt: scope.lastLoginAt,
        createdAt: scope.createdAt,
        personId: scope.own.personId,
        personName: `${scope.own.givenName} ${scope.own.familyName}`.trim(),
        personActive: scope.own.personActive,
        activeSessions,
        otherTenantCount: scope.otherTenantCount,
        isSoleTenant: scope.isSoleTenant,
    };
}

/**
 * Refuses a credential operation on an Account this tenant shares.
 *
 * 409, not 403: the caller holds `account.manage` and the permission is not the
 * problem — the ACCOUNT is, and a 403 would send them off to be granted
 * something that would not help. The message names the operator command that
 * can do it, because somebody legitimately needs this occasionally and a refusal
 * with no next step is how people start editing the database by hand.
 */
export function assertSoleTenant(scope: AccountScope, action: string): void {
    if (scope.isSoleTenant) {
        return;
    }

    throw createError({
        statusCode: 409,
        statusMessage: `This login is also used at ${scope.otherTenantCount} other `
            + `institution${scope.otherTenantCount === 1 ? '' : 's'}, so ${action} here would `
            + 'change their access too. Detach it from this institution instead, or ask an '
            + 'operator to run `bun run reset:password`.',
        data: { field: 'email' },
    });
}

/**
 * Refuses detaching the LAST identity an Account has.
 *
 * An Account with no `account_person` row is invisible to every tenant — it
 * cannot be listed, reset or deleted through any route, while its password
 * still works — so it is not a state to warn about, it is one to make
 * unrepresentable. Together with `assertSoleTenant` the two rules are exact
 * complements, which is why neither needs an escape hatch:
 *
 *   sole tenant     → delete allowed, detach refused (nothing else holds it)
 *   shared account  → detach allowed, credential ops refused (others hold it)
 */
export function assertDetachable(scope: AccountScope): void {
    if (!scope.isSoleTenant) {
        return;
    }

    throw createError({
        statusCode: 409,
        statusMessage: 'This institution holds the login’s only identity. Detaching it would '
            + 'leave a working password nobody can see or revoke. Attach it to a different '
            + 'person, or delete the login.',
        data: { field: 'personId' },
    });
}

/**
 * The Person the given id names, if this tenant may attach it.
 *
 * Three separate refusals rather than one, because they send the caller to three
 * different places: no such person here, that person already has a login, or the
 * person is deactivated (a login they cannot use — `listAccountIdentities`
 * filters inactive persons out at sign-in, so the account would authenticate and
 * then be told it belongs to no tenant).
 */
export async function resolveAttachablePerson(
    tx: Tx,
    tenantId: string,
    personId: string,
    /** The account being edited, so re-saving its own person is not a clash. */
    accountId?: string,
): Promise<{ id: string; givenName: string; familyName: string }> {
    const person = await tx.person.findFirst({
        where: { id: personId, tenantId },
        select: {
            id: true,
            givenName: true,
            familyName: true,
            isActive: true,
            accountLink: { select: { accountId: true } },
        },
    });

    if (!person) {
        throw createError({
            statusCode: 422,
            statusMessage: 'No such person in this institution.',
            data: { field: 'personId' },
        });
    }

    if (person.accountLink && person.accountLink.accountId !== accountId) {
        throw createError({
            statusCode: 409,
            statusMessage: `${person.givenName} ${person.familyName} already has a login. `
                + 'A person answers to exactly one account, so two credentials for one identity '
                + 'would make every audit entry ambiguous.',
            data: { field: 'personId' },
        });
    }

    if (!person.isActive) {
        throw createError({
            statusCode: 422,
            statusMessage: `${person.givenName} ${person.familyName} is deactivated. `
                + 'Sign-in resolves identities through active people only, so this login would '
                + 'authenticate and then belong to no institution.',
            data: { field: 'personId' },
        });
    }

    return { id: person.id, givenName: person.givenName, familyName: person.familyName };
}

/**
 * One persisted row per credential write (issue #78).
 *
 * Until issue #78 this was a structured `console.log` line, on the reasoning
 * that a tenant admin who can mint logins can also edit any row this tenant
 * owns, so a local audit row would not be tamper-evident against the actor it
 * audits. `AuditLog` does not reopen that hole: it carries no RLS and is not
 * a `CRUD_RESOURCES` entry, so it is unreachable through the generic
 * `/api/[resource]` routes a tenant admin's permissions actually reach — the
 * only write path is `writeAuditLog()` itself, called from server code, never
 * from a request body. `email` becomes the row's `target` (the human-readable
 * identifier of the account being acted on); everything else in `record`
 * (besides the fields named explicitly) rides along in `detail`.
 */
export async function auditAccount(record: {
    action: string;
    tenantId: string;
    accountId: string;
    email: string;
    actorPersonId: string;
    [key: string]: unknown;
}): Promise<void> {
    const { action, tenantId, accountId, email, actorPersonId, ...detail } = record;

    await writeAuditLog({
        action,
        outcome: 'SUCCESS',
        actorPersonId,
        target: email,
        tenantId,
        detail: { accountId, ...detail, via: 'api:accounts' },
    });
}
