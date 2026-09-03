import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, TEST_PASSWORD, type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { api, login } from './helpers/client';
import { assembleSolverInput } from '../server/utils/solverInput';
import { wireOfferingId } from '../server/utils/offeringSplit';
import { RELATIONS } from '../server/utils/relations';
import { manageEntities } from '../app/utils/manageRegistry';
import { englishT } from './helpers/manageMessages';

/**
 * The per-Group LECTURER PIN (issue #131): `offering_group.lecturer_person_id`.
 *
 * "For THIS Offering, THIS Group's Sessions are always led by THIS person."
 * A pinned series reaches the wire as `candidateLecturerIds: [pin]`,
 * `requiredLecturerCount: 1` — the wire's own FIXED shape — while its sibling
 * series keep the Offering-wide pool. That is the whole mechanism: no proto
 * or solver change, and it is what lets a per-person rule (`LecturerVeto`)
 * precompute for a series that used to be refused as a genuine pool.
 *
 * Three boundaries are pinned here because each fails silently on its own:
 * what reaches the wire (`assembleSolverInput`), the relation route over
 * HTTP (its body is a BARE ARRAY, its response is now `{ rows, warnings }`),
 * and the registry entry the picker renders from.
 */
let f: Fixtures;
let adminCookie = '';

const OFFERING = 'test-offering-a';

beforeAll(async () => {
    f = await seed();
    adminCookie = (await login(ACCOUNTS.adminA, TEST_PASSWORD)).cookie;
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

afterEach(async () => {
    await ownerDb.offeringGroup.deleteMany({ where: { offeringId: OFFERING } });
    await ownerDb.offeringLecturer.deleteMany({ where: { offeringId: OFFERING } });
    await ownerDb.offering.update({ where: { id: OFFERING }, data: { requiredLecturerCount: null } });
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA, now: new Date() });
});

const attachLecturers = (personIds: string[]) => ownerDb.offeringLecturer.createMany({
    data: personIds.map((personId) => ({ offeringId: OFFERING, personId, tenantId: f.tenantA })),
});

const attachGroups = (rows: { groupId: string; lecturerPersonId?: string | null }[]) => ownerDb.offeringGroup.createMany({
    data: rows.map((row) => ({ offeringId: OFFERING, tenantId: f.tenantA, ...row })),
});

const sent = async (wireId: string) => {
    const { input, report } = await assemble();
    const offering = input.offerings.find((o) => o.id === wireId);

    expect(offering, `wire offering ${wireId}`).toBeDefined();

    return { offering: offering!, report };
};

describe('what reaches the wire', () => {
    it('a pinned series sends the one person as its only candidate, requiring one: the FIXED shape', async () => {
        await attachLecturers([f.personA, f.personViewerA]);
        await attachGroups([
            { groupId: f.groupCohortA, lecturerPersonId: f.personA },
            { groupId: f.groupSeminarA },
        ]);

        const pinned = await sent(wireOfferingId(OFFERING, f.groupCohortA));

        expect(pinned.offering.candidateLecturerIds).toEqual([f.personA]);
        expect(pinned.offering.requiredLecturerCount).toBe(1);
        expect(pinned.report.offeringsWithLecturerPinOutsidePool).toEqual([]);
    });

    it('the sibling series without a pin keeps the whole pool, still a genuine pool', async () => {
        await attachLecturers([f.personA, f.personViewerA]);
        await attachGroups([
            { groupId: f.groupCohortA, lecturerPersonId: f.personA },
            { groupId: f.groupSeminarA },
        ]);

        const { offering } = await sent(wireOfferingId(OFFERING, f.groupSeminarA));

        expect(offering.candidateLecturerIds.sort()).toEqual([f.personA, f.personViewerA].sort());
        expect(offering.requiredLecturerCount).toBe(1);
    });

    it('an unsplit Offering with ONE Group honours that Group’s pin: the series IS the Group', async () => {
        await attachLecturers([f.personA, f.personViewerA]);
        await attachGroups([{ groupId: f.groupCohortA, lecturerPersonId: f.personViewerA }]);

        // One Group does not split, so the wire id is the Offering's own.
        const { offering } = await sent(OFFERING);

        expect(offering.candidateLecturerIds).toEqual([f.personViewerA]);
        expect(offering.requiredLecturerCount).toBe(1);
    });

    it('a null pin is exactly what every series sent before the column existed', async () => {
        await attachLecturers([f.personA, f.personViewerA]);
        await attachGroups([{ groupId: f.groupCohortA, lecturerPersonId: null }]);

        const { offering } = await sent(OFFERING);

        expect(offering.candidateLecturerIds).toHaveLength(2);
        expect(offering.requiredLecturerCount).toBe(1);
    });
});

