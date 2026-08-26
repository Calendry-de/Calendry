import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
    CONSTRAINT_TYPES, STRUCTURAL_CONSTRAINT_TYPES,
    defaultConstraintRow, defaultConstraintTypes,
} from '../shared/constraintTypes';

/**
 * The default-row model (TAXONOMY.md §2): every tenant holds exactly one row
 * per live catalogue type.
 *
 * The property that matters is not "the rows exist" but WHY they must:
 * `refreshViolations()` evaluates only the types a tenant has a row for, so a
 * missing row is a silently disabled rule. `no_double_booking_person` was
 * exactly that for the whole of Stage 7 — added to the catalogue, never added
 * to provisioning, and invisible because its own unit test seeds its row.
 */
const url = process.env.TEST_MIGRATION_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL ?? '';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const T = 'cdef-test';
const ids = { tenant: `${T}-tenant` };

async function reset() {
    await db.$executeRawUnsafe(`DELETE FROM tenant WHERE id = '${ids.tenant}'`);
}

beforeAll(async () => {
    if (!url) {
        throw new Error('No owner database URL; run through tests/run-integration.sh');
    }

    await reset();
    await db.tenant.create({ data: { id: ids.tenant, slug: T, name: 'Defaults Test', timezone: 'UTC' } });
});

afterAll(async () => {
    await reset();
    await db.$disconnect();
});

describe('the catalogue half', () => {
    it('excludes deprecated types from the default set', () => {
        const live = defaultConstraintTypes().map((t) => t.key);
        const deprecated = CONSTRAINT_TYPES.filter((t) => t.deprecatedBy).map((t) => t.key);

        expect(deprecated.length).toBeGreaterThan(0);

        for (const key of deprecated) {
            expect(live).not.toContain(key);
        }
    });

    it('gives every SOFT type a default weight, and every HARD type none', () => {
        for (const type of defaultConstraintTypes()) {
            const row = defaultConstraintRow(type);

            if (row.severity === 'SOFT') {
                // The DB CHECK requires it even while disabled, so "no weight"
                // is not a representable state for a SOFT row.
                expect(row.weight, `${type.key} weight`).toBeTypeOf('number');
                expect(row.weight).toBeGreaterThanOrEqual(0);
            } else {
                expect(row.weight, `${type.key} weight`).toBeNull();
            }
        }
    });

    it('enables exactly the structural rules and nothing else', () => {
        const enabled = defaultConstraintTypes()
            .map(defaultConstraintRow)
            .filter((row) => row.isEnabled)
            .map((row) => row.type)
            .sort();

        expect(enabled).toEqual([...STRUCTURAL_CONSTRAINT_TYPES].sort());
    });

    it('does NOT auto-enable person_preference_fit', () => {
        /*
         * Two reasons it must ship off. It steers the SOLVER, and enabling a
         * previously-off rule for every tenant on upgrade changes the timetable
         * they get from their next run — not a change a backfill is entitled to
         * make. And its proto field has not shipped, so an enabled row would be
         * skipped at assembly time anyway.
         */
        const type = CONSTRAINT_TYPES.find((candidate) => candidate.key === 'person_preference_fit')!;
        const row = defaultConstraintRow(type);

        expect(row.isEnabled).toBe(false);
        // SOFT, so the CHECK demands a weight even while disabled.
        expect(row.severity).toBe('SOFT');
        expect(row.weight).toBeGreaterThan(0);
    });

    it('includes no_double_booking_person — the rule that was unreachable', () => {
        expect(defaultConstraintTypes().map((t) => t.key)).toContain('no_double_booking_person');
    });

    it('refuses to build a row for a SOFT type with no defaultWeight', () => {
        expect(() => defaultConstraintRow({
            key: 'invented', wireField: 'roomDoubleBooking', label: 'x', description: 'x',
            evaluator: 'solver', severity: 'SOFT', params: [],
        } as never)).toThrow(/defaultWeight/);
    });
});

describe('the database half', () => {
    it('permits one default row per type', async () => {
        const rows = defaultConstraintTypes().map(defaultConstraintRow);

        await db.constraint.createMany({
            data: rows.map((row) => ({ ...row, tenantId: ids.tenant })),
        });

        const count = await db.constraint.count({ where: { tenantId: ids.tenant, isDefault: true } });

        expect(count).toBe(rows.length);
    });

    it('REFUSES a second default row of the same type', async () => {
        const first = await db.constraint.findFirstOrThrow({
            where: { tenantId: ids.tenant, isDefault: true },
        });

        await expect(db.constraint.create({
            data: {
                tenantId: ids.tenant, type: first.type, name: 'duplicate',
                severity: first.severity, weight: first.weight, isDefault: true,
            },
        })).rejects.toThrow();
    });

    it('PERMITS a scoped variant of the same type', async () => {
        const first = await db.constraint.findFirstOrThrow({
            where: { tenantId: ids.tenant, isDefault: true },
        });

        const variant = await db.constraint.create({
            data: {
                tenantId: ids.tenant, type: first.type, name: 'scoped variant',
                severity: first.severity, weight: first.weight, isDefault: false,
            },
        });

        expect(variant.isDefault).toBe(false);

        await db.constraint.delete({ where: { id: variant.id } });
    });

    it('defaults isDefault to FALSE for a row created without it', async () => {
        // The API strips unknown keys, so a constraint created through
        // POST /api/constraints can never claim to be a default. This pins the
        // column default that guarantees it.
        const created = await db.constraint.create({
            data: {
                tenantId: ids.tenant, type: 'no_double_booking_room',
                name: 'api-shaped', severity: 'HARD',
            },
        });

        expect(created.isDefault).toBe(false);

        await db.constraint.delete({ where: { id: created.id } });
    });
});
