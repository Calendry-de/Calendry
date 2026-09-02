import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * Self-service availability: who may write what, about whom.
 *
 * THE MECHANISM UNDER TEST IS ROUTE SHAPE, NOT A PERMISSION FLAG. Every
 * permission in this system is tenant-wide (`person.read` means every Person),
 * and rather than teach the catalogue a "self only" semantic, the self-service
 * routes take NO person id at all: not in the path, not in the query, not in the
 * body. The subject comes from the resolved session identity, the same way
 * `tenant_id` already does on every write.
 *
 * So the important assertions here are the ones that show another Person's data
 * is UNREACHABLE rather than merely refused: there is no parameter to smuggle
 * one through, and the only id a self-service route accepts (a row id, for
 * deletion) is filtered by the caller's own person id and 404s otherwise.
 *
 * The other half is the approval gate. A veto is HARD, so a self-declared window
 * is inert until somebody with `availability.manage_any` approves it; an
 * administrator's own entry is approved on arrival, because queueing it would
 * mean approving your own authorized action.
 */
/** Pages are fetched directly; the api() helper is for JSON routes. */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8080';

let f: Fixtures;

const LECTURER = 'lecturer-self@test.local';
const OTHER_LECTURER = 'lecturer-other@test.local';
const REVIEWER = 'availability-reviewer@test.local';
const WATCHER = 'availability-watcher@test.local';

const cookies: Record<string, string> = {};
const personIds: Record<string, string> = {};

async function seedAccount(email: string, key: string, permissions: string[]) {
    await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${email}'`);

    const role = await ownerDb.accessRole.create({ data: { tenantId: f.tenantA, key, name: key } });

    await ownerDb.accessRolePermission.createMany({
        data: permissions.map((permissionKey) => ({ accessRoleId: role.id, permissionKey, tenantId: f.tenantA })),
    });

    const person = await ownerDb.person.create({
        data: { tenantId: f.tenantA, givenName: 'Ava', familyName: key, email: `${key}@a.test` },
    });

    await ownerDb.personAccessRole.create({
        data: { personId: person.id, accessRoleId: role.id, tenantId: f.tenantA },
    });

    const template = await ownerDb.account.findFirstOrThrow({ where: { email: ACCOUNTS.adminA } });
    const account = await ownerDb.account.create({ data: { email, passwordHash: template.passwordHash } });

    await ownerDb.accountPerson.create({ data: { accountId: account.id, personId: person.id } });

    personIds[key] = person.id;

    return person.id;
}

beforeAll(async () => {
    f = await seed();

    await seedAccount(LECTURER, 'lecturer-self', ['availability.manage_own']);
    await seedAccount(OTHER_LECTURER, 'lecturer-other', ['availability.manage_own']);
    await seedAccount(REVIEWER, 'availability-reviewer', ['availability.manage_any']);
    await seedAccount(WATCHER, 'availability-watcher', ['availability.read_any']);

    for (const [name, email] of [
        ['lecturer', LECTURER],
        ['other', OTHER_LECTURER],
        ['reviewer', REVIEWER],
        ['watcher', WATCHER],
        ['adminB', ACCOUNTS.adminB],
    ] as const) {
        cookies[name] = (await login(email, TEST_PASSWORD)).cookie;
    }
});

afterAll(async () => {
    for (const email of [LECTURER, OTHER_LECTURER, REVIEWER, WATCHER]) {
        await ownerDb.$executeRawUnsafe(`DELETE FROM account WHERE email = '${email}'`);
    }

    await teardown();
    await ownerDb.$disconnect();
});

const FRIDAY = { days: [5], blocks: [], weeks: [] };

