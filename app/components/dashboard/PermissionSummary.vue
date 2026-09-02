<template>
    <details
        v-if="permissions.length"
        class="permsummary"
    >
        <!--
            ONE PLURAL MESSAGE, verb and noun together, never `permission` plus
            a mustached `s` (i18n/CONVENTIONS.md § "Pluralisation"): German has
            no `-s` plural, so a suffix flip is not a translation and a word
            split across mustaches has no key at all.
        -->
        <summary>{{ t('dashboard.permissions.summary', permissions.length) }}</summary>

        <div class="permsummary_body">
            <section
                v-for="group in groups"
                :key="group.key"
                class="permsummary_group"
            >
                <header class="permsummary_head">
                    <h3>{{ group.label }}</h3>
                    <span class="permsummary_count">{{ group.permissions.length }}</span>
                </header>

                <ul class="permsummary_list">
                    <li
                        v-for="permission in group.permissions"
                        :key="permission.key"
                        class="permsummary_item"
                    >
                        <span class="permsummary_item_desc">{{ permission.description }}</span>
                        <code class="permsummary_item_key">{{ permission.key }}</code>
                    </li>
                </ul>
            </section>

            <!--
                A held key with no catalogue entry should not normally happen,
                but silently dropping it from this view is worse than showing
                it oddly, per CLAUDE.md's "guards must fail loudly or match
                exactly": this is the one place that fact would otherwise
                disappear rather than surface. `permsummary_group--other`
                exists to say "look at this" (see the style block), not to
                blend in with the rest.
            -->
            <section
                v-if="otherKeys.length"
                class="permsummary_group permsummary_group--other"
            >
                <header class="permsummary_head">
                    <h3>{{ t('dashboard.permissions.otherHeading') }}</h3>
                    <span class="permsummary_count">{{ otherKeys.length }}</span>
                </header>

                <!--
                    `<i18n-t>` rather than three keys around the `<code>`:
                    German reorders clauses, so a sentence split at the module
                    name is one no translator can fix without editing this
                    template. The slot name matches the placeholder.
                -->
                <i18n-t
                    class="permsummary_other_note"
                    keypath="dashboard.permissions.otherNote"
                    tag="p"
                    scope="global"
                >
                    <template #module>
                        <code>shared/permissions.ts</code>
                    </template>
                </i18n-t>

                <ul class="permsummary_list">
                    <li
                        v-for="key in otherKeys"
                        :key="key"
                        class="permsummary_item"
                    >
                        <code class="permsummary_item_key">{{ key }}</code>
                    </li>
                </ul>
            </section>
        </div>
    </details>
</template>

<script setup lang="ts">
import type { PermissionDef } from '#shared/permissions';
import { permissionCategories } from '#shared/permissions';
import { useT } from '~/composables/i18n';

/**
 * Replaces the raw `<details><ul>` block that used to sit directly in
 * `dashboard.vue` (issue #104): a flat two-column list of bare permission
 * key strings, with no grouping and no explanation of what a key actually
 * grants.
 *
 * Grouped by `category` from the fixed catalogue (`shared/permissions.ts`),
 * the same axis `ApiTokensPanel`'s grant picker already groups by. It is
 * the one taxonomy this app never invents a second version of. Ordered in
 * CATALOGUE order (via `permissionCategories()`), not sorted, matching that
 * component's own reasoning: a sort would put `access_role` first, which is
 * the least commonly granted group.
 *
 * Stays a `<details>` at the top level: this is still supplementary account
 * metadata on a page whose real content is the manage-entities grid above
 * it, not a promotion to primary content just because it is now organized.
 * What changed is what is inside it once opened.
 *
 * `categoryLabel` and each row's `description` are NOT translated here: both
 * come from the permission catalogue's own vocabulary (`shared/permissions.ts`),
 * which issue #19 handles in Phase 3, in one place, for every surface that
 * reads it.
 */
const props = defineProps<{
    /** Held permission keys: a flat array, exactly `session.permissions`. */
    permissions: readonly string[];
}>();

const { t } = useT();

interface PermissionGroup {
    key: string;
    label: string;
    permissions: PermissionDef[];
}

/** `access_role` → `Access role`. Mirrors `ApiTokensPanel`'s `categoryLabel`. */
function categoryLabel(key: string): string {
    const words = key.replace(/_/g, ' ');

    return words.charAt(0).toUpperCase() + words.slice(1);
}

const groups = computed<PermissionGroup[]>(() => {
    const held = new Set(props.permissions);

    return permissionCategories()
        .map((category) => ({
            key: category.key,
            label: categoryLabel(category.key),
            permissions: category.permissions.filter((permission) => held.has(permission.key)),
        }))
        .filter((group) => group.permissions.length > 0);
});

/** Held keys that resolve to no catalogue entry at all; see the template comment. */
const otherKeys = computed<string[]>(() => {
    const catalogued = new Set<string>(groups.value.flatMap((group) => group.permissions.map((permission) => permission.key)));

    return props.permissions.filter((key) => !catalogued.has(key));
});
</script>

<style scoped lang="scss">
.permsummary {
    max-width: 640px;

    summary {
        cursor: pointer;
        font-size: var(--font-size-md);
        color: $content4;
    }

    &_body {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
        margin-top: var(--space-4);
    }

    /*
     * Native <details> snaps its content open with no transition of its own,
     * same trap as the block this replaced: fading and lifting the OPEN
     * transition alone makes the state change legible.
     */
    &[open] &_body {
        animation: permsummary-reveal 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    &_group {
        padding-top: var(--space-3);
        border-top: 1px solid $surface3;

        &--other {
            border-top-color: $error300;
        }
    }

    &_head {
        display: flex;
        gap: var(--space-3);
        align-items: baseline;
        margin-bottom: var(--space-2);

        h3 {
            margin: 0;
            font-size: var(--font-size-sm);
            font-weight: 680;
            color: $content3;
        }
    }

    &_count {
        font-size: var(--font-size-xs);
        font-variant-numeric: tabular-nums;
        color: $content7;
    }

    &_list {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        margin: 0;
        padding: 0;

        list-style: none;
    }

    &_item {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-4);
        align-items: baseline;

        &_desc {
            font-size: var(--font-size-sm);
            color: $content5;
        }

        &_key {
            font-size: var(--font-size-xs);
            color: $content7;
        }
    }

    &_other_note {
        max-width: 68ch;
        margin: 0 0 var(--space-3);
        font-size: var(--font-size-sm);
        color: $error700;

        code {
            font-family: monospace;
        }
    }
}

@keyframes permsummary-reveal {
    from {
        transform: translateY(6px);
        opacity: 0;
    }

    to {
        transform: translateY(0);
        opacity: 1;
    }
}

@media (prefers-reduced-motion: reduce) {
    .permsummary[open] .permsummary_body {
        animation: none;
    }
}
</style>
