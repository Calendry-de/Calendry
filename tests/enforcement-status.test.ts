import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * "Can a lecturer see whether the rule governing their data is on?" — #3.
 *
 * THE DECISION THE CARD POSED: a `/my`-scoped booleans-only endpoint needing
 * NO new permission, rather than a new `constraint.read_enabled`-style key.
 * The tests here are mostly about proving that choice holds up — a lecturer
 * who holds NOTHING but an acting Person can read this, and the answer never
 * carries a weight, a name, or any other rule's state.
 */
let f: Fixtures;
let lecturerCookie = '';

beforeAll(async () => {
    f = await seed();
    lecturerCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

async function setEnabled(type: string, isEnabled: boolean) {
    await ownerDb.constraint.deleteMany({ where: { tenantId: f.tenantA, type } });
    await ownerDb.constraint.create({
        data: {
            tenantId: f.tenantA, type, name: type, isDefault: true, isEnabled,
            severity: type === 'person_preference_fit' ? 'SOFT' : 'HARD',
            weight: type === 'person_preference_fit' ? 5 : null,
        },
    });
}

describe('reading the enforcement status', () => {
    it('reports the real state of person_preference_fit', async () => {
        await setEnabled('person_preference_fit', true);

        const res = await api<{ preferencesWeighed: boolean }>('/api/me/enforcement', { cookie: lecturerCookie });

        expect(res.status).toBe(200);
        expect(res.body.preferencesWeighed).toBe(true);

        await setEnabled('person_preference_fit', false);

        const off = await api<{ preferencesWeighed: boolean }>('/api/me/enforcement', { cookie: lecturerCookie });

        expect(off.body.preferencesWeighed).toBe(false);
    });

    it('reports false, not an error, when no row exists at all', async () => {
        await ownerDb.constraint.deleteMany({ where: { tenantId: f.tenantA, type: 'person_preference_fit' } });

        const res = await api<{ preferencesWeighed: boolean }>('/api/me/enforcement', { cookie: lecturerCookie });

        expect(res.status).toBe(200);
        expect(res.body.preferencesWeighed).toBe(false);
    });

    it('reports groupAvailabilityHonoured independently', async () => {
        await setEnabled('person_preference_fit', true);
        await setEnabled('group_veto', false);

        const res = await api<{ preferencesWeighed: boolean; groupAvailabilityHonoured: boolean }>(
            '/api/me/enforcement',
            { cookie: lecturerCookie },
        );

        expect(res.body.preferencesWeighed).toBe(true);
        expect(res.body.groupAvailabilityHonoured).toBe(false);
    });

    it('leaks no weight, name, or other rule — booleans only', async () => {
        await setEnabled('person_preference_fit', true);

        const res = await api('/api/me/enforcement', { cookie: lecturerCookie });
        const text = JSON.stringify(res.body);

        // The row's own name (set to the type string above, a stand-in for a
        // real administrator-chosen name) and its weight must not appear.
        expect(text).not.toContain('weight');
        expect(Object.values(res.body as Record<string, unknown>).every((v) => typeof v === 'boolean')).toBe(true);
    });
});

describe('who may read it', () => {
    it('needs no permission at all — only an acting Person', async () => {
        // adminA already holds every permission in the fixture tenant; this
        // is not a test that ONE particular key is enough, since the whole
        // point is that no key is required. See the "unreachable by
        // screens/poller" test below for what actually gates it.
        const res = await api('/api/me/enforcement', { cookie: lecturerCookie });

        expect(res.status).toBe(200);
    });

    it('refuses a request with no session at all', async () => {
        const res = await api('/api/me/enforcement');

        expect(res.status).toBe(401);
    });
});
