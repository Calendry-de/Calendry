import type { Prisma } from '@prisma/client';
import type { Tx } from './tenantDb';
import type { TenantScopedIdentity } from './tenantResolver';
import { invalidateScheduleCache } from './scheduleCache';

export type EventType =
    | 'CREATE' | 'MOVE' | 'SWAP' | 'DELETE' | 'UPDATE_DETAILS' | 'SET_LECTURERS'
    | 'LOCK' | 'UNLOCK' | 'APPLY_GENERATION' | 'SUBSTITUTE' | 'BANK';

/**
 * Appends to the immutable edit log (TAXONOMY.md §3).
 *
 * The baseline Generation is required: an event is a delta *on top of* a
 * snapshot, so an event with no baseline could not be replayed. Payloads carry
 * full before/after state rather than references, so replay never depends on
 * rows that may have changed since.
 *
 * The database revokes UPDATE and DELETE on session_event from the runtime role
 * and enforces it again by trigger, so nothing written here can be rewritten.
 */
export async function appendEvent(
    tx: Tx,
    /**
     * Structurally `{ tenantId, actorPersonId }` rather than a full
     * `TenantScopedIdentity`, because those are the only two fields used and
     * the materialize layer has no request identity to offer; it runs from a
     * plan. A `TenantScopedIdentity` still satisfies this, so every existing
     * caller is unchanged. NOT `RequestIdentity` (issue #76): `StaffIdentity`
     * has no `tenantId` at all, and an event can never be attributed to a
     * principal that is not inside any tenant to begin with.
     */
    identity: Pick<TenantScopedIdentity, 'tenantId' | 'actorPersonId'>,
    input: {
        type: EventType;
        generationId: string;
        sessionId?: string | null;
        counterpartSessionId?: string | null;
        payload: Prisma.InputJsonObject;
        reason?: string | null;
    },
) {
    const created = await tx.sessionEvent.create({
        data: {
            tenantId: identity.tenantId,
            generationId: input.generationId,
            type: input.type,
            sessionId: input.sessionId ?? null,
            counterpartSessionId: input.counterpartSessionId ?? null,
            payload: input.payload,
            actorPersonId: identity.actorPersonId,
            reason: input.reason ?? null,
        },
    });

    /**
     * Cache invalidation for issue #66, hooked in HERE rather than at each of
     * this function's 14+ call sites. Every write that changes what a cached
     * schedule response would contain (a manual edit, a Generation apply, a
     * materialized solver result) appends a SessionEvent, so this is the one
     * choke point all of them already pass through. Finding and hooking each
     * call site individually is exactly the way to miss one, which the issue
     * calls out explicitly: "a stale cache is worse than no cache."
     *
     * The Generation's OWN `termId` decides the blast radius (null = a
     * tenant-wide Generation, so every bucket for the tenant is dropped);
     * see `invalidateScheduleCache`. Never allowed to fail the write: this
     * runs inside the same transaction as the event it is reacting to, and a
     * cache-invalidation problem must not become a reason a manual edit
     * fails to save.
     */
    try {
        const generation = await tx.generation.findUnique({
            where: { id: input.generationId },
            select: { termId: true },
        });

        await invalidateScheduleCache(identity.tenantId, generation?.termId ?? null);
    } catch (error) {
        console.error('[cache] schedule cache invalidation failed after appendEvent:', error);
    }

    // `seq` is a BigInt, which JSON.stringify refuses to serialize; returning
    // the row as-is makes every editing route throw at response time. Converted
    // here, at the single point events are created, rather than in each route.
    return { ...created, seq: created.seq.toString() };
}

/**
 * The Generation an edit hangs off. Falls back to the tenant's current baseline.
 * Editing before any Generation exists is refused rather than silently creating
 * one, because an implicit baseline would make history ambiguous.
 */
export async function requireBaselineGeneration(tx: Tx, tenantId: string, sessionGenerationId?: string | null) {
    if (sessionGenerationId) {
        return sessionGenerationId;
    }

    const current = await tx.generation.findFirst({
        where: { tenantId, isCurrent: true },
        select: { id: true },
    });

    if (!current) {
        throw createError({
            statusCode: 409,
            message: 'No current Generation to record this edit against. Apply a Generation first.',
        });
    }

    return current.id;
}

/**
 * Placement fields captured in event payloads.
 *
 * `termWeek`/`dayOfWeek`/`blockIndex` are nullable so this also accepts a
 * BANKED Session: `bank.post.ts` records the placement it is leaving in
 * exactly the same shape `move.post.ts` and `delete.ts` already use, and
 * `move.post.ts` records one going the other way. Every existing caller
 * passes an already-placed Session, so their payloads are unaffected;
 * nothing here loosens what gets WRITTEN, only what this helper is willing to
 * read.
 */
export function placementOf(session: {
    termId: string;
    termWeek: number | null;
    dayOfWeek: number | null;
    blockIndex: number | null;
    durationBlocks: number;
    timeGridId: string | null;
}) {
    return {
        termId: session.termId,
        termWeek: session.termWeek,
        dayOfWeek: session.dayOfWeek,
        blockIndex: session.blockIndex,
        durationBlocks: session.durationBlocks,
        timeGridId: session.timeGridId,
    };
}
