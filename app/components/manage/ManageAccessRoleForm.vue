<template>
    <ManageEntityForm
        v-model:draft="draft"
        :can-delete="canDelete"
        :can-update="canUpdate"
        :form="form"
        :mode="mode"
        @request-delete="$emit('request-delete')"
        @reset="$emit('reset')"
        @save="$emit('save')"
    >
        <template #fields="{ readonly }">
            <fieldset class="grants">
                <legend>Permissions</legend>

                <p class="grants_summary">
                    <strong>{{ granted.size }}</strong> of {{ catalogueSize }} granted.
                    Permissions are fixed — they are code, one per action the software implements.
                    A tenant composes them into roles; it cannot invent one.
                </p>

                <p
                    v-if="form.fieldErrors.value.permissions"
                    class="grants_note grants_note--error"
                    role="alert"
                >{{ form.fieldErrors.value.permissions }}</p>

                <p
                    v-else-if="!readonly && granted.size === 0"
                    class="grants_note grants_note--warn"
                >
                    A role holding nothing is a role that does nothing — it will be granted to
                    somebody who then cannot act, with nothing on screen to say why. Pick at
                    least one.
                </p>

                <!--
                    Advisory, and deliberately not the error tone: nothing is
                    wrong yet, and `name` is not unique in the schema. Silence is
                    how a rule labelled "Cap online share per group" came to be a
                    minimize_exam_week_sessions row, so this is said out loud and
                    not blocked. `role="status"` announces politely.
                -->
                <p
                    v-if="!readonly && nameClash"
                    class="grants_note grants_note--warn"
                    role="status"
                >
                    ‘{{ nameClash.key }}’ in this tenant already displays as “{{ nameClash.name }}”.
                    Not blocked, but two roles reading identically in a picker is how the wrong
                    one gets assigned.
                </p>

                <!--
                    A stored grant this build has no catalogue entry for. Reported
                    rather than hidden, and it CANNOT be kept: the API validates
                    every key against the catalogue, so a save carrying it would
                    be refused outright. Saying which keys go, before the button
                    is pressed, is the honest version of that.
                -->
                <p
                    v-if="unknownGrants.length"
                    class="grants_note grants_note--error"
                    role="alert"
                >
                    This role holds {{ unknownGrants.length }} permission{{ unknownGrants.length === 1 ? '' : 's' }}
                    this build does not know: <code>{{ unknownGrants.join(', ') }}</code>.
                    {{ unknownGrants.length === 1 ? 'It grants' : 'They grant' }} nothing, because no code path
                    checks {{ unknownGrants.length === 1 ? 'it' : 'them' }}, and saving this role removes
                    {{ unknownGrants.length === 1 ? 'it' : 'them' }}.
                </p>

                <section
                    v-for="category in categories"
                    :key="category.key"
                    class="grants_group"
                >
                    <header class="grants_head">
                        <h3>{{ categoryLabel(category.key) }}</h3>

                        <span class="grants_count">
                            {{ countIn(category) }}/{{ category.permissions.length }}
                        </span>

                        <button
                            v-if="!readonly"
                            class="grants_all"
                            type="button"
                            @click="toggleCategory(category)"
                        >{{ countIn(category) === category.permissions.length ? 'Clear' : 'All' }}</button>
                    </header>

                    <template v-if="!readonly">
                        <label
                            v-for="permission in category.permissions"
                            :key="permission.key"
                            class="grants_row"
                            :class="{ 'grants_row--on': granted.has(permission.key) }"
                        >
                            <input
                                :checked="granted.has(permission.key)"
                                type="checkbox"
                                @change="toggle(permission.key)"
                            >
                            <code class="grants_key">{{ permission.key }}</code>
                            <span class="grants_desc">{{ permission.description }}</span>
                        </label>
                    </template>

                    <!--
                        Read-only renders the selection as TEXT, never as disabled
                        checkboxes: a disabled control reads as "unavailable right
                        now" rather than "not yours to change".
                    -->
                    <template v-else>
                        <p
                            v-for="permission in category.permissions.filter((p) => granted.has(p.key))"
                            :key="permission.key"
                            class="grants_static"
                        >
                            <code class="grants_key">{{ permission.key }}</code>
                            <span class="grants_desc">{{ permission.description }}</span>
                        </p>

                        <p
                            v-if="countIn(category) === 0"
                            class="grants_static grants_static--none"
                        >None</p>
                    </template>
                </section>
            </fieldset>
        </template>
    </ManageEntityForm>
