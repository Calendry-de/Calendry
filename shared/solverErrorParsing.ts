/**
 * Parses the ONE error shape the solver's gRPC rejections actually take,
 * as `@grpc/grpc-js` formats an error's `message`:
 *
 *   3 INVALID_ARGUMENT: constraint '01a06251-77b2-701c-873e-53d6e65ec21e':
 *   MinimizeBlockUsage selects no blocks - set at least one index, or `first`/`last`
 *
 * `SolverRejectedError.message` (`server/utils/solverClient.ts`) is exactly
 * this string, stored verbatim in `solver_run.error_detail`. Parsing happens
 * ON READ, never on write: the raw string is what is stored, so a future
 * message the pattern does not match still reads as itself, not as an empty
 * field.
 *
 * Pure and dependency-free so it can run in the browser too, on a run's
 * already-fetched `errorDetail` — resolving `subjectId` to a display name
 * still needs the database and is `server/utils/solverErrorMapping.ts`'s job.
 */
export interface ParsedSolverError {
    grpcCode: number;
    grpcStatus: string;
    subjectType: string;
    subjectId: string;
    message: string;
}

/**
 * `ParsedSolverError` plus the named entity's current display name, resolved
 * server-side (`server/utils/solverErrorMapping.ts`, which needs the
 * database). Declared here, not there, so the client can type a run's
 * `parsedError` field without importing a server-only module.
 */
export interface ResolvedSolverError extends ParsedSolverError {
    /** `null` when the subject could not be resolved (deleted, or an unlisted subjectType). */
    subjectName: string | null;
}

const SOLVER_ERROR_PATTERN = /^(\d+)\s+([A-Z_]+):\s+(\S+)\s+'([^']+)':\s*(.+)$/s;

export function parseSolverError(raw: string | null | undefined): ParsedSolverError | null {
    if (!raw) {
        return null;
    }

    const match = SOLVER_ERROR_PATTERN.exec(raw.trim());

    if (!match) {
        return null;
    }

    const [, code, status, subjectType, subjectId, message] = match;

    return {
        grpcCode: Number(code),
        grpcStatus: status!,
        subjectType: subjectType!,
        subjectId: subjectId!,
        message: message!.trim(),
    };
}
