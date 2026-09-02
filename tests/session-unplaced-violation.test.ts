import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * `no_unplaced_session` (shared/constraintTypes.ts): the HARD structural check
 * that a Session an Offering still owes has not fallen into the spare bank
 * (issue #22) and been left there.
 *
 * A PER-SESSION type, like `no_session_spanning_break`, but the exact opposite
 * shape: it fires on the ABSENCE of a placement rather than a fact about one.
 * `bank.post.ts` writes it directly rather than through `refreshViolations()`
 * (see that route's file comment), so this exercises the real route, not the
 * evaluator function directly.
 */
const TENANT = 'test-tenant-a';
const SESSION = 'test-session-a';

let cookie: string | null;

beforeAll(async () => {
    await seed();
    ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));

    await ownerDb.constraint.create({
        data: {
            tenantId: TENANT, type: 'no_unplaced_session', name: 'Every session must be placed',
            severity: 'HARD', weight: null, isDefault: true, isEnabled: true,
        },
    });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('banking a Session with the rule enabled', () => {
    it('records a HARD violation naming the bank', async () => {
        const res = await api(`/api/sessions/${SESSION}/bank`, { method: 'POST', cookie, body: '{}' });

        expect(res.status).toBe(200);

        const violations = await ownerDb.constraintViolation.findMany({
            where: { tenantId: TENANT, sessionId: SESSION },
        });

        expect(violations).toHaveLength(1);
        expect(violations[0]?.severity).toBe('HARD');
        expect(violations[0]?.penalty).toBeNull();

        const detail = violations[0]?.detail as { reason: string };

        expect(detail.reason).toBe('session_unplaced');
    });

    it('is cleared the moment the Session is re-placed', async () => {
        const res = await api(`/api/sessions/${SESSION}/move`, {
            method: 'POST',
            cookie,
            body: JSON.stringify({ termWeek: 3, dayOfWeek: 4, blockIndex: 2 }),
        });

        expect(res.status).toBe(200);

        expect(await ownerDb.constraintViolation.count({
            where: { tenantId: TENANT, sessionId: SESSION },
        })).toBe(0);
    });
});

describe('banking a Session with the rule disabled', () => {
    it('records nothing', async () => {
        await seed();
        ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));

        await ownerDb.constraint.create({
            data: {
                tenantId: TENANT, type: 'no_unplaced_session', name: 'Every session must be placed',
                severity: 'HARD', weight: null, isDefault: true, isEnabled: false,
            },
        });

        const res = await api(`/api/sessions/${SESSION}/bank`, { method: 'POST', cookie, body: '{}' });

        expect(res.status).toBe(200);

        expect(await ownerDb.constraintViolation.count({
            where: { tenantId: TENANT, sessionId: SESSION },
        })).toBe(0);
    });
});

describe('the catalogue', () => {
    it('is HARD, per-session, enabled by default, and has no wire field', async () => {
        const { defaultConstraintRow, findConstraintType } = await import('../shared/constraintTypes');
        const type = findConstraintType('no_unplaced_session')!;

        expect(type.severity).toBe('HARD');
        expect(type.wireField).toBeUndefined();
        expect(defaultConstraintRow(type).isEnabled).toBe(true);
    });
});
