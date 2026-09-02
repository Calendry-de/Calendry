import type { PermissionKey } from '#shared/permissions';
import { CRUD_RESOURCES, PERMISSION_KEYS } from '#shared/permissions';
import type { MessageKey } from '~~/i18n/keys';

/**
 * Named permission bundles for the API-token minting form
 * (`components/my/ApiTokensPanel.vue`).
 *
 * A MODULE rather than a const inside the SFC, for the reason `navGroups.ts`
 * gives: these are pure functions over the catalogue, so
 * `tests/api-token-presets.test.ts` can import them with no Nuxt instance, and
 * the failure they have to be pinned against is invisible on screen. A preset
 * that matches NOTHING renders as a button that appears to work and selects no
 * boxes, which is CLAUDE.md's "correctly found nothing" and "matched nothing
 * because of a bug" being indistinguishable.
 *
 * EVERY PRESET IS A PREDICATE OVER THE KEY'S OWN STRUCTURE, NEVER A LIST OF
 * KEYS. `CRUD_RESOURCES` already generates `<prefix>.read/create/update/delete`
 * systematically, so "read-only" and "import" are derivable facts about a key,
 * not editorial ones. A hand-maintained array is exactly the prose-drifts-from-
 * code failure CLAUDE.md warns about: adding `foo.read` to the catalogue would
 * leave the read-only preset quietly short of it, and nothing would report that.
 * Only the SHAPE of a key is consulted here; where a preset genuinely needs a
 * non-CRUD family it names the PREFIX (`generation`, `solver`, `ics_link`), and
 * a new key in that family is picked up for free.
 *
 * A PRESET NEVER WIDENS. `resolvePreset()` takes the caller's held set and
 * partitions the catalogue into what it may select and what it cannot, so the
 * "granted" half is a subset of `held` by construction, not by review. That is
 * the delegation rule (CLAUDE.md § "Four principals"): a token is a Person's own
 * authority narrowed, so a checked box the server will refuse would be a lie in
 * the UI.
 */

/** The last dot-segment: the verb. `solver.snapshot.read` → `read`. */
function actionOf(key: string): string {
    const segments = key.split('.');

    return segments[segments.length - 1] ?? key;
}

/** The first dot-segment: the family. `solver.snapshot.read` → `solver`. */
function prefixOf(key: string): string {
    return key.split('.')[0] ?? key;
}

/**
 * DEDUPLICATED, the same way `crudPermissions()` does it: `calendar-periods`
 * and `terms` both map to `term`, and a preset asking "is this a managed
 * entity's key?" must not care how many segments name it.
 */
const CRUD_PREFIXES: ReadonlySet<string> = new Set<string>(Object.values(CRUD_RESOURCES));

/**
 * Read-shaped, by the verb rather than by an exact key: `read`, `read_own`
 * (`session.read_own`) and `read_any` (`availability.read_any`) are all "may
 * look, may not change". `dashboard.view` is deliberately NOT read-shaped: it
 * gates a PAGE, and a bearer token issued to a script has no page to land on.
 * `*.export` is not read-shaped either — see the export preset.
 */
function isReadShaped(key: string): boolean {
    return /^read(_|$)/.test(actionOf(key));
}

/** Verbs a managed entity's row is written with, minus `delete`. */
const ENTRY_ACTIONS: ReadonlySet<string> = new Set(['read', 'create', 'update']);

/**
 * Placement verbs that reposition a Session without removing teaching from the
 * timetable. `bank` (cancel to the spare bank), `create`, `delete`,
 * `substitute` and `assign_lecturer` are excluded on purpose: an unattended
 * script that can cancel teaching is a different authority from one that can
 * rearrange it.
 */
const PLACEMENT_ACTIONS: ReadonlySet<string> = new Set(['read', 'read_own', 'move', 'swap', 'lock']);

/** Families a solver-driving script needs whole: every key they hold, now or later. */
const AUTOMATION_PREFIXES: ReadonlySet<string> = new Set(['generation', 'solver', 'violation']);

export type ApiTokenPresetId = 'readOnly' | 'dataEntry' | 'scheduleAutomation' | 'reporting';

