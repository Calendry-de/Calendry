import type { H3Event } from 'h3';
import { SESSION_COOKIE, STAFF_SESSION_COOKIE } from './auth';
import {
    resolveApiToken, resolveIcsLink, resolveScreenKey, resolveSessionToken, resolveStaffSessionToken,
    touchApiToken, touchIcsLink,
} from './authDb';

/**
 * Resolved request identity. Everything downstream — RLS context, explicit
 * tenant filters, event actor attribution, permission checks — reads from this
 * and nothing else.
 */
interface IdentityBase {
    tenantId: string;
    federationId: string | null;
    /** Person acting, for SessionEvent attribution and permission lookup. */
    actorPersonId: string | null;
}

/** A signed-in human, acting through a session cookie. */
export interface AccountIdentity extends IdentityBase {
    kind: 'account';
    accountId: string;
    sessionId: string;
}

/**
 * A lobby display, acting through a device key.
 *
 * `actorPersonId` is `null` and always will be, and that is the whole security
 * argument rather than a detail: `heldPermissions()` throws 403 when there is no
 * acting Person, so a screen key cannot satisfy any permission check in the app
 * — including one added years from now by somebody who has never heard of
 * screens. The authority of a screen is `roomIds` and nothing else.
 *
 * A DISCRIMINATED UNION rather than nullable `accountId`/`sessionId` fields,
 * because these are real variants: `kind` makes a handler that means "signed-in
 * human" say so, and makes the compiler refuse to read `accountId` off a
 * display.
 */
export interface ScreenIdentity extends IdentityBase {
    kind: 'screen';
    actorPersonId: null;
    screenId: string;
    screenName: string;
    /** Rooms this screen may show. EMPTY MEANS EVERY ROOM in the tenant. */
    roomIds: string[];
}

/**
 * A script or integration, acting through a bearer API token
 * (`Authorization: Bearer …`) minted at POST /api/me/api-tokens.
 *
 * UNLIKE a screen this HAS an acting Person — the token is that Person's own
 * authority, delegated — so permission checks pass, which is the feature. What
 * keeps it least-privilege is `heldPermissions()`: for this kind it intersects
 * the Person's LIVE permissions with `grantedPermissions`, the subset selected
 * at creation. Both sides narrow: the token cannot outgrow its ceiling, and it
 * cannot keep authority its Person has lost since.
 *
 * A token can never mint or revoke tokens — the /api/me/api-tokens routes
 * require `kind === 'account'` — or a leaked short-lived one could launder
 * itself into a permanent one.
 */
export interface TokenIdentity extends IdentityBase {
    kind: 'token';
    actorPersonId: string;
    tokenId: string;
    /** Ceiling selected at creation — a subset of what the creator held then. */
    grantedPermissions: string[];
}

/**
 * The background solver poller — CLAUDE.md's third tenant-isolation exception.
 *
 * It runs when nobody is logged in, so there is no account and no session, and
 * it acts as no Person. It had been constructing an `AccountIdentity` with
 * `accountId: ''` and `sessionId: ''`, which the flat type permitted and which
 * said something untrue about what was making the request; the union made it a
 * compile error and this variant is the honest answer. Like a screen, it holds
 * no acting Person and therefore no permissions — which it has never needed.
 */
export interface SystemIdentity extends IdentityBase {
    kind: 'system';
    actorPersonId: null;
    /** What is running, for logs — never authority. */
    reason: 'solver-poller';
}

/**
 * A calendar app streaming one Person's own Sessions, acting through the
 * secret in an ics_link URL (issue #15, stream half).
 *
 * HAS an acting Person, like a token — the stream is always exactly one
 * Person's own timetable — but grants NO permission of any kind. Two things
 * make that hold, and both are load-bearing:
 *
 *  1. `heldPermissions()` refuses outright for `kind === 'ics_link'`, the same
 *     way it refuses a null `actorPersonId` — see that function's own note.
 *  2. UNLIKE every other variant, this one is never produced by the global
 *     resolver chain (`activeResolver`, below) — only
 *     `GET /api/ics/stream.ics` constructs it, from its OWN reading of the
 *     `token` query parameter, and calls `withTenant()` directly rather than
 *     going through `event.context.identity`. A stray `?token=<this-secret>`
 *     on any OTHER route therefore resolves as whatever that route's own
 *     cookie/header/key would have given it (typically nothing) — never as
 *     this Person. Wiring it into `activeResolver` instead was tried and
 *     reverted: `actorPersonId` being non-null is exactly what every
 *     `/api/me/*` route (settings, preferences, availability) uses to act as
 *     the caller with NO further permission check, so a globally-resolved
 *     ics_link would have let a leaked calendar-subscription link — a secret
 *     designed to be pasted into third-party apps, not guarded like a
 *     password — submit unavailability or change settings as that Person.
 */