</template>

<script setup lang="ts">
import type { PermissionCategory, PermissionKey } from '#shared/permissions';
import type { useEntityForm } from '~/composables/entityForm';
import ManageEntityForm from '~/components/manage/ManageEntityForm.vue';
import { isPermissionKey, permissionCategories } from '#shared/permissions';

/**
 * AccessRole's detail: the shared form, plus a matrix over the FIXED permission
 * catalogue.
 *
 * WHY THIS IS BESPOKE AND NOT A RELATION PICKER
 *
 * `ManageRelationPicker` is a select-to-add over rows fetched from an API
 * resource. There is no `/api/permissions` resource and there must not be one:
 * permissions are code, not tenant data. Fifty-three options in a dropdown, with
 * no categories and no descriptions, would also be a worse control than the one
 * it replaced.
 *
 * THE ROWS COME FROM THE CATALOGUE, NOT FROM THE FETCH — the same rule
 * `ManageConstraintGrid` follows. Every permission the code implements gets a
 * checkbox whether or not this tenant's database has been seeded with it, and a
 * stored grant the catalogue does NOT describe is reported rather than dropped
 * silently. A list that quietly omits things is exactly how a rule nobody could
 * see was missing survived a whole stage.
 *
 * The grants save WITH the row, through the form's own Save button, because
 * they are a child collection on the payload rather than a relation — see
 * `RESOURCES['access-roles'].childKeys`. So there is no second save here and no
 * window in which the role grants nothing.
 */
const props = defineProps<{
    form: ReturnType<typeof useEntityForm>;
    mode: 'create' | 'edit';
    canUpdate: boolean;
    canDelete: boolean;
}>();

defineEmits<{ save: []; reset: []; 'request-delete': [] }>();

const draft = defineModel<Record<string, unknown>>('draft', { required: true });

const categories = permissionCategories();
const catalogueSize = categories.reduce((total, category) => total + category.permissions.length, 0);

/** One stored grant, as the API returns it and as the payload expects it back. */
interface Grant {
    permissionKey: string;
}

/**
 * The draft's grants, narrowed.
 *
 * `unknown` becomes a typed list exactly here and nowhere else. It genuinely can
 * be several things: an array of rows on an existing role, and the empty string
 * on the create page, because `toInputValue` coerces an absent value for a
 * `text`-typed field — the same shape `constraint.scopes` lives with.
 */
function grantsOf(value: unknown): Grant[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((row) => (row as { permissionKey?: unknown }).permissionKey)
        .filter((key): key is string => typeof key === 'string')
        .map((permissionKey) => ({ permissionKey }));
}

const granted = computed(() => new Set(grantsOf(draft.value.permissions).map((grant) => grant.permissionKey)));

/**
 * Stored keys the catalogue does not describe.
 *
 * Reachable for real: removing a permission from the catalogue is a breaking
 * change for every tenant that assigned it, and the grant row outlives the code
 * path. Surfaced in the template; the save drops them, because the write
 * boundary validates every key and would refuse the whole request otherwise.
 */
const unknownGrants = computed(() => [...granted.value].filter((key) => !isPermissionKey(key)));

/**
 * Written back NORMALISED — `{ permissionKey }` and nothing else.
 *
 * The read includes the join row's own columns (`accessRoleId`, `tenantId`), and
 * echoing those back would send the server data it must never take from a
 * request body. Rebuilding the list from the catalogue-checked key set also
 * drops any unknown grant, which is what the warning above promises.
 */
function commit(keys: Set<string>) {
    draft.value.permissions = [...keys]
        .filter((key): key is PermissionKey => isPermissionKey(key))
        .sort()
        .map((permissionKey) => ({ permissionKey }));
}

