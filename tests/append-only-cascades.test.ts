import { afterEach, describe, expect, it } from 'vitest';
import { ownerDb } from './helpers/seed';

/**
 * The append-only guards permit the FK actions the schema depends on, and
 * nothing adjacent.
 *
 * THREE INSTANCES OF ONE SHAPE. A referential action declared in
 * `schema.prisma` was refused by a trigger on the same table, so the parent
 * DELETE aborted:
 *
 *   1. `session_event.session_id` SET NULL vs. `session_event_append_only`,
 *      fixed 20260816180000.
 *   2. `generation` / `session_event` CASCADE from `tenant` vs.
 *      `generation_no_delete` and `session_event_append_only`.
 *   3. `generation.created_by_id` SET NULL vs.
 *      `generation_content_immutable`.
 *
 * (2) and (3) were fixed together in 20260828140000. Note WHICH trigger raised
 * for (2): `generation_no_delete`, not the session_event one the tracked entry
 * named. The generation cascade is reached first, so exempting only
 * `session_event` would have moved the error rather than removed it.
 *
 * (3) is the one reachable from the UI: `/manage/persons` offers delete behind
 * `person.delete`, so removing a departed member of staff who had ever
 * triggered a solver run failed with a raw database error.
 *
 * WHY THIS FILE EXISTS AT ALL. Every one of these was invisible because
 * `tests/helpers/seed.ts` DISABLED all three triggers around its teardown, a
 * workaround in the fixture, which is how a schema defect survives a thousand
 * passing tests. That workaround is gone; the suite now deletes its tenants
 * through the real triggers, so a regression here fails everywhere. This file
 * pins the BOUNDARIES, which that could never do: a guard opened too wide
 * passes teardown just as happily as a correct one.
 *
 * Owner connection throughout: these are database invariants, below RLS and
 * below the app role, and there is no API that reaches them.
 */
const T = 'probe-append-tenant';

async function fixture(): Promise<void> {
    await ownerDb.$executeRawUnsafe(
        `INSERT INTO tenant (id, slug, name, timezone, updated_at)
         VALUES ($1, $1, 'Probe', 'Europe/Berlin', now())`, T,
    );
    await ownerDb.$executeRawUnsafe(
        `INSERT INTO person (id, tenant_id, given_name, family_name, updated_at)
         VALUES ('probe-author', $1, 'Probe', 'Author', now())`, T,
    );
    await ownerDb.$executeRawUnsafe(
        `INSERT INTO person (id, tenant_id, given_name, family_name, updated_at)
         VALUES ('probe-other', $1, 'Other', 'Person', now())`, T,
    );
    await ownerDb.$executeRawUnsafe(
        `INSERT INTO generation (id, tenant_id, version, source, status, is_current, created_by_id)
         VALUES ('probe-gen', $1, 1, 'MANUAL_BASELINE', 'APPLIED', true, 'probe-author')`, T,
    );
    /*
     * A real Session, so the event's `session_id` is non-null. Without it the
     * detach test below is a NO-OP update, which the trigger refuses on purpose
     * ("at least one of them must actually be a detach"): the first draft of
     * this fixture failed for exactly that reason, which is itself a small
     * confirmation that the no-op branch works.
     */
    await ownerDb.$executeRawUnsafe(
        `INSERT INTO time_grid (id, tenant_id, name, block_length_minutes, blocks_per_day, active_days, updated_at)
         VALUES ('probe-grid', $1, 'Probe', 45, 8, ARRAY[1,2,3,4,5], now())`, T,
    );
    await ownerDb.$executeRawUnsafe(
        `INSERT INTO term (id, tenant_id, name, start_date, end_date, time_grid_id, updated_at)
         VALUES ('probe-term', $1, 'Probe', '2026-10-01', '2027-02-28', 'probe-grid', now())`, T,
    );
    await ownerDb.$executeRawUnsafe(
        `INSERT INTO session_kind (id, tenant_id, key, name, updated_at)
         VALUES ('probe-kind', $1, 'lecture', 'Lecture', now())`, T,
    );
    await ownerDb.$executeRawUnsafe(
        `INSERT INTO session (id, tenant_id, term_id, kind_id, generation_id, term_week, day_of_week, block_index, updated_at)
         VALUES ('probe-sess', $1, 'probe-term', 'probe-kind', 'probe-gen', 1, 2, 0, now())`, T,
    );
    await ownerDb.$executeRawUnsafe(
        `INSERT INTO session_event (id, tenant_id, generation_id, session_id, type, seq, payload, created_at)
         VALUES ('probe-ev', $1, 'probe-gen', 'probe-sess', 'CREATE', 1, '{}'::jsonb, now())`, T,
    );
}