export interface IcsLinkIdentity extends IdentityBase {
    kind: 'ics_link';
    actorPersonId: string;
    linkId: string;
    scope: 'ALL' | 'TERM';
    termId: string | null;
    weeksAhead: number | null;
    /**
     * The SUBJECT (issue #115), orthogonal to `scope`'s time window: empty
     * means "this Person's own Sessions" (`ownSessionClause`, unchanged since
     * issue #15); one or more Group ids means those Groups' Sessions instead,
     * via the same ancestor-closure `ownSessionClause` walks for a member's
     * own timetable — see `GET /api/ics/stream.ics`'s own comment.
     */
    groupIds: string[];
}

/**
 * Every principal that can act INSIDE a tenant. The common shape every one of
 * these carries (`tenantId`, `federationId`, `actorPersonId`) is what lets
 * `withTenant()`/`withRequestTenant()` (`tenantDb.ts`) open an RLS context
 * generically, without a per-kind branch.
 */
export type TenantScopedIdentity = AccountIdentity | TokenIdentity | ScreenIdentity | SystemIdentity | IcsLinkIdentity;

/**
 * Calendry's OWN staff, acting through their own session cookie
 * (`STAFF_SESSION_COOKIE`) — issue #76, the FOURTH tenant-isolation exception
 * (CLAUDE.md, "The deliberate exceptions to tenant isolation";
 * DECISIONS.md, "Staff principal — the fourth tenant-isolation exception").
 *
 * DELIBERATELY DOES NOT EXTEND `IdentityBase`: a staff principal has no
 * tenant, not "not yet chosen one" the way a fresh Account session does — it
 * is never IN a tenant at all. That is not a detail, it is the whole point of
 * the type: `withTenant()` takes a `TenantScopedIdentity`, which this is not
 * a member of, so passing a `StaffIdentity` to it is a COMPILE ERROR, not a
 * runtime check somebody has to remember to write. `withRequestTenant()`
 * narrows `RequestIdentity` down to `TenantScopedIdentity` by refusing
 * `kind === 'staff'` before it ever calls `withTenant()` — see that function.
 *
 * `actorPersonId` is `null` and always will be, exactly like `ScreenIdentity`
 * above and for the identical reason: `heldPermissions()` throws 403 when
 * there is no acting Person, so a staff session cannot satisfy ANY tenant
 * permission check — including one added years from now by somebody who has
 * never heard of staff accounts. A staff principal's authority is "may call
 * `server/api/staff/*`, which reads/writes across every tenant through the
 * OWNER database connection" and NOTHING about any one tenant's data model.
 * Never give it an `actorPersonId` to make a check pass.
 */
export interface StaffIdentity {
    kind: 'staff';
    actorPersonId: null;
    staffAccountId: string;
    staffSessionId: string;
}

/**
 * Every principal this app recognises: a human with a session, a script with
 * a bearer token, a device with a key, a calendar app with a stream link, the
 * background job, and Calendry's own staff.
 *
 * Only `account` and `token` can hold permissions, because only they have an
 * acting Person AND route their checks through `heldPermissions()`, which
 * refuses without one — the token's set is further intersected with its
 * stored ceiling. `ics_link` also has an acting Person, but is refused by
 * `heldPermissions()` explicitly, AND — unlike every other member — is never
 * attached by the global resolver chain at all; see its own comment. `staff`
 * has NO acting Person and is refused the same way `screen`/`system` are —
 * and additionally can never even reach `heldPermissions()`, because it is
 * not a `TenantScopedIdentity` at all; see its own comment.
 */
export type RequestIdentity = TenantScopedIdentity | StaffIdentity;

/**
 * A tenant resolver turns an inbound request into a RequestIdentity, or returns
 * null when identity cannot be established.
 *
 * This indirection exists so that changing how identity works is a one-line
 * change to `activeResolver` rather than a hunt for scattered header or cookie
 * reads. Nothing outside this file may read identity off a request.
 */
