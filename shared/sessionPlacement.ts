/**
 * The single definition of "does this Session have a real placement"
 * (issue #22, cancel-to-spare-bank). `term_week` / `day_of_week` / `block_index`
 * are NULLABLE TOGETHER — the `session_placement_sane` CHECK enforces
 * all-or-nothing — so a Session is either placed (all three set) or banked
 * (all three null), never a mix.
 *
 * Shared between server (solver assembly, generation materialize, the editing
 * routes) and client (grid partitioning, the inspector) so the two cannot
 * disagree about what "placed" means — the same reason `sessionReadScope()`
 * is one function rather than two. Generic over `T` so it narrows whichever
 * shape a caller already has (a Prisma row, `ScheduleSession`, a raw
 * `$queryRaw` projection) rather than forcing a conversion first.
 */
export interface SessionPlacementFields {
    termWeek: number | null;
    dayOfWeek: number | null;
    blockIndex: number | null;
}

/** `T`, with the placement fields narrowed to their non-null case. */
export type Placed<T extends SessionPlacementFields> = T & {
    termWeek: number;
    dayOfWeek: number;
    blockIndex: number;
};

/**
 * Type guard: true when `session` has a real placement. Checking all three
 * fields, not just one, is deliberate — the CHECK constraint promises they
 * move together, but a guard that trusted that promise silently rather than
 * verifying it would stop being a guard the day something writes around it.
 */
export function isPlacedSession<T extends SessionPlacementFields>(session: T): session is Placed<T> {
    return session.termWeek !== null && session.dayOfWeek !== null && session.blockIndex !== null;
}

/** The complement of `isPlacedSession` — spelled out at call sites for clarity. */
export function isBankedSession(session: SessionPlacementFields): boolean {
    return session.termWeek === null;
}
