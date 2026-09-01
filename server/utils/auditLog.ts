import type { Prisma } from '@prisma/client';
import { getPrisma } from './prisma';

/**
 * The persisted security audit trail (issue #78): permission/AccessRole
 * changes, login attempts, and denied cross-tenant access.
 *
 * NO RLS, NO TENANT CONTEXT — this runs on the base Prisma client, the same
 * pattern `authDb.ts` already uses for the pre-tenant plane, and for a
 * related reason: a denied CROSS-TENANT attempt is by definition about more
 * than one tenant, so a write must not depend on any one tenant's RLS
 * context, and a cross-tenant audit read must not be blocked by it either.
 * See the `AuditLog` model comment in schema.prisma for the full argument.
 *
 * APPEND-ONLY, ON PURPOSE — there is no update or delete helper here, and the
 * table's own grant (the migration) only gives `calendry_app` SELECT/INSERT.
 * Two calls describing two genuinely separate events are correct as two rows;
 * this is never a place to deduplicate or upsert.
 */

export interface AuditLogParams {
    /** Free-form event key — see the `AuditLog.action` doc comment for examples. */
    action: string;
    outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
    /** The Person who performed the action, when one was resolved. Null for e.g. a login attempt against an email with no matching Account. */
    actorPersonId?: string | null;
    /** The Account that performed the action, when one was resolved. */
    actorAccountId?: string | null;
    /** Denormalized human-readable actor (name and/or email), captured now because the actor may be deleted later. */
    actorLabel?: string | null;
    /** What was acted on — free text; omit when the action names no target beyond the actor. */
    target?: string | null;
    /** The tenant this event belongs to, or — for a denied cross-tenant attempt — the tenant that was DENIED. Null for an event that predates tenant selection. */
    tenantId?: string | null;
    /** Action-specific context. Must be JSON-serializable. */
    detail?: Record<string, unknown>;
}

/**
 * Writes one append-only audit row.
 *
 * NEVER THROWS. The event being audited has already happened (or already been
 * denied) by the time this runs — a database hiccup on the audit write is not
 * a reason to turn a successful login, permission grant, or 403 into a 500.
 * Failures are reported to stderr instead, which is at least as visible as
 * every audit line was before this table existed.
 */
export async function writeAuditLog(params: AuditLogParams): Promise<void> {
    try {
        await getPrisma().auditLog.create({
            data: {
                action: params.action,
                outcome: params.outcome,
                actorPersonId: params.actorPersonId ?? null,
                actorAccountId: params.actorAccountId ?? null,
                actorLabel: params.actorLabel ?? null,
                target: params.target ?? null,
                tenantId: params.tenantId ?? null,
                detail: (params.detail ?? {}) as Prisma.InputJsonValue,
            },
        });
    } catch (err) {
        console.error(`AUDIT_WRITE_FAILED ${JSON.stringify({ ...params, error: String(err) })}`);
    }
}
