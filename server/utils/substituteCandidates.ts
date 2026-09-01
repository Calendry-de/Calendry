import type { Tx } from './tenantDb';
import { LECTURER_ROLE_KEY } from '../../shared/roles';

/**
 * Who may cover a Session's occurrence — issue #30, "Substitutions".
 *
 * SCOPE: filters the picker to people who are FREE at the Session's own slot,
 * mirroring `no_double_booking_lecturer` (`server/utils/violations.ts`) but
 * applied BEFORE a clash can be created rather than warned about after — the
 * ticket's own words. Restricted to holders of the tenant's `lecturer` Role,
 * matching every other "who can teach" lookup in this codebase
 * (`lecturers.post.ts`, `affected-persons.get.ts`, `solverInput.ts`).
 */

export interface SubstituteCandidate {
    id: string;
    givenName: string;
    familyName: string;
    email: string | null;
}

/** The placement fields needed to find what else occupies the same slot. */
export interface SlotSession {
    id: string;
    termId: string;
    termWeek: number;
    dayOfWeek: number;
    blockIndex: number;
    durationBlocks: number;
}

interface SlotOptions {
    tenantId: string;
    /** Set when the tenant belongs to a Federation, so shared Sessions count. */
    federationId?: string | null;
    session: SlotSession;
}

/** Half-open block ranges [start, start+duration) overlap. */
function blocksOverlap(a: { blockIndex: number; durationBlocks: number }, b: { blockIndex: number; durationBlocks: number }): boolean {
    return a.blockIndex < b.blockIndex + b.durationBlocks && b.blockIndex < a.blockIndex + a.durationBlocks;
}

/** Every OTHER Session in the same (term, week, day) that overlaps this one's blocks. */
async function overlappingSessionIds(tx: Tx, options: SlotOptions): Promise<string[]> {
    const { tenantId, federationId = null, session } = options;
    const visibleToTenant = federationId ? [{ tenantId }, { federationId }] : [{ tenantId }];

    const sameDay = await tx.session.findMany({
        where: {
            OR: visibleToTenant,
            termId: session.termId,
            termWeek: session.termWeek,
            dayOfWeek: session.dayOfWeek,
            id: { not: session.id },
        },
        select: { id: true, blockIndex: true, durationBlocks: true },
    });

    return sameDay.filter((other) => blocksOverlap(session, other)).map((other) => other.id);
}

/**
 * Everyone who cannot cover this Session right now: already attached to it
 * (lecturer or otherwise — re-substituting somebody already on the roster is
 * meaningless), OR attached to / already COVERING a Session that overlaps its
 * slot. The second half is checked against BOTH `session_person` and
 * `session_substitution` — a person standing in for one Session at 10:00 is
 * exactly as unavailable for another at 10:00 as someone with a real
 * `session_person` row, and checking only the first table would let one
 * person cover two clashing Sessions at once.
 */
async function busyPersonIds(tx: Tx, options: SlotOptions): Promise<Set<string>> {
    const overlappingIds = await overlappingSessionIds(tx, options);

    // Sequential — `tx` is one shared connection; concurrent queries on it
    // trip pg's deprecated overlapping-query warning.
    const attachedHere = await tx.sessionPerson.findMany({
        where: { sessionId: options.session.id }, select: { personId: true },
    });
    const busyElsewhere = overlappingIds.length
        ? await tx.sessionPerson.findMany({ where: { sessionId: { in: overlappingIds } }, select: { personId: true } })
        : [];
    const coveringElsewhere = overlappingIds.length
        ? await tx.sessionSubstitution.findMany({ where: { sessionId: { in: overlappingIds } }, select: { coveringPersonId: true } })
        : [];

    return new Set([
        ...attachedHere.map((p) => p.personId),
        ...busyElsewhere.map((p) => p.personId),
        ...coveringElsewhere.map((p) => p.coveringPersonId),
    ]);
}

/**
 * The tenant's `lecturer` Role, or a named refusal — matching
 * `lecturers.post.ts`'s handling of the same precondition.
 */
async function requireLecturerRole(tx: Tx, tenantId: string): Promise<{ id: string }> {
    const role = await tx.role.findFirst({ where: { tenantId, key: LECTURER_ROLE_KEY }, select: { id: true } });

    if (!role) {
        throw createError({
            statusCode: 422,
            statusMessage: "This tenant has no 'lecturer' role configured, so nobody can be offered as a substitute.",
        });
    }

    return role;
}

/** A page of free, search-matching candidates — the inspector's picker. */
export async function freeSubstituteCandidates(tx: Tx, options: SlotOptions & {
    query?: string;
    limit?: number;
}): Promise<{ rows: SubstituteCandidate[]; total: number }> {
    const role = await requireLecturerRole(tx, options.tenantId);
    const excluded = await busyPersonIds(tx, options);
    const trimmed = options.query?.trim();

    const where = {
        tenantId: options.tenantId,
        ...(excluded.size ? { id: { notIn: [...excluded] } } : {}),
        personRoles: { some: { roleId: role.id } },
        ...(trimmed
            ? {
                OR: [
                    { givenName: { contains: trimmed, mode: 'insensitive' as const } },
                    { familyName: { contains: trimmed, mode: 'insensitive' as const } },
                    { email: { contains: trimmed, mode: 'insensitive' as const } },
                ],
            }
            : {}),
    };

    // Sequential — `tx` is one shared connection; concurrent queries on it
    // trip pg's deprecated overlapping-query warning.
    const rows = await tx.person.findMany({
        where,
        select: { id: true, givenName: true, familyName: true, email: true },
        orderBy: [{ familyName: 'asc' }, { givenName: 'asc' }],
        take: options.limit ?? 20,
    });
    const total = await tx.person.count({ where });

    return { rows, total };
}

/**
 * Re-checked at WRITE time, not just trusted from the picker's earlier fetch —
 * the list can go stale between a fetch and a click, and a substitute created
 * double-booked is exactly the outcome this ticket asked to prevent BEFORE
 * creation, never warn about after (contrast `refreshViolations`'s
 * warn-and-allow, which is for placements, not for this overlay).
 *
 * ASSUMES THE CALLER ALREADY CONFIRMED `personId` EXISTS IN THIS TENANT — same
 * split as `lecturers.post.ts`: "not found" (404) and "not qualified" (422)
 * are different problems, and folding them into one query here would report
 * another tenant's person as "lacks the lecturer role" instead of missing.
 */
export async function assertFreeForSubstitution(
    tx: Tx,
    options: SlotOptions & { personId: string },
): Promise<void> {
    const role = await requireLecturerRole(tx, options.tenantId);

    const holdsRole = await tx.personRole.findFirst({
        where: { personId: options.personId, roleId: role.id },
        select: { id: true },
    });

    if (!holdsRole) {
        throw createError({
            statusCode: 422,
            statusMessage: "This person does not hold the tenant's lecturer role, so they cannot cover a session.",
            data: { field: 'personId' },
        });
    }

    const excluded = await busyPersonIds(tx, options);

    if (excluded.has(options.personId)) {
        throw createError({
            statusCode: 409,
            statusMessage: 'This person is already teaching, or covering another session, at that slot.',
            data: { field: 'personId' },
        });
    }
}
