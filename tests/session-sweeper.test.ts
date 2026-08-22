import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolveOwnerDatabaseUrl } from '../scripts/lib/ownerDatabaseUrl';

/**
 * Expired-session cleanup.
 *
 * `auth_session` rows were never deleted: sessions are only ever looked up by
 * primary key or unique token hash, so a dead row was never in anyone's way —
 * it just accumulated, one per login, forever. Harmless and unbounded.
 *
 * WHAT THESE PIN, AND WHY EACH MATTERS
 *
 * The predicate is `expires_at < now() - 30 days` and nothing else. It has to
 * delete only rows that can never authenticate again, and it has to KEEP a row
 * that is merely expired — the 30 days are not about the session (an expired
 * one is already dead) but about `user_agent` and `ip_address`, which answer
 * "where was this account used from" and are worth nothing if they vanish the
 * moment they become interesting.
 *
 * Run against the database directly rather than through the plugin: the plugin
 * is a `setTimeout` loop around this one call, and a test that waited six hours
 * would be testing `setTimeout`.
 */
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: resolveOwnerDatabaseUrl() }) });

const ACCOUNT = 'sweeper-test-account';
const DAY = 86_400_000;

async function account() {
    await db.$executeRawUnsafe(
        `INSERT INTO account (id, email, password_hash, updated_at)
         VALUES ($1, 'sweeper@test.local', 'scrypt$x$y', now())
         ON CONFLICT (id) DO NOTHING`,
        ACCOUNT,
    );
}

async function session(id: string, expiresAgoDays: number, revoked = false) {
    await db.$executeRawUnsafe(
        `INSERT INTO auth_session (id, account_id, token_hash, expires_at, revoked_at, created_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        id, ACCOUNT, `hash-${id}`,
        new Date(Date.now() - expiresAgoDays * DAY),
        revoked ? new Date() : null,
    );
}

/** The production predicate, verbatim — see `deleteExpiredSessions`. */
async function sweep(retentionDays = 30): Promise<number> {
    const { count } = await db.authSession.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - retentionDays * DAY) } },
    });

    return count;
}

const surviving = async () => (await db.authSession.findMany({
    where: { accountId: ACCOUNT }, select: { id: true },
})).map((r) => r.id).sort();

afterEach(async () => {
    await db.$executeRawUnsafe(`DELETE FROM auth_session WHERE account_id = $1`, ACCOUNT);
});

afterAll(async () => {
    await db.$executeRawUnsafe(`DELETE FROM auth_session WHERE account_id = $1`, ACCOUNT);
    await db.$executeRawUnsafe(`DELETE FROM account WHERE id = $1`, ACCOUNT);
    await db.$disconnect();
});

describe('the retention window', () => {
    it('deletes a row expired well beyond the window', async () => {
        await account();
        await session('sweep-old', 40);

        expect(await sweep()).toBe(1);
        expect(await surviving()).toEqual([]);
    });

    it('KEEPS a row that is expired but still inside the window', async () => {
        // The counter-example that gives the test above meaning. A sweep that
        // deleted every expired row would pass that one and destroy the audit
        // trail this window exists to preserve.
        await account();
        await session('sweep-recent', 3);

        expect(await sweep()).toBe(0);
        expect(await surviving()).toEqual(['sweep-recent']);
    });

    it('keeps a LIVE session, which is the one that would actually hurt', async () => {
        await account();
        await session('sweep-live', -1); // expires tomorrow

        expect(await sweep()).toBe(0);
        expect(await surviving()).toEqual(['sweep-live']);
    });

    it('does not fire a day early at the boundary', async () => {
        await account();
        await session('sweep-29', 29);
        await session('sweep-31', 31);

        expect(await sweep()).toBe(1);
        expect(await surviving()).toEqual(['sweep-29']);
    });
});

describe('revoked sessions need no separate clause', () => {
    it('deletes a long-revoked row once its expiry is past the window', async () => {
        // Sessions live 12 hours, so a revoked row expires within half a day and
        // is then caught by the expiry test — which is why the predicate is one
        // condition rather than a LEAST(...) over two.
        await account();
        await session('sweep-revoked-old', 40, true);

        expect(await sweep()).toBe(1);
    });

    it('keeps a recently revoked row, exactly like any other recent one', async () => {
        await account();
        await session('sweep-revoked-new', 1, true);

        expect(await sweep()).toBe(0);
        expect(await surviving()).toEqual(['sweep-revoked-new']);
    });
});

describe('idempotence — why no claim or lease is needed', () => {
    it('is a no-op the second time, so concurrent instances cannot conflict', async () => {
        // The solver poller leases its work because two instances advancing the
        // same run would double-poll a stateful service. Here the loser of a
        // race deletes zero rows and both are correct.
        await account();
        await session('sweep-twice', 40);

        expect(await sweep()).toBe(1);
        expect(await sweep()).toBe(0);
    });
});