describe('a lecturer, holding only availability.manage_own', () => {
    it('submits a window for themselves and it lands PENDING', async () => {
        const created = await api<{ id: string; status: string }>('/api/me/availability/vetoes', {
            method: 'POST',
            cookie: cookies.lecturer,
            body: JSON.stringify({ ...FRIDAY, reason: 'Clinic' }),
        });

        expect(created.status).toBe(201);
        expect(created.body.status).toBe('PENDING');

        const row = await ownerDb.personUnavailability.findFirstOrThrow({ where: { id: created.body.id } });

        // The subject is the SESSION's person. Nothing in the request said so.
        expect(row.personId).toBe(personIds['lecturer-self']);
        expect(row.createdByPersonId).toBe(personIds['lecturer-self']);
        // The CHECK on the table makes the other half of this unrepresentable.
        expect(row.decidedAt).toBeNull();
    });

    it('sees its status and everything the page needs, under ONE permission', async () => {
        const mine = await api<{
            personId: string;
            grid: { blocksPerDay: number } | null;
            vetoes: { status: string }[];
            blocked: { blocked: number; total: number } | null;
        }>('/api/me/availability', { cookie: cookies.lecturer });

        expect(mine.status).toBe(200);
        expect(mine.body.personId).toBe(personIds['lecturer-self']);
        expect(mine.body.vetoes[0]?.status).toBe('PENDING');

        /*
         * The GRID travels with the response. A page that fetched
         * /api/time-grids for it would 403 for this caller (they hold no
         * time_grid.read), and one refused fetch in a reference wave renders
         * every control on the page over empty data.
         */
        expect(mine.body.grid?.blocksPerDay).toBeGreaterThan(0);

        // PENDING counts as nothing, because it IS nothing until approved.
        expect(mine.body.blocked?.blocked).toBe(0);
    });

    it('cannot reach any administrator route', async () => {
        const queue = await api('/api/availability/vetoes', { cookie: cookies.lecturer });
        const forOther = await api('/api/availability/vetoes', {
            method: 'POST',
            cookie: cookies.lecturer,
            body: JSON.stringify({ personId: personIds['lecturer-other'], ...FRIDAY }),
        });
        const overview = await api('/api/availability/preferences', { cookie: cookies.lecturer });

        expect(queue.status).toBe(403);
        expect(forOther.status).toBe(403);
        expect(overview.status).toBe(403);
    });

    it('cannot delete another person\'s window', async () => {
        const theirs = await ownerDb.personUnavailability.create({
            data: {
                tenantId: f.tenantA,
                personId: personIds['lecturer-other'],
                ...FRIDAY,
                status: 'PENDING',
                createdByPersonId: personIds['lecturer-other'],
            },
        });

        const attempt = await api(`/api/me/availability/vetoes/${theirs.id}`, {
            method: 'DELETE',
            cookie: cookies.lecturer,
        });

        // 404, not 403: the route filters by the caller's own person, so
        // somebody else's row simply is not there to be found, the same shape a
        // cross-TENANT id already produces everywhere else.
        expect(attempt.status).toBe(404);
        expect(await ownerDb.personUnavailability.count({ where: { id: theirs.id } })).toBe(1);
    });

    it('may delete its own window at any status, with no approval', async () => {
        const own = await ownerDb.personUnavailability.create({
            data: {
                tenantId: f.tenantA,
                personId: personIds['lecturer-self'],
                days: [2], blocks: [], weeks: [],
                status: 'APPROVED',
                createdByPersonId: personIds['lecturer-self'],
                decidedByPersonId: personIds['availability-reviewer'],
                decidedAt: new Date(),
            },
        });

        const removed = await api(`/api/me/availability/vetoes/${own.id}`, {
            method: 'DELETE',
            cookie: cookies.lecturer,
        });

        // Deleting RELAXES the problem. Approval exists to stop unilateral
        // tightening, so requiring it here would be ceremony with a cost and no
        // benefit.
        expect(removed.status).toBe(204);
    });

    it('is refused a window that blocks everything', async () => {
        const total = await api<{ statusMessage?: string }>('/api/me/availability/vetoes', {
            method: 'POST',
            cookie: cookies.lecturer,
            body: JSON.stringify({ days: [], blocks: [], weeks: [] }),
        });

        // Legal on the wire and honoured literally by the solver, which is
        // exactly why it is refused at the boundary rather than routed through
        // approval where it might be waved past in a list of twenty.
        expect(total.status).toBe(422);
        expect(JSON.stringify(total.body)).toContain('never available');
    });
});

