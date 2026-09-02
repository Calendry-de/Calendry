import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput } from '../server/utils/solverInput';
import { preferencesAreEmpty } from '../shared/availability';

/**
 * The third axis of a preference: which ROOM TYPES a person would rather teach
 * in, alongside days and blocks.
 *
 * Three properties carry the risk, and none of them is visible from reading the
 * happy path:
 *
 *  - A person stating ONLY a room preference must still reach the wire. The
 *    narrowing step drops a preference row whose axes are all empty, and
 *    "all empty" used to mean days and blocks alone, so this lecturer's
 *    preference would vanish with no error, since an absent `Person.preferred`
 *    is a legitimate state meaning "no opinion". The solver guards the mirror
 *    image of this on its own side, which is what makes the app's half easy to
 *    forget.
 *  - The wire speaks KEYS; the database stores equipment IDS. A test asserting
 *    "some strings arrived" would pass against a build sending ids, and the
 *    solver would match them against `Room.feature_tags` and find nothing:
 *    inert, not wrong, and therefore invisible.
 *
 * The write path's own guard, refusing an unknown equipment id by name rather
 * than filtering it out, is pinned where it is reachable, over HTTP, in
 * `person-availability-api.test.ts`.
 */
let f: Fixtures;

const LECTURER_ROLE = 'test-role-lecturer-rooms';
const OFFERING_LAB = 'test-offering-rooms-lab';
const EQUIP_LAB = 'test-equip-rooms-lab';
const EQUIP_THEATRE = 'test-equip-rooms-theatre';

beforeAll(async () => {
    f = await seed();

    await ownerDb.role.create({
        data: { id: LECTURER_ROLE, tenantId: f.tenantA, key: 'lecturer', name: 'Lecturer' },
    });
    await ownerDb.personRole.create({
        data: { tenantId: f.tenantA, personId: f.personA, roleId: LECTURER_ROLE },
    });

    await ownerDb.equipment.createMany({
        data: [
            { id: EQUIP_LAB, tenantId: f.tenantA, key: 'lab-bench', name: 'Lab bench' },
            { id: EQUIP_THEATRE, tenantId: f.tenantA, key: 'raked-seating', name: 'Raked seating' },
        ],
    });

    await ownerDb.offering.create({
        data: {
            id: OFFERING_LAB, tenantId: f.tenantA,
            termId: f.termA, kindId: 'test-kind-a',
            title: 'Practical', frequency: 2,
        },
    });
    await ownerDb.offeringLecturer.create({
        data: { tenantId: f.tenantA, offeringId: OFFERING_LAB, personId: f.personA },
    });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA });
});

/** Writes a preference row directly, so the wire path is tested without the API. */
async function statePreference(personId: string, options: {
    days?: number[];
    blocks?: number[];
    equipmentIds?: string[];
}) {
    await ownerDb.personPreference.upsert({
        where: { personId },
        create: {
            personId,
            tenantId: f.tenantA,
            preferredDays: options.days ?? [],
            preferredBlocks: options.blocks ?? [],
        },
        update: { preferredDays: options.days ?? [], preferredBlocks: options.blocks ?? [] },
    });

    await ownerDb.personPreferenceRoomFeature.deleteMany({ where: { personId } });

    if (options.equipmentIds?.length) {
        await ownerDb.personPreferenceRoomFeature.createMany({
            data: options.equipmentIds.map((equipmentId) => ({
                personId, equipmentId, tenantId: f.tenantA,
            })),
        });
    }
}

describe('reaching the wire', () => {
    it('sends equipment KEYS, not the ids it stores', async () => {
        await statePreference(f.personA, { days: [2], equipmentIds: [EQUIP_LAB] });

        const person = (await assemble()).input.persons.find((row) => row.id === f.personA);

        // `Room.feature_tags` carries keys. Sending ids would be accepted by the
        // solver, matched against nothing, and cost exactly as much as having
        // stated no preference at all.
        expect(person!.preferred?.preferredRoomFeatures).toEqual(['lab-bench']);
    });

    it('sends them sorted, so one unchanged tenant hashes the same twice', async () => {
        // `hashInput` is taken over the encoded bytes and nothing else orders
        // these rows; an unstable order makes the idempotency key stop
        // identifying the problem and every retry launch a fresh run.
        await statePreference(f.personA, { equipmentIds: [EQUIP_THEATRE, EQUIP_LAB] });

        const first = await assemble();
        const person = first.input.persons.find((row) => row.id === f.personA);

        expect(person!.preferred?.preferredRoomFeatures).toEqual(['lab-bench', 'raked-seating']);
        expect((await assemble()).inputHash).toBe(first.inputHash);
    });
});

describe('the room-only lecturer', () => {
    it('is sent, though every time axis is empty', async () => {
        /*
         * THE REGRESSION THIS FILE EXISTS FOR. With the narrowing condition
         * testing days and blocks alone, this person's whole `Preference`
         * message is dropped silently, because an absent one is a real state.
         */
        await statePreference(f.personA, { days: [], blocks: [], equipmentIds: [EQUIP_LAB] });

        const person = (await assemble()).input.persons.find((row) => row.id === f.personA);

        expect(person!.preferred, 'a room-only preference must still travel').toBeDefined();
        expect(person!.preferred!.days).toEqual([]);
        expect(person!.preferred!.blocks).toEqual([]);
        expect(person!.preferred!.preferredRoomFeatures).toEqual(['lab-bench']);
    });

    it('still sends nothing for a person who has stated nothing at all', async () => {
        // The counter-example, so the assertion above cannot be satisfied by a
        // build that simply always sends a Preference.
        const person = (await assemble()).input.persons.find((row) => row.id === f.personMultiA);

        expect(person, 'the person is still sent').toBeDefined();
        expect(person!.preferred).toBeUndefined();
    });
});

describe('preferencesAreEmpty', () => {
    it('treats a room-only preference as NOT empty', () => {
        // The write paths delete the row when this returns true, so a false here
        // is what stops a room-only preference being deleted on its next save.
        expect(preferencesAreEmpty({
            preferredDays: [], preferredBlocks: [], preferredRoomFeatureIds: [EQUIP_LAB],
        })).toBe(false);

        expect(preferencesAreEmpty({
            preferredDays: [], preferredBlocks: [], preferredRoomFeatureIds: [],
        })).toBe(true);
    });
});