function toggle(key: PermissionKey) {
    const next = new Set(granted.value);

    if (!next.delete(key)) {
        next.add(key);
    }

    commit(next);
}

function countIn(category: PermissionCategory): number {
    return category.permissions.filter((permission) => granted.value.has(permission.key)).length;
}

/**
 * All-or-nothing within one category — never across the whole catalogue.
 *
 * `create:role` deliberately has no `--all` flag: a role granted "everything"
 * once silently stops being everything the next time a permission is added, and
 * a second full-catalogue role per tenant is an unaudited second administrator.
 * A global "select all" here would be that button with a nicer name.
 */
function toggleCategory(category: PermissionCategory) {
    const next = new Set(granted.value);
    const complete = countIn(category) === category.permissions.length;

    for (const permission of category.permissions) {
        if (complete) {
            next.delete(permission.key);
        } else {
            next.add(permission.key);
        }
    }

    commit(next);
}

/**
 * `time_grid` → `Time grid`. Derived rather than listed, so a new category
 * cannot arrive with no heading — the failure the constraint grid's
 * derived-count label exists to prevent, one screen over.
 */
function categoryLabel(key: string): string {
    const words = key.replace(/_/g, ' ');

    return words.charAt(0).toUpperCase() + words.slice(1);
}

/*
 * Sibling roles, for the display-name warning.
 *
 * `useAsyncData` + `useRequestFetch`, not an `onMounted` fetch: a client-only
 * hook does not run on the server, and a bare `$fetch` carries no cookie there.
 * Degraded to an empty list on failure — the warning is advisory, and this page
 * already requires `access_role.manage`, so the only thing an empty list costs
 * is the warning itself.
 */
const request = useRequestFetch();

const siblingsData = useAsyncData(
    'access-role-form:siblings',
    () => request<{ rows: { id: string; key: string; name: string }[] }>('/api/access-roles', {
        query: { limit: 200 },
    }),
    { default: () => ({ rows: [] as { id: string; key: string; name: string }[] }) },
);

/**
 * Warned live as the name is typed, rather than after the write.
 *
 * `create:role` reports this only once the row exists, because a CLI has no
 * earlier moment. A form does.
 */
const nameClash = computed(() => {
    const name = String(draft.value.name ?? '').trim().toLowerCase();

    if (!name) {
        return null;
    }

    const selfId = (props.form.row.value as { id?: string } | null)?.id;

    return (siblingsData.data.value?.rows ?? []).find(
        (row) => row.id !== selfId && row.name.trim().toLowerCase() === name,
    ) ?? null;
});
</script>

<style scoped lang="scss">
.grants {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    margin: 0;
    padding: var(--space-6);
    border: 1px solid $surface4;
    border-radius: var(--radius-xl);

    legend {
        padding: 0 var(--space-2);
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content4;
    }

    &_summary {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;
    }

    &_note {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;

        &--warn {
            color: $warning700;
        }

        &--error {
            font-weight: 600;
            color: $error700;
        }

        code {
            font-size: var(--font-size-xs);
        }
    }

    &_group {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        padding-top: var(--space-3);
        border-top: 1px solid $surface3;
    }

    &_head {
        display: flex;
        gap: var(--space-3);
        align-items: baseline;

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

    &_all {
        cursor: pointer;

        margin-left: auto;
        padding: var(--space-1) var(--space-3);
        border: 1px solid $surface4;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-xs);
        color: $content4;

        background: $surface0;

        &:hover {
            border-color: $primary500;
            color: $primary500;
        }
    }

    &_row,
    &_static {
        display: flex;
        gap: var(--space-3);
        align-items: baseline;

        margin: 0;
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-md);
    }

    &_row {
        cursor: pointer;

        &--on {
            background: $surface2;
        }
    }

    &_key {
        flex: 0 0 auto;
        min-width: 190px;
        font-size: var(--font-size-xs);
        color: $content3;
    }

    &_desc {
        font-size: var(--font-size-sm);
        color: $content7;
    }

    &_static--none {
        font-size: var(--font-size-sm);
        color: $content7;
    }
}
</style>