describe('review', () => {
    it('lets a reviewer see the queue with names attached', async () => {
        const queue = await api<{ rows: { id: string; status: string; person: { givenName: string } | null }[] }>(
            '/api/availability/vetoes?status=PENDING',
            { cookie: cookies.reviewer },
        );

        expect(queue.status).toBe(200);
        expect(queue.body.rows.length).toBeGreaterThan(0);
        // Names travel with the rows; fetching /api/persons would need
        // person.read, which this page is not gated on.
        expect(queue.body.rows[0]?.person?.givenName).toBeTruthy();
    });

    it('lets read_any look but not decide', async () => {
        const seen = await api<{ rows: { id: string }[] }>(
            '/api/availability/vetoes?status=PENDING',
            { cookie: cookies.watcher },
        );

        expect(seen.status).toBe(200);

        const decided = await api(`/api/availability/vetoes/${seen.body.rows[0]?.id}/decision`, {
            method: 'POST',
            cookie: cookies.watcher,
            body: JSON.stringify({ decision: 'APPROVED' }),
        });

        // The whole reason read_any exists as its own key: a scheduler who may
        // see who is unavailable without being able to change it.
        expect(decided.status).toBe(403);
    });

    it('records who decided and when, and refuses a second decision', async () => {
        const pending = await ownerDb.personUnavailability.findFirstOrThrow({
            where: { tenantId: f.tenantA, status: 'PENDING' },
        });

        const approved = await api<{ status: string }>(`/api/availability/vetoes/${pending.id}/decision`, {
            method: 'POST',
            cookie: cookies.reviewer,
            body: JSON.stringify({ decision: 'APPROVED', note: 'Confirmed with the department' }),
        });

        expect(approved.status).toBe(200);
        expect(approved.body.status).toBe('APPROVED');

        const row = await ownerDb.personUnavailability.findFirstOrThrow({ where: { id: pending.id } });

        expect(row.decidedByPersonId).toBe(personIds['availability-reviewer']);
        expect(row.decidedAt).not.toBeNull();
        expect(row.decisionNote).toBe('Confirmed with the department');

        const again = await api<{ statusMessage?: string }>(`/api/availability/vetoes/${pending.id}/decision`, {
            method: 'POST',
            cookie: cookies.reviewer,
            body: JSON.stringify({ decision: 'REJECTED' }),
        });

        // Re-deciding would silently rewrite who approved it and when: a
        // reviewer clicking twice on a stale list taking ownership of somebody
        // else's decision.
        expect(again.status).toBe(409);
    });

    it('writes an administrator\'s own entry as APPROVED, decided by them', async () => {
        const created = await api<{ id: string; status: string }>('/api/availability/vetoes', {
            method: 'POST',
            cookie: cookies.reviewer,
            body: JSON.stringify({ personId: personIds['lecturer-other'], days: [4], blocks: [1], weeks: [] }),
        });

        expect(created.status).toBe(201);
        expect(created.body.status).toBe('APPROVED');

        const row = await ownerDb.personUnavailability.findFirstOrThrow({ where: { id: created.body.id } });

        // Queueing this would mean approving your own authorized action.
        // `availability.manage_any` IS the authority the approval step checks.
        expect(row.decidedByPersonId).toBe(personIds['availability-reviewer']);
        expect(row.createdByPersonId).toBe(personIds['availability-reviewer']);
    });

    it('404s a subject from another tenant rather than failing on the policy', async () => {
        const foreign = await api('/api/availability/vetoes', {
            method: 'POST',
            cookie: cookies.reviewer,
            body: JSON.stringify({ personId: f.personB, ...FRIDAY }),
        });

        expect(foreign.status).toBe(404);
    });

    it('shows a tenant nothing of another tenant\'s queue', async () => {
        const theirs = await api<{ rows: unknown[] }>('/api/availability/vetoes', { cookie: cookies.adminB });

        // Tenant B's administrator holds every permission in tenant B. RLS plus
        // the explicit tenant filter mean tenant A's rows are not merely
        // hidden from the UI.
        expect(theirs.status).toBe(200);
        expect(theirs.body.rows).toEqual([]);
    });
});