export type TenantResolver = (event: H3Event) => Promise<RequestIdentity | null>;

/**
 * Session-cookie resolver.
 *
 * The tenant is derived server-side from the session's active Person — the
 * client supplies only an opaque token and cannot influence which tenant it
 * ends up in. This is what replaced the Step 4 development header resolver,
 * where any caller could assume any tenant simply by setting a header.
 *
 * A session with no active Person (an account with several tenants that has not
 * yet chosen one) resolves to null: authenticated, but not yet situated in a
 * tenant. Those requests are rejected by `requireIdentity` and must call
 * POST /api/auth/select-tenant first.
 */
const sessionCookieResolver: TenantResolver = async (event) => {
    const token = getCookie(event, SESSION_COOKIE);

    if (!token) {
        return null;
    }

    const session = await resolveSessionToken(token);

    if (!session || !session.person_id || !session.tenant_id || !session.person_active) {
        return null;
    }

    return {
        kind: 'account',
        tenantId: session.tenant_id,
        federationId: session.federation_id,
        actorPersonId: session.person_id,
        accountId: session.account_id,
        sessionId: session.session_id,
    };
};

/**
 * Screen-key resolver, tried only when there is no session cookie.
 *
 * ORDER MATTERS AND IS DELIBERATE: a signed-in human at a screen URL stays
 * themselves. Letting a key downgrade a real session would be a way to shed
 * permissions accidentally, and worse, would make "what am I acting as" depend
 * on a query parameter.
 *
 * The key travels in the query string because a wall-mounted display is
 * configured once by typing a URL and never touched again — there is nowhere to
 * put a header. That makes the URL itself the secret, which is why it is
 * revocable, scoped to rooms, and holds no permissions: the realistic failure is
 * somebody photographing the address bar, and the worst that buys them is the
 * timetable already displayed on the wall behind them.
 */
const screenKeyResolver: TenantResolver = async (event) => {
    const key = getQuery(event).key;

    if (typeof key !== 'string' || !key) {
        return null;
    }

    const screen = await resolveScreenKey(key);

    // An inactive screen resolves to nothing: revocation has to mean revoked,
    // and the board route reports that separately so the display can say why.
    if (!screen || !screen.is_active) {
        return null;
    }

    return {
        kind: 'screen',
        tenantId: screen.tenant_id,
        federationId: screen.federation_id,
        actorPersonId: null,
        screenId: screen.screen_id,
        screenName: screen.name,
        roomIds: screen.room_ids,
    };
};

/**
 * Bearer-token resolver, tried only when there is no session cookie — the same
 * ordering rationale as screens: a signed-in human stays themselves, and "what
 * am I acting as" never depends on a stray header.
 *
 * Revoked, expired, and Person-deactivated tokens all resolve to null, which
 * the middleware answers with a plain 401. Deliberately indistinguishable from
 * "no such token": a more specific answer would let an unauthenticated caller
 * probe which secrets exist.
 */
const apiTokenResolver: TenantResolver = async (event) => {
    const header = getRequestHeader(event, 'authorization');

    if (!header?.startsWith('Bearer ')) {
        return null;
    }

    const secret = header.slice('Bearer '.length).trim();

    if (!secret) {
        return null;
    }

    const token = await resolveApiToken(secret);

    if (!token || !token.is_active || !token.person_active) {
        return null;
    }

    if (token.expires_at && token.expires_at.getTime() <= Date.now()) {
        return null;
    }

    // Liveness stamp ("is anything still using this?"), throttled in SQL.
    await touchApiToken(token.token_id);

    return {
        kind: 'token',
        tenantId: token.tenant_id,
        federationId: token.federation_id,
        actorPersonId: token.person_id,
        tokenId: token.token_id,
        grantedPermissions: token.permissions,
    };
};