export interface ApiTokenPreset {
    id: ApiTokenPresetId;
    /**
     * Copy as message KEYS, resolved by the component at the point of use
     * (i18n/CONVENTIONS.md: a module-level const holding a resolved string
     * freezes whichever language loaded first).
     */
    labelKey: MessageKey;
    descriptionKey: MessageKey;
    /** Whether this preset wants a catalogue key. Structural: see the file comment. */
    wants: (key: PermissionKey) => boolean;
}

export const API_TOKEN_PRESETS: readonly ApiTokenPreset[] = [
    {
        id: 'readOnly',
        labelKey: 'my.apiTokens.preset.readOnly.label',
        descriptionKey: 'my.apiTokens.preset.readOnly.hint',
        wants: isReadShaped,
    },
    {
        /*
         * Read, plus create and update on the MANAGED ENTITIES only, so an
         * import script can fill the roster and the room list without holding
         * `session.create` (which places teaching anywhere, for anyone) or
         * `offering_plan.apply` (which creates a Group's whole course load in
         * one call). No `delete` in any family: re-running an importer must not
         * be able to empty a tenant.
         *
         * The CRUD prefixes and nothing else, so the reads it gets are the
         * reads of the rows it writes. Folding in every read-shaped key would
         * quietly add `solver.snapshot.read` (the tenant's whole scheduling
         * configuration) to a preset whose name promises data entry.
         */
        id: 'dataEntry',
        labelKey: 'my.apiTokens.preset.dataEntry.label',
        descriptionKey: 'my.apiTokens.preset.dataEntry.hint',
        wants: (key) => CRUD_PREFIXES.has(prefixOf(key)) && ENTRY_ACTIONS.has(actionOf(key)),
    },
    {
        /*
         * PREFIX-matched, not category-matched, and that distinction is load
         * bearing: `exam.request_own` and `exam.review` carry `category:
         * 'session'` in the catalogue, so a category test would hand a
         * scheduling script the authority to record an exam for anybody.
         */
        id: 'scheduleAutomation',
        labelKey: 'my.apiTokens.preset.scheduleAutomation.label',
        descriptionKey: 'my.apiTokens.preset.scheduleAutomation.hint',
        wants: (key) => AUTOMATION_PREFIXES.has(prefixOf(key))
            || (prefixOf(key) === 'session' && PLACEMENT_ACTIONS.has(actionOf(key))),
    },
    {
        /*
         * Reading, plus the two data-out families a reporting job actually
         * calls: `*.export` (`person.export`, `tenant.export`) and
         * `ics_link.*`. Both stand apart from read on purpose in the catalogue
         * — an export reaches past what `person.read` implies — so they are
         * named here rather than folded into `isReadShaped`, and this is the
         * one preset that offers them.
         */
        id: 'reporting',
        labelKey: 'my.apiTokens.preset.reporting.label',
        descriptionKey: 'my.apiTokens.preset.reporting.hint',
        wants: (key) => isReadShaped(key)
            || actionOf(key) === 'export'
            || prefixOf(key) === 'ics_link',
    },
];

export interface PresetResolution {
    /** Wanted AND held: what applying the preset selects. Never wider than `held`. */
    granted: PermissionKey[];
    /**
     * Wanted and NOT held: the shortfall. Non-empty means the preset cannot be
     * satisfied, which the caller must be told rather than left to discover at
     * whatever call site 403s later.
     */
    missing: PermissionKey[];
}

/**
 * What a preset means for one caller.
 *
 * Iterates the CATALOGUE rather than `held`, so `missing` names real keys an
 * administrator can grant, and reads `held` only to decide which side each
 * lands on.
 */
export function resolvePreset(
    preset: ApiTokenPreset,
    held: ReadonlySet<string>,
): PresetResolution {
    const granted: PermissionKey[] = [];
    const missing: PermissionKey[] = [];

    for (const key of PERMISSION_KEYS) {
        if (!preset.wants(key)) {
            continue;
        }

        if (held.has(key)) {
            granted.push(key);
        } else {
            missing.push(key);
        }
    }

    return { granted, missing };
}

/** Every catalogue key a preset wants, regardless of who is asking. */
export function presetKeys(preset: ApiTokenPreset): PermissionKey[] {
    return PERMISSION_KEYS.filter((key) => preset.wants(key));
}
