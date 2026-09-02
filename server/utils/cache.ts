import { existsSync } from 'node:fs';
import Redis from 'ioredis';

/**
 * Thin Redis wrapper for issue #66: a read-through cache for calendar reads,
 * invalidated on schedule changes. See `scheduleCache.ts` for the domain-level
 * key shapes and invalidation entry point; this file only knows about Redis.
 *
 * FAILS OPEN, always. A cache outage must never take the schedule view down
 * with it: every Redis call here is wrapped so a connection error falls
 * through to calling `fetcher()` directly, exactly as if there were no cache
 * at all. That is the one property this module exists to guarantee; get it
 * wrong and a Redis blip becomes a 500 on every page that reads a timetable.
 */

/**
 * Two addresses for one service, the same `/.dockerenv` pattern
 * `solverAddress()` (server/utils/solverClient.ts) and `ownerDatabaseUrl.ts`
 * already use for the solver and the database: `redis` resolves only on the
 * compose network, while host-run tooling needs the published port.
 */
function redisUrl(): string {
    const inContainer = existsSync('/.dockerenv');

    if (inContainer) {
        return process.env.REDIS_URL ?? 'redis://redis:6379';
    }

    return process.env.REDIS_URL_HOST ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
}

let client: Redis | undefined;
let lastErrorLoggedAt = 0;

/** Rate-limited so a sustained outage logs a line every 30s, not once per request. */
function logRedisFailure(context: string, error: unknown): void {
    const now = Date.now();

    if (now - lastErrorLoggedAt > 30_000) {
        lastErrorLoggedAt = now;
        console.error(`[cache] Redis ${context}, falling through to Postgres directly:`, error);
    }
}

function getClient(): Redis {
    if (!client) {
        client = new Redis(redisUrl(), {
            // Lazy: the first real call connects, rather than every process
            // that imports this module (scripts, tests) opening a socket.
            lazyConnect: true,
            // A disconnected client must fail FAST, not queue commands that
            // resolve only once Redis comes back; that would turn a cache
            // outage into every request hanging instead of degrading.
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1,
            retryStrategy: (times) => Math.min(times * 200, 2000),
        });

        // ioredis crashes the process on an unhandled 'error' event.
        // Reconnection is handled by retryStrategy above; this only logs.
        client.on('error', (error) => logRedisFailure('connection error', error));
    }

    return client;
}

/**
 * `true` once safe to issue a command this call. Never blocks waiting for a
 * reconnect already in progress. States other than the two handled here mean
 * ioredis is already mid-attempt, so this reports "not available yet" and lets
 * the caller fall through, rather than piling up connect() calls.
 */
async function ensureConnected(redis: Redis): Promise<boolean> {
    if (redis.status === 'ready') {
        return true;
    }

    if (redis.status === 'wait' || redis.status === 'end') {
        try {
            await redis.connect();

            return true;
        } catch (error) {
            logRedisFailure('connect failed', error);

            return false;
        }
    }

    return false;
}

/**
 * Read-through cache. A hit returns the cached value; a miss calls `fetcher`,
 * caches the result for `ttlSeconds`, and returns it: same shape either way,
 * cold cache or warm.
 *
 * Concurrent misses on the same key both call `fetcher` (a "thundering herd"
 * double-fetch) rather than coalescing; acceptable for this scope, see
 * issue #66.
 */
export async function getCached<T>(key: string, fetcher: () => Promise<T>, ttlSeconds: number): Promise<T> {
    const redis = getClient();
    const available = await ensureConnected(redis).catch(() => false);

    if (available) {
        try {
            const cached = await redis.get(key);

            if (cached !== null) {
                return JSON.parse(cached) as T;
            }
        } catch (error) {
            logRedisFailure('GET failed', error);
        }
    }

    const value = await fetcher();

    if (available) {
        try {
            await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
        } catch (error) {
            logRedisFailure('SET failed', error);
        }
    }

    return value;
}

/**
 * Deletes every key starting with `keyOrPrefix`, a safe no-op if none exist
 * (never cached, or already invalidated). Always prefix-matched via SCAN
 * rather than a single DEL: every key this module writes is built to be a
 * valid prefix for itself, and invalidation is deliberately generous (see
 * `scheduleCache.ts`): callers pass a prefix covering everything that might
 * be stale, not one exact key.
 */
export async function invalidate(keyOrPrefix: string): Promise<void> {
    const redis = getClient();
    const available = await ensureConnected(redis).catch(() => false);

    if (!available) {
        return;
    }

    try {
        const stream = redis.scanStream({ match: `${keyOrPrefix}*`, count: 200 });
        const toDelete: string[] = [];

        for await (const keys of stream as AsyncIterable<string[]>) {
            toDelete.push(...keys);
        }

        if (toDelete.length) {
            await redis.unlink(...toDelete);
        }
    } catch (error) {
        logRedisFailure('invalidate failed', error);
    }
}