describe('preferences', () => {
    it('are written directly, with no approval step', async () => {
        const saved = await api<{ preferredDays: number[]; preferredBlocks: number[] }>('/api/me/preferences', {
            method: 'PUT',
            cookie: cookies.lecturer,
            body: JSON.stringify({ preferredDays: [4, 2, 2], preferredBlocks: [1, 0] }),
        });

        expect(saved.status).toBe(200);
        // Deduplicated and sorted, so two identical preferences cannot be stored
        // in two shapes that compare differently.
        expect(saved.body.preferredDays).toEqual([2, 4]);
        expect(saved.body.preferredBlocks).toEqual([0, 1]);
    });

    /*
     * The third axis. Two things that only break over HTTP: the id must be one
     * this tenant can see (the FK cannot tell, because Postgres runs referential
     * integrity as the referenced table's owner and never consults RLS), and a
     * preference holding ONLY room types must survive: the row is deleted when
     * every axis is empty, and "every" now means three.
     */
    it('store preferred room types, and refuse an id this tenant cannot see', async () => {
        const equipment = await ownerDb.equipment.create({
            data: { tenantId: f.tenantA, key: 'api-lab-bench', name: 'Lab bench' },
        });

        const saved = await api<{ preferredRoomFeatureIds: string[] }>('/api/me/preferences', {
            method: 'PUT',
            cookie: cookies.lecturer,
            body: JSON.stringify({
                preferredDays: [], preferredBlocks: [], preferredRoomFeatureIds: [equipment.id],
            }),
        });

        expect(saved.status).toBe(200);
        // Room types alone are a preference, so the row must exist rather than
        // having been deleted as empty.
        expect(await ownerDb.personPreference.count({
            where: { personId: personIds['lecturer-self'] },
        })).toBe(1);

        const refused = await api('/api/me/preferences', {
            method: 'PUT',
            cookie: cookies.lecturer,
            body: JSON.stringify({
                preferredDays: [2], preferredBlocks: [], preferredRoomFeatureIds: ['no-such-equipment'],
            }),
        });

        // Named, not filtered: a silently narrowed save reports success for a
        // preference that was not stored.
        expect(refused.status).toBe(400);
        expect(JSON.stringify(refused.body)).toContain('no-such-equipment');
    });

    it('DELETE the row when every axis is cleared, room types included', async () => {
        await api('/api/me/preferences', {
            method: 'PUT',
            cookie: cookies.lecturer,
            body: JSON.stringify({ preferredDays: [], preferredBlocks: [], preferredRoomFeatureIds: [] }),
        });

        // An absent row IS the "no preference" state. Storing two empty arrays
        // would give that state a second representation that renders identically
        // and compares differently.
        const rows = await ownerDb.personPreference.count({ where: { personId: personIds['lecturer-self'] } });

        expect(rows).toBe(0);
    });

    it('let an administrator set anyone\'s, and read_any only look', async () => {
        const set = await api('/api/availability/preferences/' + personIds['lecturer-other'], {
            method: 'PUT',
            cookie: cookies.reviewer,
            body: JSON.stringify({ preferredDays: [1], preferredBlocks: [] }),
        });

        expect(set.status).toBe(200);

        const refused = await api('/api/availability/preferences/' + personIds['lecturer-other'], {
            method: 'PUT',
            cookie: cookies.watcher,
            body: JSON.stringify({ preferredDays: [3], preferredBlocks: [] }),
        });

        expect(refused.status).toBe(403);
    });

    it('REFUSE a weightMultiplier on the self-service path, rather than dropping it', async () => {
        /*
         * The one place the two write paths stop being the same operation. A
         * person raising their own weight is the unilateral escalation that soft
         * preferences are otherwise free of.
         *
         * Asserting a 400 and NOT a silent 200 is the whole point: zod strips
         * unknown keys, so the accepted-and-discarded behaviour would look
         * identical to success from the caller's side.
         */
        const refused = await api<{ data?: { field?: string } }>('/api/me/preferences', {
            method: 'PUT',
            cookie: cookies.lecturer,
            body: JSON.stringify({ preferredDays: [2], preferredBlocks: [0], weightMultiplier: 2 }),
        });

        expect(refused.status).toBe(400);

        // And nothing was written, so the refusal is not partial.
        const row = await ownerDb.personPreference.findFirst({
            where: { personId: personIds['lecturer-self'] },
        });

        expect(row?.weightMultiplier ?? null).toBeNull();
    });

    it('let an administrator set a weightMultiplier inside the clamp', async () => {
        const set = await api<{ weightMultiplier: number | null }>(
            '/api/availability/preferences/' + personIds['lecturer-other'],
            {
                method: 'PUT',
                cookie: cookies.reviewer,
                body: JSON.stringify({ preferredDays: [1], preferredBlocks: [], weightMultiplier: 1.5 }),
            },
        );

        expect(set.status).toBe(200);
        expect(set.body.weightMultiplier).toBe(1.5);

        const stored = await ownerDb.personPreference.findFirstOrThrow({
            where: { personId: personIds['lecturer-other'] },
        });

        expect(stored.weightMultiplier).toBe(1.5);
    });

    it.each([
        ['below the floor', 0.4],
        ['above the ceiling', 2.1],
    ])('REFUSE a weightMultiplier %s', async (_label, multiplier) => {
        // Both directions, the same shape as the blocksPerDay boundary checks:
        // a clamp tested on one side is a clamp half tested.
        const refused = await api('/api/availability/preferences/' + personIds['lecturer-other'], {
            method: 'PUT',
            cookie: cookies.reviewer,
            body: JSON.stringify({ preferredDays: [1], preferredBlocks: [], weightMultiplier: multiplier }),
        });

        expect(refused.status).toBe(400);
    });

    it('accept the exact clamp boundaries, which are legal values', async () => {
        for (const multiplier of [0.5, 2]) {
            const set = await api<{ weightMultiplier: number | null }>(
                '/api/availability/preferences/' + personIds['lecturer-other'],
                {
                    method: 'PUT',
                    cookie: cookies.reviewer,
                    body: JSON.stringify({ preferredDays: [1], preferredBlocks: [], weightMultiplier: multiplier }),
                },
            );

            expect(set.status).toBe(200);
            expect(set.body.weightMultiplier).toBe(multiplier);
        }
    });

    it('CLEAR the override when the multiplier is omitted: true replace, not partial update', async () => {
        const personId = personIds['lecturer-other'];

        await api('/api/availability/preferences/' + personId, {
            method: 'PUT',
            cookie: cookies.reviewer,
            body: JSON.stringify({ preferredDays: [1], preferredBlocks: [], weightMultiplier: 1.5 }),
        });

        /*
         * The same endpoint, the same person, no multiplier in the body. This is
         * a PUT and replaces the whole preference state, so an absent key means
         * `null`, NOT "leave it alone". That is why the staff page sends the
         * multiplier on every save alongside both arrays: were it sent only when
         * changed, clearing an override would depend on which fields the page
         * happened to include, and the multiplier would be a partial-update side
         * channel while everything around it was full-replace.
         */
        const replaced = await api<{ weightMultiplier: number | null }>(
            '/api/availability/preferences/' + personId,
            {
                method: 'PUT',
                cookie: cookies.reviewer,
                body: JSON.stringify({ preferredDays: [1], preferredBlocks: [] }),
            },
        );

        expect(replaced.status).toBe(200);
        expect(replaced.body.weightMultiplier).toBeNull();

        const stored = await ownerDb.personPreference.findFirstOrThrow({ where: { personId } });

        expect(stored.weightMultiplier).toBeNull();
    });

    it('CLEAR the override on an explicit null, the way the control\'s "Use default" sends it', async () => {
        const personId = personIds['lecturer-other'];

        await api('/api/availability/preferences/' + personId, {
            method: 'PUT',
            cookie: cookies.reviewer,
            body: JSON.stringify({ preferredDays: [1], preferredBlocks: [], weightMultiplier: 2 }),
        });

        const cleared = await api<{ weightMultiplier: number | null }>(
            '/api/availability/preferences/' + personId,
            {
                method: 'PUT',
                cookie: cookies.reviewer,
                body: JSON.stringify({ preferredDays: [1], preferredBlocks: [], weightMultiplier: null }),
            },
        );

        expect(cleared.status).toBe(200);
        expect(cleared.body.weightMultiplier).toBeNull();
    });

    it('REACH the rendered staff page, so the value is visible without opening a row', async () => {
        const personId = personIds['lecturer-other'];

        await api('/api/availability/preferences/' + personId, {
            method: 'PUT',
            cookie: cookies.reviewer,
            body: JSON.stringify({ preferredDays: [2], preferredBlocks: [], weightMultiplier: 1.5 }),
        });

        /*
         * Server-rendered, so this proves the whole read path (GET select, the
         * page's row type, and the summary label), not just that the column
         * stores a number. The expanded editor cannot be reached over SSR (it
         * renders behind a click), which is exactly why the override belongs in
         * the collapsed summary as well as in the control.
         */
        const page = await fetch(`${BASE}/manage/availability/preferences`, {
            headers: { cookie: cookies.reviewer },
        });
        const html = await page.text();

        expect(page.status).toBe(200);
        // Paired with a positive control: "the number is absent" also passes on
        // a page that failed to render at all.
        expect(html).toContain('Teaching preferences');
        expect(html).toContain('counts 1.5×');
    });

    it('are refused by the DATABASE too, for writes that never reach a handler', async () => {
        /*
         * `provision-tenant.ts` and any backfill write with `createMany` and
         * never pass through a route, so a clamp living only in zod is one a
         * script can walk around, the same reason
         * `constraint_weight_non_negative` exists as a CHECK as well as a
         * refinement. Raw SQL here, deliberately around the application layer.
         */
        const personId = personIds['lecturer-other'];

        // Set a KNOWN value first: asserting the row is unchanged afterwards is
        // only meaningful against a value this test put there, and an earlier
        // test in this block may have left a different one.
        await api('/api/availability/preferences/' + personId, {
            method: 'PUT',
            cookie: cookies.reviewer,
            body: JSON.stringify({ preferredDays: [1], preferredBlocks: [], weightMultiplier: 2 }),
        });

        // Matched by NAME, not merely "it threw": a bare rejects.toThrow() would
        // pass on a typo in the SQL, on an RLS refusal, or on a missing column,
        // none of which would prove the clamp is enforced.
        await expect(ownerDb.$executeRawUnsafe(
            'UPDATE person_preference SET weight_multiplier = 9 WHERE person_id = $1',
            personId,
        )).rejects.toThrow(/person_preference_weight_multiplier_range/);

        // And the row is unchanged, so the CHECK rejected rather than partially applied.
        const stored = await ownerDb.personPreference.findFirstOrThrow({ where: { personId } });

        expect(stored.weightMultiplier).toBe(2);
    });

    it('list EVERY active person, not only those who set something', async () => {
        const overview = await api<{ people: { id: string; preference: unknown }[] }>(
            '/api/availability/preferences',
            { cookie: cookies.watcher },
        );

        expect(overview.status).toBe(200);

        // "Who has set preferences" and "who has, and who has not" are different
        // questions, and the administrator has the second one. Omitting the
        // people with no row is the omission that made a missing constraint type
        // look like a complete catalogue.
        const withNone = overview.body.people.filter((person) => person.preference === null);

        expect(withNone.length).toBeGreaterThan(0);
        expect(overview.body.people.some((person) => person.id === personIds['lecturer-other'])).toBe(true);
    });
});

