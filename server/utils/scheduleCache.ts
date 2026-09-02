import { invalidate } from './cache';

/**
 * Cache keys and invalidation for the calendar-read endpoints (issue #66):
 * `GET /api/ics/stream.ics`, `GET /api/sessions`, `GET /api/schedule/context`,
 * `GET /api/screens/board`.
 *
 * SCOPING. Every key is rooted at a tenant, then a "bucket": either a
 * specific Term id, or the literal string `all` for a response that is not
 * pinned to one Term (an `ics_link` with `scope: 'ALL'`, `/api/sessions` with
 * no `termId` filter, and the screen board, which resolves "today's" Term
 * itself rather than taking one as a parameter).
 *
 * INVALIDATION IS DELIBERATELY GENEROUS, per the issue: "over-invalidating
 * only costs a cache miss; under-invalidating serves a wrong answer."
 * `invalidateScheduleCache()` is the ONLY entry point, called from
 * `appendEvent()` (server/utils/sessionEvents.ts), the single choke point
 * every schedule-changing write already passes through (manual edits,
 * Generation apply, and a solver repair run's result, which only becomes
 * visible in the schedule once applied via the same route that calls
 * `appendEvent`). Given a Term id, it drops that Term's own bucket AND the
 * `all` bucket, since an all-Terms view's answer may include that Term. Given
 * no Term id (a tenant-wide Generation, a MANUAL_BASELINE or an import), it
 * drops every bucket for the tenant, term-specific or not.
 */

const CACHE_PREFIX = 'calendry:cache:v1';

/** Backstop only: event-driven invalidation above should almost always win. */
export const SCHEDULE_CACHE_TTL_SECONDS = 180;

type Bucket = string | 'all';

function bucketRoot(tenantId: string, bucket: Bucket): string {
    return `${CACHE_PREFIX}:${tenantId}:${bucket}:`;
}

function tenantRoot(tenantId: string): string {
    return `${CACHE_PREFIX}:${tenantId}:`;
}

function scheduleCacheKey(tenantId: string, bucket: Bucket, rest: string): string {
    return `${bucketRoot(tenantId, bucket)}${rest}`;
}

/** `GET /api/schedule/context`: always resolves to one concrete Term. */
export function contextCacheKey(options: {
    tenantId: string;
    termId: string;
    scope: 'any' | 'own';
    actorPersonId: string | null;
}): string {
    const who = options.scope === 'own' ? `:${options.actorPersonId}` : '';

    return scheduleCacheKey(options.tenantId, options.termId || 'all', `context:${options.scope}${who}`);
}

/**
 * `GET /api/sessions`: `termId` is an OPTIONAL query filter; omitting it
 * spans every Term the caller may see, so that response lives in the `all`
 * bucket rather than any one Term's.
 */
export function sessionsCacheKey(options: {
    tenantId: string;
    termId: string | undefined;
    scope: 'any' | 'own';
    actorPersonId: string | null;
    termWeek: number | undefined;
    groupId: string | undefined;
    includeNested: boolean | undefined;
    roomId: string | undefined;
    personId: string | undefined;
    offeringId: string | undefined;
    isLocked: boolean | undefined;
    banked: boolean | undefined;
}): string {
    const who = options.scope === 'own' ? `:${options.actorPersonId}` : '';
    const filters = [
        `tw=${options.termWeek ?? ''}`,
        `g=${options.groupId ?? ''}`,
        `n=${options.includeNested ?? ''}`,
        `r=${options.roomId ?? ''}`,
        `p=${options.personId ?? ''}`,
        `o=${options.offeringId ?? ''}`,
        `l=${options.isLocked ?? ''}`,
        `b=${options.banked ?? ''}`,
    ].join(':');

    return scheduleCacheKey(options.tenantId, options.termId ?? 'all', `sessions:${options.scope}${who}:${filters}`);
}

/**
 * `GET /api/ics/stream.ics`: keyed per `ics_link` id. A `TERM`-scoped link
 * lives in that Term's bucket; an `ALL`-scoped link (or the edge case of a
 * `TERM` link with no `termId`, which resolves zero Terms) lives in `all`,
 * since it draws from every Term.
 */
export function icsCacheKey(options: { tenantId: string; linkId: string; scope: 'ALL' | 'TERM'; termId: string | null }): string {
    const bucket = options.scope === 'TERM' && options.termId ? options.termId : 'all';

    return scheduleCacheKey(options.tenantId, bucket, `ics:${options.linkId}`);
}

/**
 * `GET /api/screens/board`: keyed per tenant + room-scope, as the issue
 * specifies. Bucketed under `all` rather than a Term: the route resolves
 * "today's" Term itself from the wall clock rather than taking one as an
 * input, so there is no Term id available at cache-key time.
 *
 * Deliberately excludes `screenName` and `generatedAt` from what gets cached
 * see the route, which computes those fresh on every call, cache hit or
 * not. Two screens can share a room scope (and so a cache key) while having
 * different names; caching the name would serve one screen's identity to the
 * other, which is exactly the "stale/wrong data rendering as if it were
 * correct" failure this file exists to avoid.
 */
export function boardCacheKey(options: { tenantId: string; roomIds: string[] }): string {
    const roomScope = options.roomIds.length ? [...options.roomIds].sort().join(',') : 'allrooms';

    return scheduleCacheKey(options.tenantId, 'all', `board:${roomScope}`);
}

/**
 * The single invalidation entry point, called from `appendEvent()`. `termId`
 * is the affected Generation's own `termId`, `null` for a tenant-wide one.
 */
export async function invalidateScheduleCache(tenantId: string, termId: string | null): Promise<void> {
    if (termId) {
        await invalidate(bucketRoot(tenantId, termId));
        await invalidate(bucketRoot(tenantId, 'all'));

        return;
    }

    // No Term to scope to: drop everything cached for this tenant.
    await invalidate(tenantRoot(tenantId));
}