afterEach(async () => {
    // Through the real triggers, which is itself the headline assertion.
    await ownerDb.$executeRawUnsafe(`DELETE FROM tenant WHERE id = $1`, T);
});

describe('what the cascade exemption permits', () => {
    it('lets a Tenant carrying a Generation and events be deleted', async () => {
        await fixture();

        await ownerDb.$executeRawUnsafe(`DELETE FROM tenant WHERE id = $1`, T);

        const left = await ownerDb.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT (SELECT count(*) FROM generation WHERE tenant_id = $1)
                  + (SELECT count(*) FROM session_event WHERE tenant_id = $1) AS n`, T,
        );

        expect(Number(left[0]!.n)).toBe(0);
    });

    it('lets a Person who created a Generation be deleted, detaching authorship', async () => {
        await fixture();

        await ownerDb.$executeRawUnsafe(`DELETE FROM person WHERE id = 'probe-author'`);

        const row = await ownerDb.$queryRawUnsafe<{ created_by_id: string | null; status: string }[]>(
            `SELECT created_by_id, status::text FROM generation WHERE id = 'probe-gen'`,
        );

        // The Generation SURVIVES: deleting a person must not delete a
        // timetable. Its authorship degrades to unknown rather than to a
        // lie about who made it.
        expect(row).toHaveLength(1);
        expect(row[0]!.created_by_id).toBeNull();
        expect(row[0]!.status).toBe('APPLIED');
    });
});

describe('what it still refuses: the boundaries', () => {
    it('refuses a direct DELETE of a Generation', async () => {
        await fixture();

        await expect(ownerDb.$executeRawUnsafe(`DELETE FROM generation WHERE id = 'probe-gen'`))
            .rejects.toThrow(/append-only/);
    });

    it('refuses a direct DELETE of a session_event', async () => {
        await fixture();

        await expect(ownerDb.$executeRawUnsafe(`DELETE FROM session_event WHERE id = 'probe-ev'`))
            .rejects.toThrow(/append-only/);
    });

    it('refuses REPOINTING created_by_id at a different Person', async () => {
        // The difference between detaching a departed author and rewriting
        // history. A cascade only ever nulls.
        await fixture();

        await expect(ownerDb.$executeRawUnsafe(
            `UPDATE generation SET created_by_id = 'probe-other' WHERE id = 'probe-gen'`,
        )).rejects.toThrow(/immutable/);
    });

    it('refuses nulling created_by_id ALONGSIDE another change', async () => {
        // The exemption requires nothing else to differ, so it cannot be used
        // as a doorway to edit the snapshot.
        await fixture();

        await expect(ownerDb.$executeRawUnsafe(
            `UPDATE generation SET created_by_id = NULL, version = 99 WHERE id = 'probe-gen'`,
        )).rejects.toThrow(/immutable/);
    });

    it('refuses rewriting solver_meta', async () => {
        await fixture();

        await expect(ownerDb.$executeRawUnsafe(
            `UPDATE generation SET solver_meta = '{"x":1}'::jsonb WHERE id = 'probe-gen'`,
        )).rejects.toThrow(/immutable/);
    });

    it('still allows the ordinary lifecycle change', async () => {
        // The counter-example that stops every test above from passing against
        // a trigger that refused everything.
        await fixture();

        await ownerDb.$executeRawUnsafe(
            `UPDATE generation SET status = 'READY', is_current = false WHERE id = 'probe-gen'`,
        );

        const row = await ownerDb.$queryRawUnsafe<{ status: string }[]>(
            `SELECT status::text FROM generation WHERE id = 'probe-gen'`,
        );

        expect(row[0]!.status).toBe('READY');
    });

    it('still allows the session_event detach from 20260816180000', async () => {
        // The earlier exemption must survive this change: both live in the same
        // function now, and one rewrite could silently drop the other.
        await fixture();

        await ownerDb.$executeRawUnsafe(
            `UPDATE session_event SET session_id = NULL WHERE id = 'probe-ev'`,
        );

        await expect(ownerDb.$executeRawUnsafe(
            `UPDATE session_event SET type = 'MOVE' WHERE id = 'probe-ev'`,
        )).rejects.toThrow(/append-only/);
    });
});
