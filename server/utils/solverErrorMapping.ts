import type { Tx } from './tenantDb';
import { serializeRun } from './solverClient';
import { type ResolvedSolverError, parseSolverError } from '../../shared/solverErrorParsing';

export type { ResolvedSolverError };

/**
 * How to turn a parsed error's `subjectId` into something a person recognises,
 * per `subjectType`. Not exhaustive: an unlisted (or since-deleted) subject
 * resolves to `null`, which the UI shows as "(no longer exists)" rather than
 * failing to render the rest of the message.
 */
const SUBJECT_LOOKUPS: Record<string, (tx: Tx, id: string) => Promise<string | null>> = {
    constraint: async (tx, id) => (
        await tx.constraint.findFirst({ where: { id }, select: { name: true } })
    )?.name ?? null,
    offering: async (tx, id) => (
        await tx.offering.findFirst({ where: { id }, select: { title: true } })
    )?.title ?? null,
    room: async (tx, id) => {
        const room = await tx.room.findFirst({ where: { id }, select: { code: true, name: true } });

        return room ? `${room.code} · ${room.name}` : null;
    },
    session: async (tx, id) => (
        await tx.session.findFirst({ where: { id }, select: { id: true } })
    )?.id ?? null,
    group: async (tx, id) => (
        await tx.group.findFirst({ where: { id }, select: { name: true } })
    )?.name ?? null,
    person: async (tx, id) => {
        const person = await tx.person.findFirst({ where: { id }, select: { givenName: true, familyName: true } });

        return person ? `${person.givenName} ${person.familyName}` : null;
    },
};

/**
 * `parseSolverError` plus a display-name lookup for whatever it named.
 *
 * `null` whenever the raw string does not match the one shape the solver
 * actually sends (see `parseSolverError`), OR when there is nothing to parse
 * at all: the caller falls back to the raw `errorDetail` either way, so a
 * message this app has never seen degrades to "shown verbatim", not "hidden".
 */
export async function resolveSolverError(
    tx: Tx,
    errorDetail: string | null | undefined,
): Promise<ResolvedSolverError | null> {
    const parsed = parseSolverError(errorDetail);

    if (!parsed) {
        return null;
    }

    const lookup = SUBJECT_LOOKUPS[parsed.subjectType];
    let subjectName: string | null = null;

    if (lookup) {
        try {
            subjectName = await lookup(tx, parsed.subjectId);
        } catch {
            // The parse itself is worth more than the name: a lookup failure
            // (a malformed id, a transient issue) must not hide the reason.
            subjectName = null;
        }
    }

    return { ...parsed, subjectName };
}

/**
 * `serializeRun` plus the resolved error, for every route that renders a run
 * to a person rather than merely storing it. Skips the lookup entirely when
 * there is no `errorDetail`, which is every non-FAILED run.
 */
export async function serializeRunWithError<T extends Record<string, unknown> & { errorDetail?: string | null }>(
    tx: Tx,
    run: T,
): Promise<Record<string, unknown>> {
    return {
        ...serializeRun(run),
        parsedError: run.errorDetail ? await resolveSolverError(tx, run.errorDetail) : null,
    };
}