/**
 * Date-range absences: the second entry mode, on both surfaces.
 *
 * The lecturer picks DATES. Week indices are resolved server-side from the
 * term's own calendar, because that arithmetic is `weekIndexOf` and this project
 * has already had to unify two copies of it that agreed until they did not.
 *
 * The term is derived from the dates too, and both ways of failing to derive one
 * are refusals rather than guesses: a stored row that resolves to nothing would
 * be inert forever, which is the failure mode this whole area keeps closing.
 */
describe('holiday entry', () => {
    // Fixture term A runs 2026-10-01 to 2027-02-28.
    const IN_TERM = { startDate: '2026-11-04', endDate: '2026-11-13' };

    it('turns a date range into whole weeks, anchored to the term', async () => {
        const created = await api<{
            id: string; status: string; weeks: number[];
            term: { id: string; name: string };
            touched: { index: number; whole: boolean }[];
        }>('/api/me/availability/holidays', {
            method: 'POST',
            cookie: cookies.lecturer,
            body: JSON.stringify({ ...IN_TERM, reason: 'Annual leave' }),
        });

        expect(created.status).toBe(201);
        expect(created.body.status).toBe('PENDING');
        expect(created.body.weeks.length).toBeGreaterThan(0);
        expect(created.body.term.id).toBe(f.termA);

        const row = await ownerDb.personUnavailability.findFirstOrThrow({ where: { id: created.body.id } });

        // Days and blocks empty = every day, every block, OF THOSE WEEKS. The
        // term is what makes the week indices mean anything.
        expect(row.days).toEqual([]);
        expect(row.blocks).toEqual([]);
        expect(row.termId).toBe(f.termA);

        // A Wednesday-to-Friday range touches two weeks and covers neither in
        // full, and the response says so: the form shows this before submitting
        // rather than leaving the over-block to be discovered in a timetable.
        expect(created.body.touched.some((week) => !week.whole)).toBe(true);
    });

    it('refuses a range that falls outside every term, naming them', async () => {
        const outside = await api<{ statusMessage?: string }>('/api/me/availability/holidays', {
            method: 'POST',
            cookie: cookies.lecturer,
            body: JSON.stringify({ startDate: '2030-06-01', endDate: '2030-06-08' }),
        });

        // Stored, it would block nothing, forever, with nothing to say why.
        expect(outside.status).toBe(422);
        expect(JSON.stringify(outside.body)).toContain('outside every term');
    });

    it('refuses a range spanning two terms rather than picking one', async () => {
        const second = await ownerDb.term.create({
            data: {
                id: 'test-term-a-span', tenantId: f.tenantA, name: 'Spring',
                startDate: new Date('2027-03-01'), endDate: new Date('2027-07-31'),
            },
        });

        const spanning = await api<{ statusMessage?: string }>('/api/me/availability/holidays', {
            method: 'POST',
            cookie: cookies.lecturer,
            body: JSON.stringify({ startDate: '2027-02-20', endDate: '2027-03-10' }),
        });

        // One row counts one term's weeks. Choosing either end silently loses
        // half the absence.
        expect(spanning.status).toBe(422);
        expect(JSON.stringify(spanning.body)).toContain('more than one term');

        await ownerDb.term.delete({ where: { id: second.id } });
    });

    it('refuses an end date before the start', async () => {
        const backwards = await api('/api/me/availability/holidays', {
            method: 'POST',
            cookie: cookies.lecturer,
            body: JSON.stringify({ startDate: '2026-11-13', endDate: '2026-11-04' }),
        });

        expect(backwards.status).toBe(400);
    });

    it('lets an administrator record one, approved on arrival', async () => {
        const created = await api<{ id: string; status: string }>('/api/availability/vetoes/holidays', {
            method: 'POST',
            cookie: cookies.reviewer,
            body: JSON.stringify({ ...IN_TERM, personId: personIds['lecturer-other'] }),
        });

        expect(created.status).toBe(201);
        expect(created.body.status).toBe('APPROVED');

        const row = await ownerDb.personUnavailability.findFirstOrThrow({ where: { id: created.body.id } });

        // Same resolver as the self-service route, so an administrator's holiday
        // lands on the same weeks a lecturer's would.
        expect(row.termId).toBe(f.termA);
        expect(row.decidedByPersonId).toBe(personIds['availability-reviewer']);
    });

    it('refuses a lecturer recording one for somebody else', async () => {
        const forOther = await api('/api/availability/vetoes/holidays', {
            method: 'POST',
            cookie: cookies.lecturer,
            body: JSON.stringify({ ...IN_TERM, personId: personIds['lecturer-other'] }),
        });

        expect(forOther.status).toBe(403);
    });

    it('carries people, grid and terms on the review endpoint', async () => {
        const queue = await api<{
            rows: unknown[]; people: unknown[];
            grid: { blocksPerDay: number } | null;
            terms: { id: string }[];
        }>('/api/availability/vetoes', { cookie: cookies.reviewer });

        expect(queue.status).toBe(200);

        /*
         * The entry form needs all three, and fetching them from /api/persons,
         * /api/time-grids and /api/terms would need three permissions this page
         * is not gated on.
         */
        expect(queue.body.people.length).toBeGreaterThan(0);
        expect(queue.body.grid?.blocksPerDay).toBeGreaterThan(0);
        expect(queue.body.terms.some((term) => term.id === f.termA)).toBe(true);
    });
});

