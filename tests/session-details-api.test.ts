import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';

/**
 * `POST /api/sessions/:id/details`: editing what an EVENT is.
 *
 * A NAMED VERB, NOT A PATCH. CLAUDE.md's routing convention: editing operations
 * are explicit verbs on the Session resource "so the event log can record
 * intent, not just a diff". `move` owns where a Session sits; this owns what it
 * is, and the log distinguishes them.
 *
 * EVENTS ONLY, for the reason DELETE is: an Offering-linked Session's kind
 * comes from its Offering and its groups and people from solver output, so a
 * manual edit here would be silently overwritten by the next apply: an edit
 * that appears to work and then undoes itself.
 */
const TENANT = 'test-tenant-a';
const TERM = 'test-term-a';
const KIND = 'test-kind-a';

let cookie: string | null;
let otherKindId: string;
let groupId: string;
let personId: string;

async function makeEvent(over: Record<string, unknown> = {}) {
    const res = await api('/api/sessions', {
        method: 'POST',
        cookie,
        body: JSON.stringify({
            termId: TERM, kindId: KIND, termWeek: 1, dayOfWeek: 1, blockIndex: 0,
            title: 'Before', ...over,
        }),
    });

    expect(res.status).toBe(201);

    return res.body.session as { id: string };
}

const edit = (id: string, patch: Record<string, unknown>, as: string | null = cookie) =>
    api(`/api/sessions/${id}/details`, { method: 'POST', cookie: as, body: JSON.stringify(patch) });

beforeAll(async () => {
    await seed();
    ({ cookie } = await login(ACCOUNTS.adminA, TEST_PASSWORD));

    const other = await ownerDb.sessionKind.create({
        data: { tenantId: TENANT, key: 'workshop', name: 'Workshop' },
    });

    otherKindId = other.id;
    groupId = (await ownerDb.group.findFirstOrThrow({ where: { tenantId: TENANT }, select: { id: true } })).id;
    personId = (await ownerDb.person.findFirstOrThrow({ where: { tenantId: TENANT }, select: { id: true } })).id;
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

describe('editing an Event', () => {
    it('changes title, kind, groups and people', async () => {
        const ev = await makeEvent();

        const res = await edit(ev.id, {
            title: 'After', kindId: otherKindId, groupIds: [groupId], personIds: [personId],
        });

        expect(res.status).toBe(200);
        expect(res.body.session.title).toBe('After');
        expect(res.body.session.kindId).toBe(otherKindId);

        const row = await ownerDb.session.findUniqueOrThrow({
            where: { id: ev.id },
            include: { groups: true, people: true },
        });

        expect(row.groups.map((g) => g.groupId)).toEqual([groupId]);
        expect(row.people.map((p) => p.personId)).toEqual([personId]);
    });

    it('replaces a set wholesale rather than merging it', async () => {
        const ev = await makeEvent({ groupIds: [groupId] });

        await edit(ev.id, { groupIds: [] });

        expect(await ownerDb.sessionGroup.count({ where: { sessionId: ev.id } })).toBe(0);
    });

    it('leaves untouched fields alone', async () => {
        const ev = await makeEvent({ groupIds: [groupId] });

        await edit(ev.id, { title: 'Only the title' });

        const row = await ownerDb.session.findUniqueOrThrow({
            where: { id: ev.id }, include: { groups: true },
        });

        expect(row.title).toBe('Only the title');
        // A patch that does not mention groups must not clear them.
        expect(row.groups).toHaveLength(1);
    });

    it('refuses a blanked title, the rule create already enforces', async () => {
        const ev = await makeEvent();

        const res = await edit(ev.id, { title: '   ' });

        expect(res.status).toBe(400);
        expect(String(res.body.statusMessage)).toContain('needs a name');
    });

    it("refuses another tenant's kind", async () => {
        const ev = await makeEvent();

        expect((await edit(ev.id, { kindId: 'test-kind-b' })).status).toBe(404);
    });
});

describe('the Events-only boundary', () => {
    it('refuses an Offering-linked Session on every field, with 409', async () => {
        const linked = await makeEvent({ offeringId: 'test-offering-a', title: undefined });

        for (const patch of [{ title: 'x' }, { kindId: otherKindId }, { groupIds: [] }, { personIds: [] }]) {
            const res = await edit(linked.id, patch);

            expect(res.status, Object.keys(patch)[0]).toBe(409);
            expect(String(res.body.statusMessage)).toContain('belongs to an Offering');
        }
    });

    it('404s an unknown id, distinguishably from the 409 above', async () => {
        expect((await edit('nope', { title: 'x' })).status).toBe(404);
    });
});

describe('the event log', () => {
    it('records UPDATE_DETAILS with before and after for changed fields only', async () => {
        const ev = await makeEvent();

        await edit(ev.id, { title: 'Logged', groupIds: [groupId] });

        const logged = await ownerDb.sessionEvent.findFirstOrThrow({
            where: { sessionId: ev.id, type: 'UPDATE_DETAILS' },
            orderBy: { seq: 'desc' },
        });

        const payload = logged.payload as Record<string, unknown>;

        expect(payload.changed).toEqual(expect.arrayContaining(['title', 'groupIds']));
        // kindId did not change, so it must not appear: the log records what
        // happened, not every field the request could have touched.
        expect(payload.changed).not.toContain('kindId');
        expect((payload.before as Record<string, unknown>).title).toBe('Before');
        expect((payload.after as Record<string, unknown>).title).toBe('Logged');
    });
});

describe('permission', () => {
    it('refuses a viewer, who has no session.update', async () => {
        const ev = await makeEvent();
        const { cookie: viewer } = await login(ACCOUNTS.viewerA, TEST_PASSWORD);

        expect((await edit(ev.id, { title: 'hax' }, viewer)).status).toBe(403);

        const row = await ownerDb.session.findUniqueOrThrow({ where: { id: ev.id } });

        expect(row.title).toBe('Before');
    });
});
