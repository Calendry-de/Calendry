import type { ConstraintTypeDef } from '#shared/constraintTypes';
import type { ConstraintRowData } from '~/components/manage/ManageConstraintRow.vue';

/** One variant row, paired with the catalogue entry it instantiates. */
export interface ConstraintVariantEntry {
    type: ConstraintTypeDef;
    row: ConstraintRowData;
}

/**
 * One or more variant entries that share a configuration.
 *
 * `entries.length === 1` is the common case — a variant with nothing else
 * like it — and the caller is expected to render that case identically to an
 * ungrouped row. `entries.length > 1` is what issue #103 asks for: several
 * Offerings/Groups narrowed by the exact same rule, worth showing once.
 */
export interface ConstraintVariantGroup {
    /** Stable only within one render pass — never persisted or sent to the server. */
    key: string;
    type: ConstraintTypeDef;
    /** The shared configuration every entry in this group has (first entry, arbitrarily — they agree by construction). */
    row: ConstraintRowData;
    entries: ConstraintVariantEntry[];
}

/**
 * Deterministic stringify: object keys sorted so two params objects built in
 * a different field order still hash the same. Arrays keep their given order
 * — a weekday list's order can matter to a future type even if none reads it
 * today, and sorting it would be a silent behavioural claim this function has
 * no business making.
 */
function stableKey(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableKey).join(',')}]`;
    }

    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));

        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableKey(v)}`).join(',')}}`;
    }

    return JSON.stringify(value ?? null);
}

/**
 * The identity of what a variant DOES, deliberately excluding `id`, `name`
 * and `scopes` — those are what tells two otherwise-identical rules apart
 * (which Offering/Group/kind they were narrowed to), not part of the rule
 * itself. Two rows with the same key are interchangeable but for who they
 * apply to.
 *
 * Weight is folded in only for SOFT types: `ManageConstraintRow` never reads
 * a HARD row's stored weight (severity comes from the catalogue, and a hard
 * row's weight is DB-ignored), so letting it vary the key would split rows
 * that render, and behave, identically.
 */
function configKey(type: ConstraintTypeDef, row: ConstraintRowData): string {
    const severity = type.severity ?? row.severity;

    return stableKey({
        type: type.key,
        severity,
        weight: severity === 'SOFT' ? row.weight ?? 0 : null,
        params: row.params ?? {},
        isEnabled: row.isEnabled,
    });
}

/**
 * Groups variant entries sharing a configuration, in first-seen order.
 *
 * PURE AND IDEMPOTENT — a function of `entries` alone, computed fresh every
 * render, mutates nothing. This is display grouping only: the solver keeps
 * resolving each underlying `Constraint`/`ConstraintScope` row independently,
 * and nothing here is persisted or sent anywhere.
 */
export function groupConstraintVariants(entries: ConstraintVariantEntry[]): ConstraintVariantGroup[] {
    const order: string[] = [];
    const groups = new Map<string, ConstraintVariantEntry[]>();

    for (const entry of entries) {
        const key = configKey(entry.type, entry.row);
        const existing = groups.get(key);

        if (existing) {
            existing.push(entry);
        } else {
            groups.set(key, [entry]);
            order.push(key);
        }
    }

    return order.map((key) => {
        // Non-null: `key` only ever comes from `order`, pushed alongside the
        // `groups.set` that created this exact entry.
        const groupEntries = groups.get(key) as ConstraintVariantEntry[];

        return {
            key,
            type: groupEntries[0]!.type,
            row: groupEntries[0]!.row,
            entries: groupEntries,
        };
    });
}