/**
 * Both tables are ORDINARY tenant-scoped tables: no new RLS exception.
 *
 * The design deliberately did not push self-scoping into the database. Doing so
 * would need a second, CONDITIONAL isolation dimension (a `calendry.person_id`
 * GUC set on some requests and not others) so the policy could tell an
 * administrator editing anyone from a person editing themselves, and CLAUDE.md
 * requires a comparably strong reason for a new RLS-widening path. "The route
 * could also have enforced this" is not one.
 *
 * So what the database guarantees here is exactly what it guarantees everywhere
 * else, and these assertions pin that rather than taking it on faith. The
 * negative cases are the point: a suite asserting only "the app role can write a
 * window" would pass just as well against a build with `tenant_isolation`
 * dropped from these two tables.
 */
function asTenant<T>(tenantId: string, fn: (tx: typeof ownerDb) => Promise<T>): Promise<T> {
    return ownerDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE calendry_app');
        await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${tenantId}'`);

        return fn(tx as typeof ownerDb);
    });
}

describe('row-level security on the two new tables', () => {
    it('lets the app role write and read back inside its own tenant', async () => {
        const created = await asTenant(f.tenantA, (tx) => tx.personUnavailability.create({
            data: {
                tenantId: f.tenantA,
                personId: personIds['lecturer-self'],
                days: [3], blocks: [], weeks: [],
                status: 'PENDING',
                createdByPersonId: personIds['lecturer-self'],
            },
            select: { id: true },
        }));

        const seen = await asTenant(f.tenantA, (tx) => tx.personUnavailability.count({ where: { id: created.id } }));

        // A row the app role can write but not see would be a policy asymmetry,
        // and the feature would report success over data it can never use.
        expect(seen).toBe(1);
    });

    it('hides those rows from another tenant', async () => {
        const fromB = await asTenant(f.tenantB, (tx) => tx.personUnavailability.count({}));

        expect(fromB).toBe(0);
    });

    it('refuses a write carrying a foreign tenant_id', async () => {
        await expect(asTenant(f.tenantB, (tx) => tx.personPreference.create({
            data: { personId: personIds['lecturer-self'], tenantId: f.tenantA, preferredDays: [1], preferredBlocks: [] },
        }))).rejects.toThrow();
    });

    it('refuses a write with no tenant context at all', async () => {
        await expect(ownerDb.$transaction(async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL ROLE calendry_app');

            return tx.personPreference.create({
                data: { personId: personIds['lecturer-other'], tenantId: f.tenantA, preferredDays: [1], preferredBlocks: [] },
            });
        })).rejects.toThrow();
    });

    it('refuses a half-decided row at the database, not just in the route', async () => {
        // APPROVED with no decision timestamp is unrepresentable by CHECK, so a
        // future write path that forgot to stamp it fails loudly instead of
        // leaving a row nobody can explain.
        await expect(asTenant(f.tenantA, (tx) => tx.personUnavailability.create({
            data: {
                tenantId: f.tenantA,
                personId: personIds['lecturer-self'],
                days: [1], blocks: [], weeks: [],
                status: 'APPROVED',
                createdByPersonId: personIds['lecturer-self'],
            },
        }))).rejects.toThrow();
    });
});
