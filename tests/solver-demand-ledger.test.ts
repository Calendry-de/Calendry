import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SolverOutput } from '@calendry-de/calendry-proto';
import { type Fixtures, ownerDb, seed, teardown } from './helpers/seed';
import { assembleSolverInput } from '../server/utils/solverInput';
import { demandLedgerFrom, reconcileDemand } from '../server/utils/solverDemand';
import { isReproducible } from '../server/utils/generationRead';
import { terminationSentence } from '../app/composables/generationReview';

/**
 * THE DEMAND LEDGER — what the app asked the solver for, recorded so the apply
 * can tell a refusal from a gap.
 *
 * `planMaterialization` deletes an in-scope Session the output does not
 * mention, reading the silence as "the solver refused to place this". On
 * 2026-09-01 a `converged` run against a live tenant was given 208 in-scope
 * wire Offerings, each asking for one Session and each already carrying one,
 * and returned 197 placements. Eleven live Sessions were deleted on that
 * silence; the next run recreated them and dropped a different eleven.
 *
 * The ledger is the evidence that makes the two cases distinguishable, and it
 * has to say what CROSSED THE WIRE — including the banked subtraction and the
 * per-group split — or the apply reconciles against a request the solver never
 * received. That is what the assembly half below pins.
 */
let f: Fixtures;

beforeAll(async () => {
    f = await seed();
});

afterAll(async () => {
    await teardown();
    await ownerDb.$disconnect();
});

