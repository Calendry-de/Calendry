import { describe, expect, it } from 'vitest';
import { MANAGE_ENTITIES, entityPermission, relationOptionResources, relationReadRequirement } from '../app/utils/manageRegistry';
import { resourcePermissions, satisfiesPermissionRequirement } from '#shared/permissions';

/**
 * Every relation picker must be gated on every endpoint its option wave calls.
 *
 * WHY THIS FILE EXISTS
 *
 * A relation's options are fetched in ONE `Promise.all`. A single 403 inside it
 * takes down the whole wave, and because `useEntityRelations` awaits the
 * useAsyncData HANDLE, which resolves rather than rejects, the page does not
 * blank. Every picker on it renders an EMPTY option list instead. A person
 * editor's Person page said "No roles defined yet" over a tenant that has them:
 * a page-wide lie, indistinguishable from an unconfigured tenant.
 *
 * Six relations across four entities were in that state, and none of them was
 * new. The fix is to DERIVE each relation's gate from the resources its wave
 * touches, so the answer cannot drift; this file is what stops the derivation
 * from being quietly wrong.
 *
 * TWO FAILURE MODES, BOTH CHECKED, because they are opposites:
 *
 *   too weak    a gate that admits somebody the wave will refuse: the bug
 *   too silent  a gate nothing can satisfy, so the picker vanishes for
 *               everyone and looks exactly like a relation nobody configured
 */
describe('relation option waves are covered by their own gate', () => {
    const relations = MANAGE_ENTITIES.flatMap((entity) => (entity.relations ?? []).map((def) => ({
        entity,
        def,
        id: `${entity.key}/${def.key}`,
    })));

    it('has relations to check at all', () => {
        // Guards the guard: every assertion below is a loop, and a loop over an
        // empty list passes. That is the exact shape of failure this suite is
        // about.
        expect(relations.length).toBeGreaterThan(5);
    });

    it('names a resolvable resource for every fetch', () => {
        for (const { id, def } of relations) {
            for (const resource of relationOptionResources(def)) {
                expect(resourcePermissions(resource, 'read'), `${id} fetches unknown /api/${resource}`)
                    .toBeDefined();
            }
        }
    });

    it('produces a gate that SOMEBODY can satisfy', () => {
        for (const { id, def } of relations) {
            const requirement = relationReadRequirement(def);

            // An empty clause is unsatisfiable by design (it means "one of
            // nothing"), so a relation carrying one is hidden from every user
            // forever, which reads as "this tenant has none" rather than as a
            // bug. Fail-closed is right; failing closed INVISIBLY is not.
            for (const clause of requirement) {
                const alternatives = typeof clause === 'string' ? [clause] : clause;

                expect(alternatives.length, `${id} has a gate nobody can satisfy`).toBeGreaterThan(0);
            }

            // The full-catalogue holder must see everything. If they cannot,
            // the derivation invented a permission.
            const everything = new Set(
                MANAGE_ENTITIES.flatMap((entity) => (['read', 'create', 'update', 'delete'] as const)
                    .map((action) => entityPermission(entity, action)))
                    .concat(['access_role.manage', 'person_access_role.assign']),
            );

            expect(satisfiesPermissionRequirement(everything, requirement), `${id} refuses an admin`).toBe(true);
        }
    });

    it('refuses a caller who can read the parent but not the options', () => {
        /*
         * The concrete bug, stated as a rule: holding only the PAGE's own read
         * permission must not be enough to be offered a picker whose options
         * come from somewhere else.
         *
         * Every relation whose wave leaves the parent's own resource is checked,
         * which is all six that were wrong plus the one that was already right.
         */
        let checked = 0;

        for (const { id, entity, def } of relations) {
            const pageGate = entityPermission(entity, 'read');
            const foreign = relationOptionResources(def).some(
                (resource) => !(resourcePermissions(resource, 'read') ?? []).includes(pageGate as never),
            );

            if (!foreign) {
                continue;
            }

            checked++;

            expect(satisfiesPermissionRequirement(new Set([pageGate]), relationReadRequirement(def)),
                `${id} is offered to someone holding only ${pageGate}`).toBe(false);
        }

        // Named rather than assumed: if a registry change drops this to zero the
        // assertion above stops testing anything, silently.
        expect(checked, 'no relation fetches outside its own resource: has the registry changed?')
            .toBeGreaterThan(0);
    });
});
