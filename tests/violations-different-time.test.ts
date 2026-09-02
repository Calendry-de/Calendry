import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { refreshViolations } from '../server/utils/violations';

/**
 * `different_time`: the first RELATION-BASED violation check (issue #53,
 * ADR-0028 in calendry-solver).
 *
 * A THIRD PASS, not a `describeCollision` case, for the same reason
 * `no_session_spanning_break` got its own pass rather than a switch branch:
 * this constraint's data (explicit `ConstraintRelationMember` membership) is
 * not in `describeCollision`'s shared-entity context (`byRoom`/`byPerson`/
 * `byGroup`/`conflictSets`/`attendeeSets`) and cannot be added to it without
 * changing what every other branch receives.
 *
 * TWO NAMED OFFERINGS SHARING NOTHING: the whole point of the feature. Both
 * Sessions below share no Room, no Lecturer, no Group; only the relation says
 * they must never overlap.
 */
let f: Fixtures;
let offeringB: string;

beforeAll(async () => {
    f = await seed();

    offeringB = (await ownerDb.offering.create({
        data: {
            tenantId: f.tenantA, termId: 'test-term-a', kindId: 'test-kind-a',
            title: 'Networks', frequency: 1,
        },
    })).id;

    await ownerDb.constraint.create({
        data: {
            id: 'test-different-time', tenantId: f.tenantA, type: 'different_time',
            name: 'Databases vs Networks', severity: 'HARD', weight: null, isEnabled: true,
        },
    });
    await ownerDb.constraintRelationMember.createMany({
        data: [
            { tenantId: f.tenantA, constraintId: 'test-different-time', offeringId: 'test-offering-a', position: 0 },
            { tenantId: f.tenantA, constraintId: 'test-different-time', offeringId: offeringB, position: 1 },
        ],
    });
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const asOwner = <T>(fn: (tx: typeof ownerDb) => Promise<T>) => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return fn(tx as never);
});

describe('two related offerings scheduled at overlapping times', () => {
    it('is reported against the seed session, naming the other', async () => {
        const seedSession = await ownerDb.session.create({
            data: {
                tenantId: f.tenantA, offeringId: 'test-offering-a', termId: 'test-term-a',
                kindId: 'test-kind-a', timeGridId: 'test-grid-a',
                termWeek: 3, dayOfWeek: 1, blockIndex: 0, durationBlocks: 1,
                generationId: 'test-generation-a',
            },
        });
        const other = await ownerDb.session.create({
            data: {
                tenantId: f.tenantA, offeringId: offeringB, termId: 'test-term-a',
                kindId: 'test-kind-a', timeGridId: 'test-grid-a',
                // Same week/day/block as the seed: overlapping, no shared
                // Room/Lecturer/Group at all.
                termWeek: 3, dayOfWeek: 1, blockIndex: 0, durationBlocks: 1,
                generationId: 'test-generation-a',
            },
        });

        await asOwner((tx) => refreshViolations(tx, { tenantId: f.tenantA, sessionIds: [seedSession.id] }));

        const violations = await ownerDb.constraintViolation.findMany({
            where: { tenantId: f.tenantA, sessionId: seedSession.id },
        });

        expect(violations).toHaveLength(1);
        expect(violations[0]?.severity).toBe('HARD');
        expect(violations[0]?.penalty).toBeNull();

        const detail = violations[0]?.detail as { reason: string; collidesWithSessionId: string; collidesWithOfferingId: string };

        expect(detail.reason).toBe('different_time_violated');
        expect(detail.collidesWithSessionId).toBe(other.id);
        expect(detail.collidesWithOfferingId).toBe(offeringB);
    });
});