describe('a pin outside the pool', () => {
    it('is REPORTED by series and IGNORED: the series falls back to the pool, nobody is appointed', async () => {
        // personViewerA is pinned but not in "Who leads it".
        await attachLecturers([f.personA]);
        await attachGroups([
            { groupId: f.groupCohortA, lecturerPersonId: f.personViewerA },
            { groupId: f.groupSeminarA },
        ]);

        const wireId = wireOfferingId(OFFERING, f.groupCohortA);
        const { offering, report } = await sent(wireId);

        expect(offering.candidateLecturerIds).toEqual([f.personA]);
        expect(report.offeringsWithLecturerPinOutsidePool).toEqual([{
            id: wireId,
            title: expect.any(String),
            groupId: f.groupCohortA,
            personId: f.personViewerA,
        }]);
    });

    it('with an EMPTY pool the fallback is empty too, and the unstaffed report still fires', async () => {
        await attachGroups([{ groupId: f.groupCohortA, lecturerPersonId: f.personA }]);

        const { offering, report } = await sent(OFFERING);

        expect(offering.candidateLecturerIds).toEqual([]);
        expect(offering.requiredLecturerCount).toBe(0);
        expect(report.offeringsWithLecturerPinOutsidePool).toHaveLength(1);
        // The pin never widened the pool, so "nobody staffed this" stays true.
        expect(report.offeringsWithNoLecturerAssigned.map((o) => o.id)).toContain(OFFERING);
    });
});

describe('an explicit co-teaching count against a pinned series', () => {
    it('is clamped to the one pinned person and reported as insufficient FOR THAT SERIES only', async () => {
        await attachLecturers([f.personA, f.personViewerA]);
        await ownerDb.offering.update({ where: { id: OFFERING }, data: { requiredLecturerCount: 2 } });
        await attachGroups([
            { groupId: f.groupCohortA, lecturerPersonId: f.personA },
            { groupId: f.groupSeminarA },
        ]);

        const pinnedId = wireOfferingId(OFFERING, f.groupCohortA);
        const { offering, report } = await sent(pinnedId);
        const sibling = (await assemble()).input.offerings.find((o) => o.id === wireOfferingId(OFFERING, f.groupSeminarA))!;

        expect(offering.requiredLecturerCount).toBe(1);
        expect(sibling.requiredLecturerCount).toBe(2);
        expect(report.offeringsWithInsufficientLecturers).toEqual([{
            id: pinnedId,
            title: expect.any(String),
            required: 2,
            available: 1,
        }]);
    });
});