const assemble = () => ownerDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL calendry.tenant_id = '${f.tenantA}'`);

    return assembleSolverInput(tx as never, { tenantId: f.tenantA, termId: f.termA, now: new Date('2026-10-05') });
});

describe('the ledger records what was sent', () => {
    it('carries one entry per wire Offering, agreeing with the input itself', async () => {
        const { input, report } = await assemble();

        expect(report.demand).toHaveLength(input.offerings.length);

        /*
         * Compared against `input.offerings`, not against the Offering rows:
         * the ledger's whole job is to describe the REQUEST, so a fixture that
         * happened to agree with the database while disagreeing with the wire
         * would pass a weaker test than this one.
         */
        for (const offering of input.offerings) {
            const entry = report.demand.find((row) => row.wireOfferingId === offering.id);

            expect(entry, `no ledger entry for wire offering ${offering.id}`).toBeDefined();
            expect(entry!.requiredSessionCount).toBe(offering.requiredSessionCount);
        }
    });

    it('counts the existing Sessions actually put on the wire, per series', async () => {
        const { input, report } = await assemble();

        const sentPerOffering = new Map<string, number>();

        for (const session of input.existingSessions) {
            if (!session.offeringId) {
                continue;
            }

            sentPerOffering.set(session.offeringId, (sentPerOffering.get(session.offeringId) ?? 0) + 1);
        }

        for (const entry of report.demand) {
            expect(entry.existingSessionsSent).toBe(sentPerOffering.get(entry.wireOfferingId) ?? 0);
        }
    });

    it('resolves every wire id back to a real Offering id the apply can match', async () => {
        const { report, scopeOfferingIds } = await assemble();

        // `session.offering_id` carries the real id, so an entry whose
        // `offeringId` is a synthetic `offering::group` id would reconcile
        // against nothing and silently authorise every delete.
        for (const entry of report.demand) {
            expect(entry.offeringId).not.toContain('::');
            expect(scopeOfferingIds.real).toContain(entry.offeringId);
        }
    });

    it('drops the banked count out of the recorded demand, exactly as the wire does', async () => {
        await ownerDb.session.update({
            where: { id: f.sessionA },
            data: { termWeek: null, dayOfWeek: null, blockIndex: null },
        });

        try {
            const { report } = await assemble();
            const entry = report.demand.find((row) => row.offeringId === 'test-offering-a');

            // frequency 2, one banked — the same correction `requiredSessionCount`
            // makes, since a ledger that recorded the raw frequency would report
            // a shortfall on every run that banks anything.
            expect(entry?.requiredSessionCount).toBe(1);
            expect(entry?.existingSessionsSent).toBe(0);
        } finally {
            await ownerDb.session.update({
                where: { id: f.sessionA },
                data: { termWeek: 1, dayOfWeek: 2, blockIndex: 0 },
            });
        }
    });
});

describe('reconcileDemand', () => {
    const ledger = [
        { wireOfferingId: 'a', offeringId: 'a', requiredSessionCount: 2, existingSessionsSent: 2 },
        { wireOfferingId: 'b', offeringId: 'b', requiredSessionCount: 1, existingSessionsSent: 1 },
    ];

    const outputWith = (offeringIds: string[]) => SolverOutput.fromJSON({
        sessions: offeringIds.map((offeringId, index) => ({
            sessionId: `s${index}`,
            offeringId,
            startSlot: { week: 0, day: 1, block: 0 },
            durationBlocks: 1,
            roomId: '',
            lecturerIds: [],
            groupIds: [],
            personIds: [],
        })),
        hardViolations: [],
    });

    it('finds nothing short when the answer covers the request', () => {
        const result = reconcileDemand(ledger, outputWith(['a', 'a', 'b']));

        expect(result).toMatchObject({ known: true, totalRequired: 3, totalReturned: 3 });
        expect(result.short.size).toBe(0);
    });

    it('names the Offering that came back short, with both numbers', () => {
        const result = reconcileDemand(ledger, outputWith(['a', 'b']));

        expect(result.short.get('a')).toEqual({ required: 2, returned: 1 });
        expect(result.short.has('b')).toBe(false);
    });

    it('credits a split series to its real Offering', () => {
        const split = [
            { wireOfferingId: 'a::g1', offeringId: 'a', requiredSessionCount: 1, existingSessionsSent: 1 },
            { wireOfferingId: 'a::g2', offeringId: 'a', requiredSessionCount: 1, existingSessionsSent: 1 },
        ];

        // Both series answered, under the ids the wire actually used. Summed to
        // the real Offering this is 2 of 2 — a reconciliation that compared wire
        // ids to `session.offering_id` would see 0 of 2 and withhold everything.
        expect(reconcileDemand(split, outputWith(['a::g1', 'a::g2'])).short.size).toBe(0);
        expect(reconcileDemand(split, outputWith(['a::g1'])).short.get('a'))
            .toEqual({ required: 2, returned: 1 });
    });

    it('ignores a placement for an Offering the ledger never asked about', () => {
        // It cannot pay off demand nothing recorded requesting, and crediting it
        // would let a stray placement mask a genuine shortfall elsewhere.
        const result = reconcileDemand(ledger, outputWith(['a', 'a', 'b', 'c']));

        expect(result.totalReturned).toBe(3);
        expect(result.short.size).toBe(0);
    });

    it('reports an absent ledger as unknown rather than as complete', () => {
        const result = reconcileDemand(null, outputWith([]));

        expect(result.known).toBe(false);
        expect(result.short.size).toBe(0);
    });
});

describe('demandLedgerFrom', () => {
    const entry = { wireOfferingId: 'a', offeringId: 'a', requiredSessionCount: 1, existingSessionsSent: 0 };

    it('reads the ledger out of a stored run meta', () => {
        expect(demandLedgerFrom({ report: { demand: [entry] } })).toEqual([entry]);
    });

    it('returns null for a run that predates the ledger', () => {
        expect(demandLedgerFrom({})).toBeNull();
        expect(demandLedgerFrom({ report: {} })).toBeNull();
        expect(demandLedgerFrom(null)).toBeNull();
    });

    it('refuses a malformed ledger whole rather than parsing part of it', () => {
        // A half-parsed ledger under-reports demand, which is the one direction
        // that silently authorises the deletes this exists to withhold.
        expect(demandLedgerFrom({ report: { demand: [entry, { wireOfferingId: 'b' }] } })).toBeNull();
        expect(demandLedgerFrom({ report: { demand: 'all of them' } })).toBeNull();
    });
});

/**
 * `stagnated` — the solver's new "could not place everything and stopped
 * searching". Both readers of a termination reason used to answer as though it
 * were good news, for the same reason: each treated its known list as the
 * exception and everything else as the safe default.
 */
describe('an unrecognised termination reason', () => {
    it('is not called reproducible', () => {
        expect(isReproducible('converged')).toBe(true);
        expect(isReproducible('move_budget')).toBe(true);
        expect(isReproducible('time_budget')).toBe(false);
        expect(isReproducible(null)).toBeNull();

        // Was `true` — anything that was not `time_budget` passed as reproducible.
        expect(isReproducible('stagnated')).toBeNull();
        expect(isReproducible('some_future_reason')).toBeNull();
    });

    it('is not described as a run from before termination capture', () => {
        const predates = terminationSentence(null);

        expect(predates).toContain('predates');

        // Was word-for-word `predates`, so a run that gave up read as archaeology.
        expect(terminationSentence('stagnated')).not.toBe(predates);
        expect(terminationSentence('stagnated')).toContain('placing everything');

        expect(terminationSentence('some_future_reason')).not.toBe(predates);
        expect(terminationSentence('some_future_reason')).toContain('some_future_reason');
    });
});