describe('two related offerings NOT overlapping', () => {
    it('is not reported', async () => {
        const seedSession = await ownerDb.session.create({
            data: {
                tenantId: f.tenantA, offeringId: 'test-offering-a', termId: 'test-term-a',
                kindId: 'test-kind-a', timeGridId: 'test-grid-a',
                termWeek: 4, dayOfWeek: 1, blockIndex: 0, durationBlocks: 1,
                generationId: 'test-generation-a',
            },
        });

        await ownerDb.session.create({
            data: {
                tenantId: f.tenantA, offeringId: offeringB, termId: 'test-term-a',
                kindId: 'test-kind-a', timeGridId: 'test-grid-a',
                // Same day, later block, does not overlap.
                termWeek: 4, dayOfWeek: 1, blockIndex: 3, durationBlocks: 1,
                generationId: 'test-generation-a',
            },
        });

        await asOwner((tx) => refreshViolations(tx, { tenantId: f.tenantA, sessionIds: [seedSession.id] }));

        expect(await ownerDb.constraintViolation.count({
            where: { tenantId: f.tenantA, sessionId: seedSession.id },
        })).toBe(0);
    });
});

describe('an unrelated offering overlapping the same slot', () => {
    it('is not reported, since only relation members are checked against each other', async () => {
        const unrelated = await ownerDb.offering.create({
            data: {
                tenantId: f.tenantA, termId: 'test-term-a', kindId: 'test-kind-a',
                title: 'Unrelated', frequency: 1,
            },
        });

        const seedSession = await ownerDb.session.create({
            data: {
                tenantId: f.tenantA, offeringId: 'test-offering-a', termId: 'test-term-a',
                kindId: 'test-kind-a', timeGridId: 'test-grid-a',
                termWeek: 5, dayOfWeek: 1, blockIndex: 0, durationBlocks: 1,
                generationId: 'test-generation-a',
            },
        });

        await ownerDb.session.create({
            data: {
                tenantId: f.tenantA, offeringId: unrelated.id, termId: 'test-term-a',
                kindId: 'test-kind-a', timeGridId: 'test-grid-a',
                termWeek: 5, dayOfWeek: 1, blockIndex: 0, durationBlocks: 1,
                generationId: 'test-generation-a',
            },
        });

        await asOwner((tx) => refreshViolations(tx, { tenantId: f.tenantA, sessionIds: [seedSession.id] }));

        expect(await ownerDb.constraintViolation.count({
            where: { tenantId: f.tenantA, sessionId: seedSession.id },
        })).toBe(0);

        await ownerDb.offering.delete({ where: { id: unrelated.id } });
    });
});

describe('disabling the rule', () => {
    it('clears any previously-recorded violation', async () => {
        const seedSession = await ownerDb.session.create({
            data: {
                tenantId: f.tenantA, offeringId: 'test-offering-a', termId: 'test-term-a',
                kindId: 'test-kind-a', timeGridId: 'test-grid-a',
                termWeek: 6, dayOfWeek: 1, blockIndex: 0, durationBlocks: 1,
                generationId: 'test-generation-a',
            },
        });

        await ownerDb.session.create({
            data: {
                tenantId: f.tenantA, offeringId: offeringB, termId: 'test-term-a',
                kindId: 'test-kind-a', timeGridId: 'test-grid-a',
                termWeek: 6, dayOfWeek: 1, blockIndex: 0, durationBlocks: 1,
                generationId: 'test-generation-a',
            },
        });

        await asOwner((tx) => refreshViolations(tx, { tenantId: f.tenantA, sessionIds: [seedSession.id] }));
        expect(await ownerDb.constraintViolation.count({ where: { sessionId: seedSession.id } })).toBe(1);

        await ownerDb.constraint.update({ where: { id: 'test-different-time' }, data: { isEnabled: false } });

        await asOwner((tx) => refreshViolations(tx, { tenantId: f.tenantA, sessionIds: [seedSession.id] }));
        expect(await ownerDb.constraintViolation.count({ where: { sessionId: seedSession.id } })).toBe(0);

        await ownerDb.constraint.update({ where: { id: 'test-different-time' }, data: { isEnabled: true } });
    });
});
