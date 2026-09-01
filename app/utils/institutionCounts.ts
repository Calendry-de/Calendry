import type { ManageEntity } from '~/utils/manageRegistry';
import { MANAGE_ENTITIES, entityPermission } from '~/utils/manageRegistry';

/**
 * Which entities `/dashboard` states a count for, and who may see each one.
 *
 * A PURE MODULE, separate from the composable that fetches with it, for the
 * same reason `navPlaces` is: the selection below is permission logic, and
 * permission logic that lives inside a `useAsyncData` callback cannot be
 * reached by a test. `tests/institution-counts.test.ts` imports this.
 *
 * The six are the entities that describe an institution's SHAPE rather than
 * its activity: who is in it, how they are grouped, where they are taught,
 * what must be scheduled, when, and with what. Adding a seventh is a design
 * decision about the strip's width, not a free action.
 */
export const COUNTED_KEYS = ['persons', 'groups', 'rooms', 'offerings', 'terms', 'equipment'] as const;

export interface EntityCount {
    key: string;
    /** The registry's own plural, so this and the nav never disagree on a name. */
    label: string;
    to: string;
    /**
     * `null` means THE REQUEST FAILED, and the view must not draw it as 0.
     * "No data" and "fetch failed" rendering identically is the failure mode
     * CLAUDE.md calls invisible, and a zero here is a real, meaningful answer.
     */
    total: number | null;
}

/**
 * The counted entities this caller may actually read.
 *
 * Gated on `<resource>.read`, which is the SAME key the destination's own nav
 * entry requires — so a tile appears exactly when its `/manage` link does, and
 * the strip widens the page's permission surface by nothing. Resolved through
 * `entityPermission()` rather than composed here, so an entity carrying a
 * `permissionOverrides` entry cannot be gated on a key that does not exist.
 *
 * A key that matches no registry entry is DROPPED rather than throwing: a
 * missing tile is recoverable, a crashing home page is not. The test is what
 * stops that from happening quietly.
 */
export function countedEntities(held: ReadonlySet<string>): ManageEntity[] {
    return COUNTED_KEYS
        .map((key) => MANAGE_ENTITIES.find((entity) => entity.key === key))
        .filter((entity): entity is ManageEntity => entity !== undefined)
        .filter((entity) => held.has(entityPermission(entity, 'read')));
}
