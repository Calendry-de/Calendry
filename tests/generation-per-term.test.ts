import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, type Fixtures, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { login } from './helpers/client';

/**
 * A Generation belongs to a TERM, and its bookkeeping is scoped to it.
 *
 * WHY THIS SUITE EXISTS. Three things about a Generation were scoped to the
 * TENANT that should have been scoped to the term — its version series, the
 * "exactly one current" unique index, and the supersede in
 * `POST /generations/:id/apply`. The third one corrupted data: applying
 * Semester 3's proposal marked Semester 1's live applied schedule as
 * SUPERSEDED. On the demo tenant that left five terms' records reading
 * "discarded or superseded" that nobody had discarded.
 *
 * It survived review for the same reason its sibling did. The SESSION rebase in
 * the same handler had already been caught and fixed ("this used to be
 * `{ tenantId, isLocked: false }` — every unlocked Session in the tenant,
 * regardless of term"), and the fix stopped at the sessions: the status and the
 * current flag beside it kept the tenant-wide shape, and the partial unique
 * index agreed with them, so the database and the handler were consistent with
 * each other and wrong about the product.
 *
 * Nothing here goes through the solver. These are the two invariants an apply
 * must hold whatever produced the proposal, and a fixture that needed a real
 * run would test the solver instead of the rule.
 */
let f: Fixtures;
let cookie: string;

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

/** A proposal for one term, created directly: the rule is about apply, not about solving. */
async function makeGeneration(options: {
    id: string;
    termId: string | null;
    version: number;
    status: 'READY' | 'APPLIED';
    isCurrent: boolean;
}) {
    await ownerDb.generation.create({
        data: {
            id: options.id,
            tenantId: f.tenantA,
            termId: options.termId,
            version: options.version,
            source: 'SOLVER',
            status: options.status,
            isCurrent: options.isCurrent,
            appliedAt: options.status === 'APPLIED' ? new Date() : null,
        },
    });
}

function statusOf(id: string) {
    return ownerDb.generation.findFirstOrThrow({
        where: { id },
        select: { status: true, isCurrent: true, version: true, termId: true },
    });
}

beforeAll(async () => {
    f = await seed();
    cookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
}, 60_000);

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('generation scoping', () => {
    it('lets two terms each hold a current schedule', async () => {
        // The old partial unique index was on (tenant_id) WHERE is_current, so
        // the second of these was rejected by the DATABASE — a tenant could not
        // hold an applied schedule for two terms at once.
        await makeGeneration({ id: 'g-term-a-live', termId: f.termA, version: 1, status: 'APPLIED', isCurrent: true });
        await makeGeneration({ id: 'g-term-b-live', termId: f.termB, version: 1, status: 'APPLIED', isCurrent: true });

        expect((await statusOf('g-term-a-live')).isCurrent).toBe(true);
        expect((await statusOf('g-term-b-live')).isCurrent).toBe(true);
    });

    it('reuses version numbers across terms and refuses them within one', async () => {
        // v1 in two different terms is the whole point: a version now counts
        // within its term. Tenant-wide, these six terms produced v1..v6 and the
        // number said nothing about the term being looked at.
        expect((await statusOf('g-term-a-live')).version).toBe(1);
        expect((await statusOf('g-term-b-live')).version).toBe(1);

        await expect(makeGeneration({
            id: 'g-term-a-dupe', termId: f.termA, version: 1, status: 'READY', isCurrent: false,
        })).rejects.toThrow();
    });

    it('applying one term does not supersede another term', async () => {
        await makeGeneration({ id: 'g-term-b-next', termId: f.termB, version: 2, status: 'READY', isCurrent: false });

        const res = await fetch(`${BASE}/api/generations/g-term-b-next/apply`, {
            method: 'POST',
            headers: { cookie, 'content-type': 'application/json' },
            body: '{}',
        });

        expect(res.status).toBe(200);

        // THE ASSERTION THIS SUITE EXISTS FOR. Term A was not part of this apply
        // and must be untouched by it.
        const termA = await statusOf('g-term-a-live');

        expect(termA.status).toBe('APPLIED');
        expect(termA.isCurrent).toBe(true);

        // Term B's own previous schedule IS superseded — that is a correct
        // supersede, and the one the tenant-wide version was drowning out.
        const supersededInB = await statusOf('g-term-b-live');

        expect(supersededInB.status).toBe('SUPERSEDED');
        expect(supersededInB.isCurrent).toBe(false);

        const applied = await statusOf('g-term-b-next');

        expect(applied.status).toBe('APPLIED');
        expect(applied.isCurrent).toBe(true);
    });

    it('keeps a tenant-wide baseline out of a term-filtered list', async () => {
        /*
         * `term_id IS NULL` is a real state, not a gap: the baseline every
         * tenant starts from covers the whole institution. The seed's own
         * fixture generation is one, so this asserts against that rather than
         * creating a second (only one tenant-wide row may be current).
         */
        const listed = await fetch(`${BASE}/api/generations?termId=${f.termB}&limit=100`, { headers: { cookie } });

        expect(listed.status).toBe(200);

        const rows = await listed.json() as { id: string; termId: string | null }[];

        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((row) => row.termId === f.termB)).toBe(true);
        expect(rows.some((row) => row.id === `test-generation-a`)).toBe(false);
    });
});
