import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { login } from './helpers/client';

/**
 * "There is no such rule" and "I may not read the rules" are different facts.
 *
 * The Group availability panel explains whether the dates it saves actually
 * bind, which depends on the tenant's `group_veto` constraint row. It fetches
 * `/api/constraints` TOLERANTLY, deliberately, because a caller who may edit
 * Groups need not hold `constraint.read`, and failing the whole panel would hide
 * the editor from the person sent there to use it.
 *
 * But the tolerant path returned `[]`, which is also what a tenant with no such
 * rule returns. So the two collapsed into one, and the panel stated the first as
 * FACT: a group editor without `constraint.read` was told
 *
 *     "This institution has no group availability rule configured, so the
 *      scheduler currently ignores these dates. An administrator needs to add
 *      it before they take effect."
 *
 * on a tenant where that rule existed and was switched ON. Their dates were
 * binding; the screen said they were ignored.
 *
 * Four states now, and the tests below are one per state: the only way to show
 * that a message is attached to the right one.
 */
const TENANT_A = 'test-tenant-a';
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';
const GROUP_EDITOR = 'group-editor-note@test.local';

let adminCookie: string | null;
let editorCookie: string | null;
let groupId: string;

/** `group.*` and `term.read`, but NOT `constraint.read`. */
async function seedGroupEditor() {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${GROUP_EDITOR}'`);

    const role = await ownerDb.accessRole.create({
        data: { tenantId: TENANT_A, key: 'group-editor-note', name: 'Group Editor' },
    });

    await ownerDb.accessRolePermission.createMany({
        data: ['group.read', 'group.update', 'term.read']
            .map((permissionKey) => ({ accessRoleId: role.id, permissionKey, tenantId: TENANT_A })),
    });

    const person = await ownerDb.person.create({
        data: { tenantId: TENANT_A, givenName: 'Group', familyName: 'Editor', email: 'ge@a.test' },
    });

    await ownerDb.personAccessRole.create({
        data: { personId: person.id, accessRoleId: role.id, tenantId: TENANT_A },
    });

    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });
    const account = await ownerDb.account.create({
        data: { email: GROUP_EDITOR, passwordHash: template.passwordHash },
    });

    await ownerDb.accountPerson.create({ data: { accountId: account.id, personId: person.id } });
}

async function setRule(state: 'enabled' | 'disabled' | 'absent'): Promise<void> {
    await ownerDb.$executeRawUnsafe(
        `DELETE FROM constraint_def WHERE tenant_id = $1 AND type = 'group_veto'`, TENANT_A,
    );

    if (state === 'absent') {
        return;
    }

    await ownerDb.$executeRawUnsafe(
        `INSERT INTO constraint_def (id, tenant_id, type, name, severity, weight, is_enabled, is_default, params, updated_at)
         VALUES ('note-veto', $1, 'group_veto', 'Honour group availability', 'HARD', NULL, $2, true, '{}'::jsonb, now())`,
        TENANT_A, state === 'enabled',
    );
}

async function panel(cookie: string): Promise<string> {
    const res = await fetch(`${BASE}/manage/groups/${groupId}`, { headers: { cookie } });

    expect(res.status, 'the group page did not render').toBe(200);

    // Rendered body only: the hydration payload would match for a page that
    // rendered nothing at all.
    return (await res.text()).split('<script type="application/json"')[0] ?? '';
}

beforeAll(async () => {
    const ids = await seed();

    groupId = ids.groupCohortA;

    await seedGroupEditor();
    ({ cookie: adminCookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));
    ({ cookie: editorCookie } = await login(GROUP_EDITOR, TEST_PASSWORD));
});

afterAll(async () => {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${GROUP_EDITOR}'`);
    await teardown();
    await ownerDb.$disconnect();
});

describe('the four states, one test each', () => {
    it('confirms the asymmetry the whole file depends on', async () => {
        // Guards the guard: if this role could read /api/constraints, the
        // headline test below would pass against the unfixed component.
        const res = await fetch(`${BASE}/api/constraints`, { headers: { cookie: editorCookie! } });

        expect(res.status, 'the group editor must NOT be able to read constraints').toBe(403);
    });

    it('says it CANNOT TELL when the rules are unreadable, even with the rule ON', async () => {
        /*
         * THE BUG. Rule present and enabled, so the dates really do bind, and
         * the reader is the one account that cannot see that. The old copy
         * asserted the opposite.
         */
        await setRule('enabled');

        const html = await panel(editorCookie!);

        expect(html).toContain('cannot read');
        expect(html).not.toContain('has no “group availability” rule configured');
        expect(html).not.toContain('currently ignores');
    });

    it('says NOTHING to an admin when the rule is on', async () => {
        // The state that needs no note at all: dates bind, nothing to explain.
        await setRule('enabled');

        const html = await panel(adminCookie!);

        expect(html).not.toContain('not yet enforced');
        expect(html).not.toContain('cannot read');
    });

    it('says SWITCHED OFF to an admin when the rule is disabled', async () => {
        await setRule('disabled');

        const html = await panel(adminCookie!);

        expect(html).toContain('is switched off');
        expect(html).not.toContain('cannot read');
    });

    it('says NONE CONFIGURED to an admin when there is genuinely no rule', async () => {
        /*
         * The counter-example that keeps the headline test honest. This message
         * must still exist and still be reachable: the fix distinguishes it
         * from "unreadable", it does not remove it.
         */
        await setRule('absent');

        const html = await panel(adminCookie!);

        expect(html).toContain('has no “group availability” rule configured');
        expect(html).not.toContain('cannot read');
    });
});
