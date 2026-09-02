import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput } from '../server/utils/solverInput';

/**
 * Equipment COUNTS crossing the wire, both directions of the same fact.
 *
 * `RoomEquipment.quantity` and `OfferingEquipment.quantity` have existed in the
 * database throughout; until proto v0.10.0 neither had anywhere to go, so a
 * 24-seat lab and a room with one workstation were equally eligible and the
 * requirement was counted as dropped instead. Both fields now ship, which makes
 * three separable claims worth pinning:
 *
 *  - a stated count is SENT, on both the supply and the demand side;
 *  - an UNSTATED count is sent as nothing, never as zero: those mean opposite
 *    things to a `>=` comparison, and zero would make a room fail every
 *    requirement rather than decline to answer;
 *  - a requirement nothing can meet is REPORTED, because enforcement is exactly
 *    what makes it possible for a room that used to qualify on presence to stop
 *    qualifying, and the symptom is an Offering that silently never places.
 */
let f: Fixtures;

const EQUIP_COUNTED = 'test-equip-workstation';
const EQUIP_PRESENCE = 'test-equip-projector';
const EQUIP_UNSUPPLIED = 'test-equip-microscope';

beforeAll(async () => {
    f = await seed();

    await ownerDb.equipment.createMany({
        data: [
            { id: EQUIP_COUNTED, tenantId: f.tenantA, key: 'workstation', name: 'Workstation' },
            { id: EQUIP_PRESENCE, tenantId: f.tenantA, key: 'projector', name: 'Projector' },
            { id: EQUIP_UNSUPPLIED, tenantId: f.tenantA, key: 'microscope', name: 'Microscope' },
        ],
    });

    await ownerDb.roomEquipment.createMany({
        data: [
            // Counted supply.
            { tenantId: f.tenantA, roomId: f.roomPrivateA, equipmentId: EQUIP_COUNTED, quantity: 12 },
            // Present, but nobody ever counted it.
            { tenantId: f.tenantA, roomId: f.roomPrivateA, equipmentId: EQUIP_PRESENCE, quantity: null },
            // A microscope EXISTS in the room, with no count stated, so a
            // requirement for a number of them has nothing to compare against.
            { tenantId: f.tenantA, roomId: f.roomPrivateA, equipmentId: EQUIP_UNSUPPLIED, quantity: null },
        ],
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

const roomA = (input: Awaited<ReturnType<typeof assemble>>['input']) =>
    input.rooms.find((room) => room.id === f.roomPrivateA)!;

const offeringA = (input: Awaited<ReturnType<typeof assemble>>['input']) =>
    input.offerings.find((offering) => offering.id === 'test-offering-a')!;

describe('the supply side: Room.feature_quantities', () => {
    it('sends a stated count and omits an unstated one entirely', async () => {
        const room = roomA((await assemble()).input);

        expect(room.featureQuantities).toEqual([{ feature: 'workstation', quantity: 12 }]);
    });

    it('still lists every feature by presence, counted ones included', async () => {
        // The solver's two checks are additive and independent. Moving a counted
        // feature OUT of `feature_tags` would make this room ineligible for any
        // Offering that asks only for presence of a workstation, a regression
        // invisible to any test that looked at the quantity list alone.
        const room = roomA((await assemble()).input);

        expect([...room.featureTags].sort())
            .toEqual(['microscope', 'projector', 'workstation']);
    });
});

describe('the demand side: Offering.room_feature_requirements', () => {
    it('sends only the requirements that state a count', async () => {
        await ownerDb.offeringEquipment.createMany({
            data: [
                { tenantId: f.tenantA, offeringId: 'test-offering-a', equipmentId: EQUIP_COUNTED, quantity: 8 },
                { tenantId: f.tenantA, offeringId: 'test-offering-a', equipmentId: EQUIP_PRESENCE, quantity: null },
            ],
        });

        const { input } = await assemble();

        // The counted one, and only it: an absent `min_quantity` asks exactly the
        // question `required_room_features` already asks, so sending the
        // uncounted requirement here too would be the same fact twice.
        expect(offeringA(input).roomFeatureRequirements)
            .toEqual([{ feature: 'workstation', minQuantity: 8 }]);

        // ...and BOTH still travel as presence requirements, so dropping to the
        // quantity list never loosens what was already asked.
        expect([...offeringA(input).requiredRoomFeatures].sort())
            .toEqual(['projector', 'workstation']);
    });
});

describe('the report: requirements nothing can satisfy', () => {
    it('says nothing while some room can meet the count', async () => {
        // 8 wanted, 12 supplied. Asserted so the report cannot pass the next
        // test by simply naming everything.
        expect((await assemble()).report.unsatisfiableEquipmentQuantities).toEqual([]);
    });

    it('names a requirement above every stated supply', async () => {
        await ownerDb.offeringEquipment.update({
            where: { offeringId_equipmentId: { offeringId: 'test-offering-a', equipmentId: EQUIP_COUNTED } },
            data: { quantity: 40 },
        });

        expect((await assemble()).report.unsatisfiableEquipmentQuantities).toEqual([{
            id: 'test-offering-a',
            title: expect.any(String),
            feature: 'workstation',
            required: 40,
            bestAvailable: 12,
        }]);
    });

    it('reports a null supply distinctly from a supply that is merely too small', async () => {
        /*
         * THE LIKELIER FAILURE IN PRACTICE, and the reason `bestAvailable` is
         * nullable rather than defaulted to 0. The room HAS a microscope; it is
         * in `feature_tags`, so this reads as eligible under the old
         * presence-only rule and fails under the new one, with nothing about the
         * count written down anywhere. A 0 here would describe a room that
         * counted its microscopes and found none.
         */
        await ownerDb.offeringEquipment.create({
            data: { tenantId: f.tenantA, offeringId: 'test-offering-a', equipmentId: EQUIP_UNSUPPLIED, quantity: 2 },
        });

        const reported = (await assemble()).report.unsatisfiableEquipmentQuantities
            .find((row) => row.feature === 'microscope');

        expect(reported).toBeDefined();
        expect(reported!.bestAvailable).toBeNull();
        expect(reported!.required).toBe(2);
    });
});
