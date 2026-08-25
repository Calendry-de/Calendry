import { describe, expect, it } from 'vitest';
import { CRUD_RESOURCES, PERMISSIONS, PERMISSION_KEYS } from '../server/utils/permissions';

/**
 * The permission catalogue must hold each key exactly once.
 *
 * WHY THIS EXISTS. `CRUD_RESOURCES` maps two resource segments onto one prefix
 * on purpose — `calendar-periods` and `terms` both mean `term`, because editing
 * a term's exam period IS editing the term. `crudPermissions()` iterated the
 * ENTRIES, so it emitted `term.read/create/update/delete` twice and the array
 * held 57 items for 53 keys.
 *
 * The damage was not cosmetic and not local:
 *
 *   provision:tenant   inserts this array into `access_role_permission` with a
 *                      single `createMany` and no `skipDuplicates`. Postgres
 *                      rejects duplicate primary keys inside one INSERT, so
 *                      provisioning a NEW tenant failed outright — and nobody
 *                      noticed, because the existing tenant was repaired by
 *                      `grant:permissions --all-missing`, which computes what
 *                      is missing and skips duplicates.
 *   the seed           upserts, so it reported "updated" for a row it had just
 *                      created and its counts silently disagreed with reality.
 *   any UI over it     draws one permission twice, under a duplicate key.
 *
 * A duplicate is invisible in every one of those places until something rejects
 * it, which is the failure shape this project keeps writing rules about. So it
 * is pinned here rather than trusted to review: adding a resource that shares an
 * existing prefix is a legitimate thing to do, and must stay legitimate.
 */
describe('permission catalogue', () => {
    it('has no duplicate keys', () => {
        const seen = new Map<string, number>();

        for (const key of PERMISSION_KEYS) {
            seen.set(key, (seen.get(key) ?? 0) + 1);
        }

        const duplicated = [...seen].filter(([, count]) => count > 1).map(([key]) => key);

        // Named rather than counted: a bare length assertion says "something is
        // wrong" where this says which key, which is the whole difference
        // between a failing test and a diagnosable one.
        expect(duplicated).toEqual([]);
        expect(PERMISSION_KEYS.length).toBe(new Set(PERMISSION_KEYS).size);
    });

    it('describes each key once', () => {
        // `PERMISSIONS` is what the seed and provisioning iterate; `PERMISSION_KEYS`
        // is derived from it. Asserting both means a future dedupe applied to the
        // derived list only — which would leave provisioning broken — still fails.
        expect(PERMISSIONS.length).toBe(PERMISSION_KEYS.length);
    });

    it('covers every CRUD prefix with all four actions', () => {
        const held = new Set(PERMISSION_KEYS);

        for (const prefix of new Set(Object.values(CRUD_RESOURCES))) {
            for (const action of ['read', 'create', 'update', 'delete']) {
                expect(held.has(`${prefix}.${action}`)).toBe(true);
            }
        }
    });

    it('carries the two administration permissions Step 14 gates on', () => {
        // These existed in the catalogue for a long time with no endpoint
        // checking either. If one is ever removed, the routes that now depend on
        // them fail closed rather than open — but they fail at request time, in
        // a tenant, which is a worse place to find out than here.
        expect(PERMISSION_KEYS).toContain('access_role.manage');
        expect(PERMISSION_KEYS).toContain('person_access_role.assign');
    });
});
