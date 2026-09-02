import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * A form's REFERENCE wave must not be able to blank the record it is editing.
 *
 * THE BUG. `useEntityForm` fetches the row and one list per `reference` field in a
 * single `Promise.all`. Those list endpoints carry permissions the page's own gate
 * does not imply: `offerings` fetches `/api/terms`, `/api/session-kinds` and
 * `/api/roles`; `terms` fetches `/api/time-grids`; `screens` fetches
 * `/api/rooms`. One 403 rejects the whole wave, and because the page awaits the
 * useAsyncData HANDLE (which resolves rather than rejects) it does not blank:
 * `row` stays null and `seed()` fills every control with an empty value.
 *
 * WORSE THAN THE RELATION CASE, which merely rendered an empty option list. Here
 * the form shows blank inputs over a record that has data, and Save is gated on
 * `isDirty` alone, so editing ONE field makes `save()` PATCH every field,
 * most of them blank. That is silent data destruction, not a confusing screen.
 *
 * The relation fix does not transfer: a picker can be omitted, a `reference` field
 * cannot: omitting it drops it from saves.
 */
const TENANT_A = 'test-tenant-a';
const EDITOR = 'offering-editor@test.local';

let cookie: string | null;
let offeringId: string;

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

/**
 * `offering.*` and NOTHING that lets the form's reference wave resolve.
 *
 * `offerings` declares reference fields onto terms, session-kinds and roles, so
 * this role can read and edit an Offering while every one of its option lists
 * answers 403, the exact asymmetry the bug needs.
 */
async function seedOfferingEditor() {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${EDITOR}'`);

    const role = await ownerDb.accessRole.create({
        data: { tenantId: TENANT_A, key: 'offering-editor-wave', name: 'Offering Editor' },
    });

    await ownerDb.accessRolePermission.createMany({
        data: ['offering.read', 'offering.update']
            .map((permissionKey) => ({ accessRoleId: role.id, permissionKey, tenantId: TENANT_A })),
    });

    const person = await ownerDb.person.create({
        data: { tenantId: TENANT_A, givenName: 'Wave', familyName: 'Editor', email: 'wave@a.test' },
    });

    await ownerDb.personAccessRole.create({
        data: { personId: person.id, accessRoleId: role.id, tenantId: TENANT_A },
    });

    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });
    const account = await ownerDb.account.create({
        data: { email: EDITOR, passwordHash: template.passwordHash },
    });

    await ownerDb.accountPerson.create({ data: { accountId: account.id, personId: person.id } });
}

beforeAll(async () => {
    const ids = await seed();

    offeringId = `test-offering-a`;
    void ids;

    await seedOfferingEditor();
    ({ cookie } = await login(EDITOR, TEST_PASSWORD));
});

afterAll(async () => {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${EDITOR}'`);
    await teardown();
    await ownerDb.$disconnect();
});