/**
 * Staff-cookie resolver — issue #76. Tried only for `/api/staff/*` and
 * `/api/staff-auth/*` (see `isStaffPath` below), never for anything else.
 *
 * WAS TRIED FIRST FOR EVERY `/api/*` ROUTE, UNCONDITIONALLY, until the bug
 * this comment now documents: a browser carrying BOTH a valid staff cookie
 * and a valid tenant session cookie — a Calendry staff member who is ALSO a
 * signed-in tenant user, in the same browser — resolved as `staff` on every
 * request, because `??` short-circuits on the first successful resolver and
 * `sessionCookieResolver` was never even reached. `withRequestTenant()` (see
 * its own comment) correctly refuses `kind === 'staff'`, so the visible
 * symptom was every tenant-scoped route 403ing with "A staff session cannot
 * access tenant-scoped routes" — for a request whose tenant cookie was
 * entirely valid. `GET /api/auth/session` reads `SESSION_COOKIE` directly
 * rather than going through this resolver, so the client-side route guard
 * (`auth.global.ts`) never caught this: the page loaded, then every API call
 * behind it failed.
 *
 * A `StaffIdentity` cannot satisfy a single tenant permission check (see its
 * own comment) and is refused outright by every `/api/*` route that is not
 * under `server/api/staff/*` (`requireStaffIdentity`) or
 * `server/api/staff-auth/*` (public) — so the staff cookie was NEVER capable
 * of doing anything on a non-staff route besides displacing a valid tenant
 * identity that would otherwise have resolved. Restricting it to staff paths
 * removes that displacement entirely rather than trading it for a different
 * ordering: a dual-cookie browser now resolves as `staff` on staff routes and
 * as its tenant identity everywhere else, which is what both cookies actually
 * describe — exactly one principal per request, unambiguously, decided by
 * the path rather than by which resolver happened to run first.
 */
const staffCookieResolver: TenantResolver = async (event) => {
    const token = getCookie(event, STAFF_SESSION_COOKIE);

    if (!token) {
        return null;
    }

    const session = await resolveStaffSessionToken(token);

    if (!session) {
        return null;
    }

    return {
        kind: 'staff',
        actorPersonId: null,
        staffAccountId: session.staff_account_id,
        staffSessionId: session.session_id,
    };
};

/**
 * ics_link resolver — DELIBERATELY NOT part of `activeResolver` below. Every
 * other resolver in this file is safe to attach to `event.context.identity`
 * for ANY `/api/*` route, because the middleware runs before routing decides
 * which handler answers. This one is not: see `IcsLinkIdentity`'s own comment
 * for why a globally-resolved ics_link would let a leaked calendar-
 * subscription link act on `/api/me/*` routes with no permission check at
 * all. `GET /api/ics/stream.ics` is the ONLY caller — it reads `token` and
 * calls `withTenant()` directly, never through `withRequestTenant()`.
 *
 * The token travels in the query string for the same reason a screen key
 * does: an external calendar app is configured once by pasting a URL and then
 * left to refetch it unattended — there is nowhere to put a header.
 * Revoked/deleted/deactivated resolves to null; the stream route answers with
 * a plain 401 rather than naming which case it was, the same reasoning the
 * API-token resolver gives below.
 */
export const icsLinkResolver: TenantResolver = async (event) => {
    const token = getQuery(event).token;

    if (typeof token !== 'string' || !token) {
        return null;
    }

    const link = await resolveIcsLink(token);

    if (!link || !link.person_active) {
        return null;
    }

    // Liveness stamp ("is anything still using this?"), throttled in SQL.
    await touchIcsLink(link.link_id);

    return {
        kind: 'ics_link',
        tenantId: link.tenant_id,
        federationId: link.federation_id,
        actorPersonId: link.person_id,
        linkId: link.link_id,
        scope: link.scope,
        termId: link.term_id,
        weeksAhead: link.weeks_ahead,
        groupIds: link.group_ids,
    };
};

/** Matches `server/api/staff/*` and `server/api/staff-auth/*` — see `staffCookieResolver`'s own comment. */
function isStaffPath(event: H3Event): boolean {
    const path = (event.path ?? '').split('?')[0] ?? '';

    return path.startsWith('/api/staff/') || path.startsWith('/api/staff-auth/');
}

/**
 * The single swap point for the routes THIS middleware covers.
 * `icsLinkResolver` is intentionally excluded — see its own comment.
 */
const activeResolver: TenantResolver = async (event) => (
    (isStaffPath(event) ? await staffCookieResolver(event) : null)
        ?? await sessionCookieResolver(event)
        ?? await apiTokenResolver(event)
        ?? screenKeyResolver(event)
);

export async function resolveIdentity(event: H3Event): Promise<RequestIdentity | null> {
    return activeResolver(event);
}
