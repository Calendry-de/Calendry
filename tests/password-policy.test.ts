import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, login } from './helpers/client';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';

/**
 * Password expiry and rate limiting: issue #13 items 1 and 3.
 *
 * WHY RATE LIMITING IS TESTED ON TWO ROUTES SEPARATELY. `login` and
 * `change-password` both accept a password as proof and answer a generic
 * 401 either way, so both are a guessing oracle; the card is explicit that
 * the second is "equally" one, not a lesser case. `checkRateLimit`'s key is
 * route-qualified specifically so exhausting one door's budget cannot be
 * done by hammering the other, which is the property most worth pinning.
 */
beforeAll(async () => {
    await seed();
}, 60_000);

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('rate limiting on login', () => {
    it('allows repeated failures up to the limit, then blocks', async () => {
        for (let i = 0; i < 10; i += 1) {
            const res = await api('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email: ACCOUNTS.viewerA, password: 'definitely-wrong' }),
            });

            expect(res.status, `attempt ${i + 1}`).toBe(401);
        }

        const blocked = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: ACCOUNTS.viewerA, password: 'definitely-wrong' }),
        });

        expect(blocked.status).toBe(429);

        // A CORRECT password must ALSO be refused while blocked: the limit
        // guards the account, not just wrong guesses, or an attacker who
        // exhausts the budget learns nothing but a legitimate user is locked
        // out identically either way, which is the intended failure mode.
        const correctButBlocked = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: ACCOUNTS.viewerA, password: TEST_PASSWORD }),
        });

        expect(correctButBlocked.status).toBe(429);
    });

    it('resets on a successful login, for a DIFFERENT account not yet blocked', async () => {
        const first = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: ACCOUNTS.adminB, password: 'wrong-once' }),
        });

        expect(first.status).toBe(401);

        const success = await login(ACCOUNTS.adminB, TEST_PASSWORD);

        expect(success.cookie).toBeTruthy();

        // The counter is gone, not merely under the limit: a later burst of
        // failures starts counting from zero again.
        for (let i = 0; i < 10; i += 1) {
            const res = await api('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email: ACCOUNTS.adminB, password: 'wrong-again' }),
            });

            expect(res.status, `attempt ${i + 1}`).toBe(401);
        }
    });
});

describe('rate limiting on change-password', () => {
    it('is counted separately from login: exhausting one does not touch the other', async () => {
        // Spend change-password's own budget on a fresh account.
        for (let i = 0; i < 10; i += 1) {
            await api('/api/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({
                    email: ACCOUNTS.multi, currentPassword: 'wrong', newPassword: 'irrelevant-new-pw-1',
                }),
            });
        }

        const blocked = await api('/api/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({
                email: ACCOUNTS.multi, currentPassword: 'wrong', newPassword: 'irrelevant-new-pw-1',
            }),
        });

        expect(blocked.status).toBe(429);

        // login for the SAME account, a different door, is untouched.
        const stillWorks = await login(ACCOUNTS.multi, TEST_PASSWORD);

        expect(stillWorks.cookie).toBeTruthy();
    });
});

describe('password expiry', () => {
    beforeAll(async () => {
        // viewerA was deliberately rate-limited by the tests above; expiry is
        // a different mechanism and must not inherit that block.
        await ownerDb.$executeRawUnsafe(
            `DELETE FROM auth_rate_limit WHERE key = 'login:${ACCOUNTS.viewerA}'`,
        );
    });

    it('backs a fresh account with a real, current passwordChangedAt', async () => {
        const account = await ownerDb.account.findUniqueOrThrow({ where: { email: ACCOUNTS.adminA } });

        expect(account.passwordChangedAt).toBeInstanceOf(Date);
        expect(Date.now() - account.passwordChangedAt.getTime()).toBeLessThan(60_000);
    });

    it('requires a change once the password is older than the policy, exactly like a forced reset', async () => {
        await ownerDb.account.update({
            where: { email: ACCOUNTS.viewerA },
            data: { passwordChangedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 91) },
        });

        // Cleared by the rate-limit tests' own successes above only for OTHER
        // accounts; this one has made only failed attempts so far in this
        // file, all against a different door (login, not yet touched here).
        const res = await api<{ requiresPasswordChange: boolean }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: ACCOUNTS.viewerA, password: TEST_PASSWORD }),
        });

        expect(res.status).toBe(200);
        expect(res.body.requiresPasswordChange).toBe(true);

        await ownerDb.account.update({
            where: { email: ACCOUNTS.viewerA },
            data: { passwordChangedAt: new Date() },
        });
    });

    it('does not require a change for a password inside the policy window', async () => {
        await ownerDb.account.update({
            where: { email: ACCOUNTS.viewerA },
            data: { passwordChangedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) },
        });

        const res = await api<{ requiresPasswordChange: boolean }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: ACCOUNTS.viewerA, password: TEST_PASSWORD }),
        });

        expect(res.status).toBe(200);
        expect(res.body.requiresPasswordChange).toBeFalsy();
    });

    it('records a fresh passwordChangedAt when the password is actually changed', async () => {
        const before = await ownerDb.account.findUniqueOrThrow({ where: { email: ACCOUNTS.adminB } });

        await new Promise((resolve) => { setTimeout(resolve, 10); });

        const res = await api('/api/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({
                email: ACCOUNTS.adminB, currentPassword: TEST_PASSWORD, newPassword: 'a-fresh-password-2026',
            }),
        });

        expect(res.status).toBe(204);

        const after = await ownerDb.account.findUniqueOrThrow({ where: { email: ACCOUNTS.adminB } });

        expect(after.passwordChangedAt.getTime()).toBeGreaterThan(before.passwordChangedAt.getTime());

        // Restore, so this fixture account still logs in with TEST_PASSWORD
        // for any test file that runs after this one.
        await ownerDb.$executeRawUnsafe(
            `UPDATE account SET password_hash = (SELECT password_hash FROM account WHERE email = '${ACCOUNTS.adminA}') WHERE email = '${ACCOUNTS.adminB}'`,
        );
    });
});
