import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { refreshViolations } from '../server/utils/violations';

/**
 * A BANKED Session collides with nothing, because it is not anywhere.
 *
 * `refreshViolations` reads a banked Session for real, despite every editing
 * route refusing one: `apply.post.ts` rebases every unlocked, Offering-linked
 * Session in the term onto the new Generation (`updateMany`, no placement
 * filter) and then refreshes all of them, and that `where` clause is exactly
 * the set banking produces. The evaluator's row type declared the placement
 * columns non-null and asserted the query results into it with `as`, so those
 * rows arrived typed as placed at week `null`, day `null`, block `null`: the
 * candidate query became `term_week IS NULL` and pulled in every other banked
 * Session in the term, and `blocksOverlap` coerced the nulls to 0 so all of
 * them mutually overlapped. Every apply reported HARD double-bookings between
 * Sessions sitting in the spare bank.
 *
 * The two halves are a pair, and both matter:
 *   - banked, the placement rules must stay SILENT (the regression)
 *   - the same fixture, placed at one slot, must FIRE (proving the first
 *     assertion is about the bank and not about a fixture that never collided)
 *
 * `no_unplaced_session` runs alongside both as the control: it is the one rule
 * that is about a banked Session, so it must fire in the first half and clear
 * in the second, or "silent" would be indistinguishable from "skipped".
 */
const url = process.env.TEST_MIGRATION_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL ?? '';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const T = 'banked-seed';
const ids = {
    tenant: `${T}-tenant`, grid: `${T}-grid`, term: `${T}-term`, kind: `${T}-kind`,
    offering: `${T}-offering`, generation: `${T}-generation`, room: `${T}-room`,
    person: `${T}-person`,
    cPerson: `${T}-constraint-person`, cRoom: `${T}-constraint-room`,
    cUnplaced: `${T}-constraint-unplaced`,
    a: `${T}-session-a`, b: `${T}-session-b`,
};

async function reset() {
    await db.$executeRawUnsafe('ALTER TABLE generation DISABLE TRIGGER generation_no_delete');
    await db.$executeRawUnsafe('ALTER TABLE generation DISABLE TRIGGER generation_content_immutable');
    await db.$executeRawUnsafe(`DELETE FROM tenant WHERE id = '${ids.tenant}'`);
    await db.$executeRawUnsafe('ALTER TABLE generation ENABLE TRIGGER generation_no_delete');
    await db.$executeRawUnsafe('ALTER TABLE generation ENABLE TRIGGER generation_content_immutable');
}

/**
 * Two Sessions of one Offering, sharing a Room and a Person, so BOTH placement
 * rules have something to find the moment the two sit in the same slot.
 */
async function seed() {
    await reset();

    await db.tenant.create({ data: { id: ids.tenant, slug: T, name: 'Banked Seed', timezone: 'UTC' } });
    await db.timeGrid.create({
        data: {
            id: ids.grid, tenantId: ids.tenant, name: 'Grid',
            blockLengthMinutes: 45, blocksPerDay: 8, activeDays: [1, 2, 3, 4, 5],
        },
    });
    await db.term.create({
        data: {
            id: ids.term, tenantId: ids.tenant, name: 'Term',
            startDate: new Date('2026-10-05'), endDate: new Date('2027-02-12'), timeGridId: ids.grid,
        },
    });
    await db.sessionKind.create({ data: { id: ids.kind, tenantId: ids.tenant, key: 'lecture', name: 'Lecture' } });
    await db.offering.create({
        data: {
            id: ids.offering, tenantId: ids.tenant, termId: ids.term,
            kindId: ids.kind, title: 'Anything', frequency: 2,
        },
    });
    await db.generation.create({
        data: {
            id: ids.generation, tenantId: ids.tenant, version: 1,
            source: 'MANUAL_BASELINE', status: 'APPLIED', isCurrent: true,
        },
    });
    await db.room.create({ data: { id: ids.room, tenantId: ids.tenant, code: 'HALL', name: 'Hall', capacity: 30 } });
    await db.person.create({
        data: { id: ids.person, tenantId: ids.tenant, givenName: 'Shared', familyName: 'Lecturer' },
    });

    for (const id of [ids.a, ids.b]) {
        // BANKED: all three placement columns null together, the only shape
        // `session_placement_sane` permits for an unplaced Session.
        await db.session.create({
            data: {
                id, tenantId: ids.tenant, offeringId: ids.offering, termId: ids.term,
                kindId: ids.kind, timeGridId: ids.grid, generationId: ids.generation,
                termWeek: null, dayOfWeek: null, blockIndex: null, durationBlocks: 1,
            },
        });
        await db.sessionRoom.create({ data: { tenantId: ids.tenant, sessionId: id, roomId: ids.room } });
        await db.sessionPerson.create({
            data: { tenantId: ids.tenant, sessionId: id, personId: ids.person, roleId: null },
        });
    }

    for (const [id, type, name] of [
        [ids.cPerson, 'no_double_booking_person', 'No double-booked attendees'],
        [ids.cRoom, 'no_double_booking_room', 'No double-booked rooms'],
        [ids.cUnplaced, 'no_unplaced_session', 'Every session must be placed'],
    ] as const) {
        await db.constraint.create({
            data: { id, tenantId: ids.tenant, name, type, severity: 'HARD', isEnabled: true },
        });
    }
}

async function countsByConstraint() {
    await db.$transaction((tx) => refreshViolations(tx as never, {
        tenantId: ids.tenant, sessionIds: [ids.a, ids.b],
    }));

    return {
        person: await db.constraintViolation.count({ where: { constraintId: ids.cPerson } }),
        room: await db.constraintViolation.count({ where: { constraintId: ids.cRoom } }),
        unplaced: await db.constraintViolation.count({ where: { constraintId: ids.cUnplaced } }),
    };
}

beforeAll(() => {
    if (!url) {
        throw new Error('No owner database URL; run through tests/run-integration.sh');
    }
});

afterAll(async () => {
    await reset();
    await db.$disconnect();
});

describe('two Sessions in the spare bank', () => {
    it('collide with nothing, and are reported only as unplaced', async () => {
        await seed();

        const counts = await countsByConstraint();

        // The regression: nulls read as slot 0 made these two "overlap".
        expect(counts.person).toBe(0);
        expect(counts.room).toBe(0);

        // The control. Both are genuinely in the bank and the evaluator saw
        // them, so the two zeros above are silence, not a skipped pass.
        expect(counts.unplaced).toBe(2);
    });

    it('do collide once both are placed in the same slot', async () => {
        await seed();
        await db.session.updateMany({
            where: { id: { in: [ids.a, ids.b] } },
            data: { termWeek: 1, dayOfWeek: 2, blockIndex: 3 },
        });

        const counts = await countsByConstraint();

        // Same room, same person, same slot: without this the assertions above
        // would pass for a fixture that could never have collided anyway.
        expect(counts.person).toBeGreaterThan(0);
        expect(counts.room).toBeGreaterThan(0);
        expect(counts.unplaced).toBe(0);
    });
});
