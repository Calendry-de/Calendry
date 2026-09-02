import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { manageEntities } from '../app/utils/manageRegistry';
import { englishT } from './helpers/manageMessages';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { login } from './helpers/client';

/**
 * A relation whose EMPTY SET is a problem has to say so.
 *
 * The bug this closes is the codebase's most familiar shape, one layer up from
 * the usual instance: a Person with no AccessRole and a Person deliberately left
 * unprivileged render IDENTICALLY, "None assigned.", so the second is
 * invisible. The consequence is not cosmetic. `provision:tenant` ships a
 * `member` role and `/manage/accounts` issues logins, but nothing assigns the
 * role, so the default onboarding path ends with somebody signing in to an
 * empty application.
 *
 * Granting deliberately stays a human decision behind
 * `person_access_role.assign`: a CRUD route that granted a role on every insert
 * would be privilege escalation wearing a default's clothes, so the fix is to
 * make the empty state VISIBLE, not automatic.
 */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';
const TENANT = 'test-tenant-a';
const ROLELESS = 'test-person-roleless';

let cookie: string | null;

/** The rendered body only; see the note in `page-renders-per-role.test.ts`. */
async function renderedBody(path: string): Promise<string> {
    const html = await fetch(`${BASE}${path}`, { headers: { cookie: cookie! } })
        .then((res) => res.text());

    // The hydration payload carries the registry as JSON, so a match there would
    // pass for a page that rendered nothing at all.
    return html.split('<script type="application/json"')[0] ?? '';
}

beforeAll(async () => {
    await seed();
    ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));
});

afterEach(async () => {
    await ownerDb.$executeRawUnsafe(`DELETE FROM person_access_role WHERE person_id = $1`, ROLELESS);
    await ownerDb.$executeRawUnsafe(`DELETE FROM person WHERE id = $1`, ROLELESS);
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('the registry declares it, and declares it correctly', () => {
    /*
     * `englishT`, not the `(key) => key` stub: every assertion below is about
     * the WORDING of `emptyWarning` (that it names no role key, that it
     * instructs nobody), and against an identity stub each would be checking a
     * key name instead. See `tests/helpers/manageMessages.ts`.
     */
    const relations = manageEntities(englishT).flatMap((entity) => (entity.relations ?? [])
        .map((def) => ({ id: `${entity.key}/${def.key}`, def })));

    it('has relations to check at all', () => {
        // Guards the guard: every assertion below loops, and a loop over an
        // empty list passes.
        expect(relations.length).toBeGreaterThan(5);
    });

    it('is declared on the access-role relation', () => {
        const found = relations.filter(({ def }) => def.emptyWarning);

        expect(found.map((r) => r.id)).toContain('persons/access-roles');
    });

    it('names no specific role, because role keys are tenant vocabulary', () => {
        /*
         * CLAUDE.md: never hardcode an open value into logic. There is no
         * `DEFAULT_ROLE_KEY` constant: `member` exists only because
         * `provision:tenant` happens to create it, and a tenant may rename or
         * delete it. A warning naming it would be advice about a row that need
         * not exist.
         */
        for (const { id, def } of relations.filter((r) => r.def.emptyWarning)) {
            expect(def.emptyWarning, `${id} names a role key`).not.toMatch(/\bmember\b/i);
            expect(def.emptyWarning, `${id} names a role key`).not.toMatch(/tenant-admin|lecturer/i);
        }
    });

    it('is phrased as a fact, not an instruction, because it renders read-only too', () => {
        // A viewer without `person_access_role.assign` still sees this. "Tick
        // one above" would be telling them to use a control they do not have.
        for (const { id, def } of relations.filter((r) => r.def.emptyWarning)) {
            expect(def.emptyWarning, `${id} instructs the reader`)
                .not.toMatch(/\b(tick|choose|select|assign one|add one|click)\b/i);
        }
    });
});

describe('the Person page renders it', () => {
    async function createRoleless(): Promise<void> {
        await ownerDb.$executeRawUnsafe(
            `INSERT INTO person (id, tenant_id, given_name, family_name, email, updated_at)
             VALUES ($1, $2, 'Role', 'Less', 'roleless@test.local', now())`,
            ROLELESS, TENANT,
        );
    }

    it('warns on a Person holding no access role', async () => {
        await createRoleless();

        const html = await renderedBody(`/manage/persons/${ROLELESS}`);

        expect(html).toContain('No access role assigned');
        // Paired, because "contains a warning" means nothing on a page that
        // failed to render: the picker itself has to be there.
        expect(html).toContain('Access roles');
    });

    it('says NOTHING once a role is assigned, the counter-example', async () => {
        /*
         * Without this, a warning rendered unconditionally would pass the test
         * above. It also pins the specific bug of warning at the wrong time,
         * which would train the reader to ignore it.
         */
        await createRoleless();

        const role = await ownerDb.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id FROM access_role WHERE tenant_id = $1 LIMIT 1`, TENANT,
        );

        expect(role[0]?.id, 'fixture tenant must have an access role to assign').toBeTruthy();

        await ownerDb.$executeRawUnsafe(
            `INSERT INTO person_access_role (person_id, access_role_id, tenant_id)
             VALUES ($1, $2, $3)`,
            ROLELESS, role[0]!.id, TENANT,
        );

        const html = await renderedBody(`/manage/persons/${ROLELESS}`);

        expect(html).not.toContain('No access role assigned');
        expect(html).toContain('Access roles');
    });

    it('leaves other empty relations reading "None assigned."', async () => {
        /*
         * The scope check. `emptyWarning` is opt-in per relation, so an
         * unrelated empty relation on the SAME page must be unaffected: a
         * warning on every empty set would be noise, and noise is ignored.
         */
        await createRoleless();

        const html = await renderedBody(`/manage/persons/${ROLELESS}`);

        expect(html).toContain('Group memberships');
        expect(html).toContain('None assigned.');
    });
});
