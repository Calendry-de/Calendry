import type { H3Event } from 'h3';
import { SESSION_COOKIE } from './auth';
import { resolveScreenKey, resolveSessionToken } from './authDb';

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
 * Every principal this app recognises. Exactly three, matching the three ways a
 * request can arrive: a human with a session, a device with a key, and the
 * background job.
 *
 * Only the first can hold permissions, because only the first has an acting
 * Person and `heldPermissions()` refuses without one.
 */
export type RequestIdentity = AccountIdentity | ScreenIdentity | SystemIdentity;

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

/** The single swap point. Replace this binding to change how identity works. */
const activeResolver: TenantResolver = async (event) => (
    await sessionCookieResolver(event) ?? screenKeyResolver(event)
);

export async function resolveIdentity(event: H3Event): Promise<RequestIdentity | null> {
    return activeResolver(event);
}