describe('the row survives a reference list it may not read', () => {
    it('confirms the asymmetry this test depends on', async () => {
        // Guards the guard. If this role could read /api/terms, every assertion
        // below would pass against a completely broken implementation.
        const row = await fetch(`${BASE}/api/offerings/${offeringId}`, { headers: { cookie: cookie! } });
        const refs = await fetch(`${BASE}/api/terms`, { headers: { cookie: cookie! } });

        expect(row.status, 'the editor must be able to read its own row').toBe(200);
        expect(refs.status, 'the editor must NOT be able to read the reference list').toBe(403);
    });

    it('renders the record, not blank inputs over it', async () => {
        const html = await fetch(`${BASE}/manage/offerings/${offeringId}`, {
            headers: { cookie: cookie! },
        }).then((res) => res.text())
            // Rendered body only: the hydration payload would match for a page
            // that rendered nothing.
            .then((body) => body.split('<script type="application/json"')[0] ?? '');

        /*
         * `Databases` is the fixture Offering's title, held in a plain text
         * field with no reference of its own. If the wave took the row down with
         * it, this is the assertion that says so: the title input is empty and
         * the record's own name is nowhere on the page.
         */
        expect(html, 'the row was lost with the reference wave').toContain('Databases');
    });

    it('says WHY the reference field is not editable', async () => {
        // A locked field with no explanation reads as one somebody chose to
        // freeze. It also has to say saving will not clear it, because
        // "read-only" does not distinguish those and the difference is data.
        const html = await fetch(`${BASE}/manage/offerings/${offeringId}`, {
            headers: { cookie: cookie! },
        }).then((res) => res.text());

        expect(html).toContain('could not be loaded');
        expect(html).toContain('will not be changed by saving');
    });

    it('pins the SERVER property the fix relies on: an omitted key is left alone', async () => {
        /*
         * SCOPE, STATED HONESTLY. This does not exercise `save()`; it PATCHes
         * the API directly, and it passes against the unfixed composable too.
         * What it pins is the server contract the client-side fix DEPENDS on:
         * a field absent from the body keeps its stored value rather than being
         * nulled. `isFieldLocked` omits locked references from the payload, and
         * that is only safe while this holds.
         *
         * Driving the real `save()` would need a browser; the payload decision
         * is asserted where it lives instead; see the composable's
         * `isFieldLocked`, and the rendered read-only state above, which is the
         * observable half.
         *
         * Asserted against the DATABASE, not the response: a PATCH that clears a
         * column still answers 200.
         */
        const before = await ownerDb.$queryRawUnsafe<{ term_id: string; kind_id: string }[]>(
            `SELECT term_id, kind_id FROM offering WHERE id = $1`, offeringId,
        );

        expect(before[0]?.term_id, 'fixture must start with a term').toBeTruthy();

        // Exactly what the UI does when somebody edits the one field they can:
        // the payload omits the locked references.
        // `api()`, not a raw `fetch`: a state-changing call needs the CSRF
        // pairing `api()` attaches (issue #113): a raw `fetch` here has no
        // way to learn or send it and always 403s.
        const res = await api(`/api/offerings/${offeringId}`, {
            method: 'PATCH',
            cookie: cookie!,
            body: JSON.stringify({ title: 'Databases II' }),
        });

        expect(res.status).toBe(200);

        const after = await ownerDb.$queryRawUnsafe<{ term_id: string; kind_id: string; title: string }[]>(
            `SELECT term_id, kind_id, title FROM offering WHERE id = $1`, offeringId,
        );

        expect(after[0]?.title).toBe('Databases II');
        expect(after[0]?.term_id, 'the term was blanked by an unrelated edit').toBe(before[0]!.term_id);
        expect(after[0]?.kind_id, 'the kind was blanked by an unrelated edit').toBe(before[0]!.kind_id);
    });

    it('keeps the ROW fetch fatal, its rejection is rethrown, not absorbed', async () => {
        /*
         * The counter-example for `allSettled`: degrading the REFERENCE fetches
         * must not also degrade the ROW fetch, which is why `rowResult` is
         * rethrown rather than defaulted to null.
         *
         * ASSERTED ON THE API, and that is a deliberate limit rather than
         * laziness. `/manage/offerings/<missing id>` answers **200 with an empty
         * form**, a SEPARATE, PRE-EXISTING bug, on the mechanism
         * `manage-relation-gates.test.ts` already describes: the page awaits the
         * useAsyncData HANDLE, which resolves rather than rejects, so a throw
         * inside the handler never reaches Nuxt's error path.
         *
         * It is not caused by this fix and is tracked on its own card. It was
         * briefly MASKED here: before this change the reference 403 won the
         * `Promise.all` race and produced a non-200, so an earlier draft of this
         * test passed for the wrong reason. Recorded so nobody reads the 200 as
         * a regression introduced here.
         */
        const missing = await fetch(`${BASE}/api/offerings/does-not-exist-at-all`, {
            headers: { cookie: cookie! },
        });

        expect(missing.status, 'the row endpoint must still 404').toBe(404);
    });

    it('answers a missing id with the API\'s own status, not an empty form', async () => {
        /*
         * The other half, fixed in the same pass: `useAsyncData`'s handle
         * resolves even when its handler throws, so the page used to answer 200
         * with every field blank while the API answered 404. The status is
         * carried through rather than flattened: a 404 and a 403 are different
         * facts for whoever is looking.
         */
        const res = await fetch(`${BASE}/manage/offerings/does-not-exist-at-all`, {
            headers: { cookie: cookie! },
        });

        expect(res.status).toBe(404);
    });

    it('does NOT turn a locked reference into a page error: the boundary', async () => {
        /*
         * The counter-example for the throw above, and the reason `loadError` is
         * the ROW's failure alone. This role's `/api/terms` 403s on every
         * request; if that reached the page's `createError` the whole screen
         * would vanish for somebody who may legitimately edit the record, which
         * is the over-correction this pairing exists to catch.
         */
        const res = await fetch(`${BASE}/manage/offerings/${offeringId}`, {
            headers: { cookie: cookie! },
        });

        expect(res.status).toBe(200);
    });
});
