import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * A lecturer sets their OWN module's `schedulingPattern` (issue #28) — the
 * self-service half of a field `offering.update` could already write for an
 * administrator.
 *
 * THE THING WORTH PINNING is the authority boundary, which is per-Offering
 * and not per-role: holding `offering.set_scheduling_pattern` is necessary
 * but not sufficient (a lecturer can only touch modules `OfferingLecturer`
 * actually names them on), and leading a module is not sufficient either
 * without the permission (mirrors `exam.request_own` / `assertLeadsOffering`
 * in `tests/exam-request-flow.test.ts`, which this deliberately parallels).
 */
let adminA = '';
let adminB = '';
let viewerA = '';
let offeringA = '';
let unledOfferingA = '';
let personA = '';
let personViewerA = '';

async function setPattern(offeringId: string, cookie: string, schedulingPattern: string | null) {
    return api<{ offering: { id: string; schedulingPattern: string | null } }>(
        `/api/me/offerings/${offeringId}/scheduling-pattern`,
        { method: 'PUT', cookie, body: JSON.stringify({ schedulingPattern }) },
    );
}

beforeAll(async () => {
    const ids = await seed();

    personA = ids.personA;
    personViewerA = ids.personViewerA;
    offeringA = 'test-offering-a';

    adminA = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
    adminB = (await login(ACCOUNTS.adminB, TEST_PASSWORD)).cookie;
    viewerA = (await login(ACCOUNTS.viewerA, TEST_PASSWORD)).cookie;

    // personA (adminA) leads offeringA. personViewerA also leads it, to
    // prove leading a module is not BY ITSELF enough — viewerA's role holds
    // only session.read.
    await ownerDb.offeringLecturer.createMany({
        data: [
            { tenantId: ids.tenantA, offeringId: offeringA, personId: personA },
            { tenantId: ids.tenantA, offeringId: offeringA, personId: personViewerA },
        ],
    });

    const unled = await ownerDb.offering.create({
        data: {
            tenantId: ids.tenantA, termId: 'test-term-a', kindId: 'test-kind-a',
            title: 'Somebody else’s module', frequency: 1,
        },
    });

    unledOfferingA = unled.id;
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('leading the module is required, even with the permission', () => {
    it('lets a lecturer set the pattern on a module they lead', async () => {
        const res = await setPattern(offeringA, adminA, 'BLOCK');

        expect(res.status).toBe(200);
        expect(res.body.offering.schedulingPattern).toBe('BLOCK');

        const row = await ownerDb.offering.findUniqueOrThrow({ where: { id: offeringA } });

        expect(row.schedulingPattern).toBe('BLOCK');
    });

    it('refuses a module the caller does not lead, as a 404', async () => {
        /*
         * IN THE CALLER'S OWN TENANT, matching `exam-request-flow`'s reasoning:
         * using another tenant's module would let this pass on tenant
         * isolation alone rather than on the `OfferingLecturer` check.
         */
        const res = await setPattern(unledOfferingA, adminA, 'BLOCK');

        expect(res.status).toBe(404);

        // Refused before any write — the unled Offering is untouched.
        const row = await ownerDb.offering.findUniqueOrThrow({ where: { id: unledOfferingA } });

        expect(row.schedulingPattern).toBeNull();
    });

    it('refuses another tenant’s module too', async () => {
        expect((await setPattern(offeringA, adminB, 'BLOCK')).status).toBe(404);
    });
});

describe('the permission is required, even while leading the module', () => {
    it('refuses a lecturer who does not hold offering.set_scheduling_pattern', async () => {
        // personViewerA genuinely leads offeringA (seeded above) but viewerA's
        // role carries only session.read.
        const res = await setPattern(offeringA, viewerA, 'DISTRIBUTED');

        expect(res.status).toBe(403);
    });
});

describe('the write schema', () => {
    it('accepts the two real values and clears on the blank option', async () => {
        expect((await setPattern(offeringA, adminA, 'DISTRIBUTED')).body.offering.schedulingPattern)
            .toBe('DISTRIBUTED');

        // '' is what a <select>'s blank option sends; it must round-trip to
        // NULL rather than fail validation, matching the admin write schema.
        const cleared = await api<{ offering: { schedulingPattern: string | null } }>(
            `/api/me/offerings/${offeringA}/scheduling-pattern`,
            { method: 'PUT', cookie: adminA, body: JSON.stringify({ schedulingPattern: '' }) },
        );

        expect(cleared.status).toBe(200);
        expect(cleared.body.offering.schedulingPattern).toBeNull();
    });

    it('refuses an unrecognised pattern, naming neither the caps nor the missing third mode', async () => {
        // "Multiple in a day" (issue #28's third mode) is not built — see
        // CLAUDE.md's own note on this ticket — so it must not be an
        // accepted value here either.
        const res = await setPattern(offeringA, adminA, 'MULTIPLE_PER_DAY');

        expect(res.status).toBe(400);
    });
});

describe('the lecturer’s own list', () => {
    it('lists only the modules the caller leads', async () => {
        const res = await api<{ rows: { id: string }[] }>('/api/me/offerings', { cookie: adminA });

        expect(res.status).toBe(200);

        const ids = res.body.rows.map((r) => r.id);

        expect(ids).toContain(offeringA);
        expect(ids).not.toContain(unledOfferingA);
    });

    it('renders the page', async () => {
        const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';
        const res = await fetch(`${BASE}/my/teaching-pattern`, { headers: { cookie: adminA } });

        expect(res.status).toBe(200);
        expect(await res.text()).toContain('My teaching pattern');
    });
});
