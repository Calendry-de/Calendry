import { connect } from 'node:net';
import { getPrisma } from '../utils/prisma';
import { solverAddress } from '../utils/solverClient';
import { logger } from '../utils/logger';

/**
 * Real liveness/readiness check — issue #92. Verifies the two external
 * dependencies a request can actually fail on, each under its own timeout, so
 * a hung dependency degrades this endpoint's ANSWER rather than hanging the
 * endpoint itself.
 *
 * Per-dependency status, not one boolean: "the database is down" and "the
 * solver is down" call for different responses from whoever is paged, and a
 * single `ok: false` would erase that distinction — the same "guards must
 * report, not merely fail" reasoning CLAUDE.md states for write-path guards
 * applies here to a read-only one.
 */

type CheckStatus = 'ok' | 'error';

/** A few seconds max, per CLAUDE.md's instruction for this endpoint. */
const CHECK_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
            setTimeout(() => reject(new Error(`${label} check timed out after ${ms}ms`)), ms);
        }),
    ]);
}

/**
 * `SELECT 1` on the RUNTIME role's own client (`getPrisma()`), the same one
 * `authDb.ts` uses for the pre-tenant plane — a health check has no tenant
 * context either, and this query touches no tenant-scoped table so it needs
 * none.
 */
async function checkDatabase(): Promise<CheckStatus> {
    try {
        await withTimeout(getPrisma().$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS, 'database');

        return 'ok';
    } catch (error) {
        logger.warn({ err: error }, 'Health check: database unreachable');

        return 'error';
    }
}

function parseAddress(address: string): { host: string; port: number } {
    const separatorIndex = address.lastIndexOf(':');

    if (separatorIndex === -1) {
        return { host: address, port: 0 };
    }

    return {
        host: address.slice(0, separatorIndex),
        port: Number(address.slice(separatorIndex + 1)),
    };
}

/**
 * `@calendry-de/calendry-proto`'s `SolverService` exposes no application-level
 * health/ping RPC — only `StartRun`/`GetStatus`/`CancelRun` (confirmed against
 * the generated `service.d.ts`), none of which is safe or free to call from a
 * health check. Falls back to a raw TCP connect against the same address the
 * app itself uses (`solverAddress()`), which at least proves the process is
 * listening — the documented fallback for exactly this gap.
 */
function probeSolverSocket(): Promise<CheckStatus> {
    return new Promise((resolve, reject) => {
        const { host, port } = parseAddress(solverAddress());
        const socket = connect({ host, port, timeout: CHECK_TIMEOUT_MS });

        const settle = (action: () => void) => {
            socket.destroy();
            action();
        };

        socket.once('connect', () => settle(() => resolve('ok')));
        socket.once('timeout', () => settle(() => reject(new Error('connection timed out'))));
        socket.once('error', (err) => settle(() => reject(err)));
    });
}

async function checkSolver(): Promise<CheckStatus> {
    try {
        return await withTimeout(probeSolverSocket(), CHECK_TIMEOUT_MS, 'solver');
    } catch (error) {
        logger.warn({ err: error, address: solverAddress() }, 'Health check: solver unreachable');

        return 'error';
    }
}

export default defineEventHandler(async (event) => {
    const [database, solver] = await Promise.all([checkDatabase(), checkSolver()]);

    const checks = { database, solver };
    const allOk = Object.values(checks).every((s) => s === 'ok');

    // 503 when degraded so a load balancer or orchestrator treats this
    // instance as unhealthy, rather than reading a 200 with a JSON body it
    // never inspects.
    event.node.res.statusCode = allOk ? 200 : 503;

    return { status: allOk ? 'ok' : 'degraded', checks };
});
