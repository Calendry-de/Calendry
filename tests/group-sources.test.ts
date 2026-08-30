import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * A Group assembled from other Groups — two cohorts' Management tracks taught
 * together.
 *
 * THE MODEL ALREADY EXPRESSED THIS, which is why the work is tooling rather
 * than schema: a combined group is an ordinary ROOT-LEVEL Group with its own
 * membership, and a student in both their cohort and it is double-booked on the
 * PERSON axis because `attendees_of` expands a Session's groups through
 * `expand_subtree` and collects their members. What was missing is any record
 * of WHERE that membership came from — somebody hand-added forty students and
 * nothing said why those forty.
 *
 * NOT A SECOND PARENT. Both track groups already have one, so a combining group
 * above them makes the hierarchy a DAG, and `Group.parent_id` is singular on the
 * wire while all three closure walks assume a tree.
 *
 * MATERIALISED, and the tests below are mostly about what that costs. A live
 * union would always be right and would move a timetable's attendee set between
 * two solves with nothing recording it. Materialised goes stale instead — so
 * the drift readout is not a nicety, it is the thing that makes the choice
 * defensible.
 */
let f: Fixtures;
let cookie = '';
let combined = '';
let trackA = '';
let trackB = '';
const people: string[] = [];

const drift = () => api<{
    sourceCount: number; generatedAt: string | null; memberCount: number;
    expectedCount: number; added: number; removed: number;
}>(`/api/group-sources/${combined}/drift`, { cookie });

const regenerate = () => api<{ memberCount: number; added: number; removed: number }>(
    `/api/group-sources/${combined}/regenerate`,
    { method: 'POST', cookie, body: '{}' },
);

const setSources = (ids: string[]) => api(`/api/groups/${combined}/sources`, {
    method: 'PUT',
    cookie,
    // A BARE ARRAY, not `{ rows }` — `[relation].put.ts` parses `z.array(item)`.
    body: JSON.stringify(ids.map((sourceGroupId) => ({ sourceGroupId }))),
});

