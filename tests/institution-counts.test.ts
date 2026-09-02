import { describe, expect, it } from 'vitest';
import { COUNTED_KEYS, countedEntities } from '../app/utils/institutionCounts';
import { MANAGE_ENTITIES, entityPermission } from '../app/utils/manageRegistry';
import { PERMISSIONS } from '#shared/permissions';

/**
 * `/dashboard`'s count strip must ask for exactly what the caller may read.
 *
 * WHY THIS FILE EXISTS
 *
 * The strip fires one request per counted entity. Get the gate wrong in either
 * direction and the failure is quiet:
 *
 *   too weak    a tile is offered for a resource the caller cannot read, the
 *               request 403s, and the tile reads "Unavailable" forever, which
 *               looks like a broken server rather than a missing permission
 *   too strong  the tile is hidden from somebody whose `/manage` link is right
 *               there in the sidebar, so the page understates the institution
 *
 * The invariant that rules both out: a tile's gate IS its destination's gate.
 * `countedEntities` derives it through `entityPermission()` for that reason,
 * and this file is what stops the derivation from drifting.
 */
describe('institution count strip gating', () => {
    const counted = COUNTED_KEYS.map((key) => MANAGE_ENTITIES.find((entity) => entity.key === key));

    it('names only entities that exist in the registry', () => {
        // Guards the guard, and guards the silent drop: `countedEntities`
        // filters an unresolved key out rather than throwing, so a typo would
        // remove a tile with no error anywhere. Nothing else would report it.
        for (const [index, entity] of counted.entries()) {
            expect(entity, `COUNTED_KEYS[${index}] (${COUNTED_KEYS[index]}) matches no MANAGE_ENTITIES entry`)
                .toBeDefined();
        }

        expect(counted.length).toBeGreaterThan(3);
    });

    it('demands a permission that exists in the catalogue', () => {
        const catalogued = new Set(PERMISSIONS.map((permission) => permission.key));

        for (const entity of counted) {
            const key = entityPermission(entity!, 'read');

            // An uncatalogued key can never be held, so the tile would be
            // invisible to everyone including a full administrator.
            expect(catalogued.has(key), `${entity!.key} counts behind uncatalogued permission "${key}"`)
                .toBe(true);
        }
    });

    it('offers a tile only to a caller holding that resource read key', () => {
        for (const entity of counted) {
            const key = entityPermission(entity!, 'read');

            // Holding only this one key offers exactly this one tile.
            const solo = countedEntities(new Set([key]));

            expect(solo.map((selected) => selected.key), `holding only ${key} should offer only ${entity!.key}`)
                .toEqual([entity!.key]);
        }
    });

    it('offers nothing to a caller holding nothing', () => {
        // The page is gated on `dashboard.view` alone, so this caller is real:
        // somebody who may land here and read no managed entity at all. The
        // strip must be absent, not six "Unavailable" tiles from six 403s.
        expect(countedEntities(new Set())).toEqual([]);
    });

    it('offers every tile to a caller holding every read key', () => {
        const all = new Set(counted.map((entity) => entityPermission(entity!, 'read')));

        expect(countedEntities(all).map((entity) => entity.key)).toEqual([...COUNTED_KEYS]);
    });
});