describe('the relation over HTTP', () => {
    const putGroups = (body: unknown) => api<{ rows: unknown[]; warnings: string[] }>(
        `/api/offerings/${OFFERING}/groups`,
        { method: 'PUT', cookie: adminCookie, body: JSON.stringify(body) },
    );

    const putLecturers = (body: unknown) => api<{ rows: unknown[]; warnings: string[] }>(
        `/api/offerings/${OFFERING}/lecturers`,
        { method: 'PUT', cookie: adminCookie, body: JSON.stringify(body) },
    );

    it('stores the pin, returns it on GET, and answers { rows, warnings } with no warning for a pool member', async () => {
        await attachLecturers([f.personA]);

        const res = await putGroups([{ groupId: f.groupCohortA, lecturerPersonId: f.personA }]);

        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.rows).toEqual([{ groupId: f.groupCohortA, lecturerPersonId: f.personA }]);
        expect(res.body.warnings).toEqual([]);

        const got = await api<unknown[]>(`/api/offerings/${OFFERING}/groups`, { cookie: adminCookie });

        expect(got.body).toEqual([{ groupId: f.groupCohortA, lecturerPersonId: f.personA }]);
    });

    it('a row without the field stores null: the pin is optional, and the old body shape still works', async () => {
        const res = await putGroups([{ groupId: f.groupCohortA }]);

        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.rows).toEqual([{ groupId: f.groupCohortA, lecturerPersonId: null }]);
    });

    it('WARNS, not refuses, about a pin naming somebody outside the pool', async () => {
        await attachLecturers([f.personA]);

        const res = await putGroups([{ groupId: f.groupCohortA, lecturerPersonId: f.personViewerA }]);

        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.warnings).toHaveLength(1);
        expect(res.body.warnings[0]).toContain('Cohort A');
        expect(res.body.warnings[0]).toContain('not in "Who leads it"');
        // Kept as stored: the assembly, not the write, decides what to do with it.
        expect(res.body.rows).toEqual([{ groupId: f.groupCohortA, lecturerPersonId: f.personViewerA }]);
    });

    it('saving the ROSTER so that a pinned person leaves it warns from that side too', async () => {
        await attachLecturers([f.personA, f.personViewerA]);
        await attachGroups([{ groupId: f.groupCohortA, lecturerPersonId: f.personViewerA }]);

        const kept = await putLecturers([{ personId: f.personA }, { personId: f.personViewerA }]);

        expect(kept.status).toBe(200);
        expect(kept.body.warnings).toEqual([]);

        const dropped = await putLecturers([{ personId: f.personA }]);

        expect(dropped.status).toBe(200);
        expect(dropped.body.warnings).toHaveLength(1);
        expect(dropped.body.warnings[0]).toContain('Cohort A');
        // The pin survives the roster save: it is not a foreign key onto the pool.
        expect(await ownerDb.offeringGroup.findUnique({
            where: { offeringId_groupId: { offeringId: OFFERING, groupId: f.groupCohortA } },
            select: { lecturerPersonId: true },
        })).toEqual({ lecturerPersonId: f.personViewerA });
    });

    it('needs offering.update, not merely offering.read', async () => {
        const viewer = (await login(ACCOUNTS.viewerA, TEST_PASSWORD)).cookie;
        const res = await api<unknown>(`/api/offerings/${OFFERING}/groups`, {
            method: 'PUT', cookie: viewer, body: JSON.stringify([{ groupId: f.groupCohortA }]),
        });

        expect(res.status).toBe(403);
    });
});

describe('the registry entry the picker renders from', () => {
    const groups = manageEntities(englishT)
        .find((entity) => entity.key === 'offerings')!
        .relations!.find((relation) => relation.key === 'groups')!;

    it('offers the pin per Group row, drawn from the lecturers relation, never from every Person', () => {
        expect(groups.extraReference).toMatchObject({
            key: 'lecturerPersonId',
            resource: 'persons',
            fromRelation: 'lecturers',
        });
    });

    it('names a sibling relation that exists on the same entity, or the option list is silently empty', () => {
        const siblings = manageEntities(englishT)
            .find((entity) => entity.key === 'offerings')!
            .relations!.map((relation) => relation.key);

        expect(siblings).toContain(groups.extraReference!.fromRelation);
    });

    it('matches the server item shape: the column the picker writes is the one the route accepts', () => {
        expect(() => RELATIONS['offerings/groups']!.item.parse({
            groupId: 'g',
            [groups.extraReference!.key]: 'p',
        })).not.toThrow();
        expect(() => RELATIONS['offerings/groups']!.item.parse({ groupId: 'g' })).not.toThrow();
    });

    it('says in the help text what a pin does, since nothing else in the form can', () => {
        expect(groups.help).toContain('fixed lecturer');
    });
});