beforeAll(async () => {
    f = await seed();
    cookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;

    const t = f.tenantA;

    // Two cohort-nested track groups, and a root-level group to combine them —
    // the shape the feature exists for.
    trackA = (await ownerDb.group.create({
        data: { tenantId: t, parentGroupId: f.groupCohortA, name: 'S1 Management' },
    })).id;
    trackB = (await ownerDb.group.create({
        data: { tenantId: t, parentGroupId: f.groupSeminarA, name: 'S2 Management' },
    })).id;
    combined = (await ownerDb.group.create({
        data: { tenantId: t, name: 'Management (combined)' },
    })).id;

    for (let i = 0; i < 4; i += 1) {
        const person = await ownerDb.person.create({
            data: { tenantId: t, givenName: 'Track', familyName: `Student ${i}`, email: `track${i}@a.test` },
        });

        people.push(person.id);
        await ownerDb.membership.create({
            data: { tenantId: t, personId: person.id, groupId: i < 2 ? trackA : trackB },
        });
    }
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('before anything is copied', () => {
    it('reports never generated, which is not the same as up to date', async () => {
        await setSources([trackA, trackB]);

        const res = await drift();

        expect(res.status).toBe(200);
        // Three states, and this is the one a member count alone cannot tell
        // apart from "generated and unchanged".
        expect(res.body.generatedAt).toBeNull();
        expect(res.body.memberCount).toBe(0);
        expect(res.body.expectedCount).toBe(4);
        expect(res.body.added).toBe(4);
    });

    it('exposes counts, never person ids', async () => {
        // `group.read` is not `person.read`; shipping the ids would make this a
        // way to read a roll the caller may not otherwise see.
        const res = await drift();

        expect(JSON.stringify(res.body)).not.toContain(people[0]!);
    });
});

describe('regenerating', () => {
    it('copies every source’s members in', async () => {
        const res = await regenerate();

        expect(res.status).toBe(200);
        expect(res.body.memberCount).toBe(4);

        const members = await ownerDb.membership.findMany({ where: { groupId: combined } });

        expect(members.map((m) => m.personId).sort()).toEqual([...people].sort());
    });

    it('reports current afterwards, and stale means DIFFERENT not old', async () => {
        const res = await drift();

        expect(res.body.generatedAt).not.toBeNull();
        expect(res.body.added).toBe(0);
        expect(res.body.removed).toBe(0);
    });

    it('does not move until asked — the whole reason it is materialised', async () => {
        const extra = await ownerDb.person.create({
            data: { tenantId: f.tenantA, givenName: 'Late', familyName: 'Joiner', email: 'late@a.test' },
        });

        await ownerDb.membership.create({
            data: { tenantId: f.tenantA, personId: extra.id, groupId: trackA },
        });

        // A solve now sees the SAME attendees it saw a minute ago. That is the
        // property a derived membership would not have.
        expect(await ownerDb.membership.count({ where: { groupId: combined } })).toBe(4);

        const stale = await drift();

        // ...and the staleness is visible, which is what makes it acceptable.
        expect(stale.body.added).toBe(1);
        expect(stale.body.removed).toBe(0);

        await regenerate();
        expect(await ownerDb.membership.count({ where: { groupId: combined } })).toBe(5);
    });

    it('REPLACES rather than merges, so leaving a source leaves the group', async () => {
        await ownerDb.membership.deleteMany({ where: { groupId: trackA } });

        const res = await regenerate();

        expect(res.body.removed).toBe(3);
        expect(await ownerDb.membership.count({ where: { groupId: combined } })).toBe(2);
    });

    it('refuses when there are no sources, rather than emptying the group', async () => {
        await setSources([]);

        const res = await regenerate();

        // Destructive answer to a request that reads as harmless, and
        // indistinguishable from "every source is empty" — which IS legitimate.
        expect(res.status).toBe(422);
        expect(await ownerDb.membership.count({ where: { groupId: combined } })).toBe(2);
    });
});

describe('the shape the feature relies on', () => {
    it('refuses a group drawing from itself', async () => {
        // The database says so, so no route can forget to.
        await expect(ownerDb.$executeRawUnsafe(
            `INSERT INTO group_source (tenant_id, group_id, source_group_id)
             VALUES ('${f.tenantA}', '${combined}', '${combined}')`,
        )).rejects.toThrow();
    });

    it('keeps the combined group ROOT-LEVEL, never a second parent', async () => {
        const row = await ownerDb.group.findUniqueOrThrow({ where: { id: combined } });

        /*
         * The whole design decision in one assertion. A combining group above
         * the two tracks would be a DAG, and `Group.parent_id` is singular on
         * the wire while `expand_subtree` / `expand_conflict` / `expand_ancestry`
         * all assume a tree in the search's hot path.
         */
        expect(row.parentGroupId).toBeNull();
    });

    it('leaves the sources\u2019 own parents alone', async () => {
        const a = await ownerDb.group.findUniqueOrThrow({ where: { id: trackA } });

        expect(a.parentGroupId).toBe(f.groupCohortA);
    });

    it('drops a source row when its group is deleted, rather than dangling', async () => {
        await setSources([trackA, trackB]);
        await ownerDb.$executeRawUnsafe(`DELETE FROM "group" WHERE id = '${trackB}'`);

        // Visible in the list as one fewer source, instead of the next
        // regenerate quietly producing a smaller group with nothing naming why.
        const remaining = await ownerDb.groupSource.findMany({ where: { groupId: combined } });

        expect(remaining.map((r) => r.sourceGroupId)).toEqual([trackA]);
    });
});

describe('the generic relation route still serves Group', () => {
    /**
     * A REGRESSION GUARD FOR A TRAP WITH NO OTHER SYMPTOM.
     *
     * Nitro matches a concrete directory ahead of a parameterised one, so a
     * single file at `server/api/groups/[id]/anything.ts` shadows
     * `server/api/[resource]/[id]/[relation].ts` for the WHOLE `/api/groups/*`
     * prefix. Every Group relation then answers 404 from the PAGE router — which
     * reads as a missing page, not a broken API, and names nothing.
     *
     * That is exactly what happened while building this: two routes for the
     * source drift and the regenerate, neither touching availability, silently
     * broke group availability. They live under `/api/group-sources/` now.
     */
    it('answers every Group relation, not just the one this feature added', async () => {
        for (const relation of ['sources', 'terms', 'availability']) {
            const res = await api(`/api/groups/${combined}/${relation}`, { cookie });

            expect(res.status, relation).toBe(200);
        }
    });
});
