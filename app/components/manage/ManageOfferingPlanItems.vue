<template>
    <section class="items">
        <header class="items_head">
            <h2>{{ t('manageUi.offeringPlanItems.title') }}</h2>
            <span
                v-if="busy"
                class="items_state"
            >{{ t('manageUi.shared.working') }}</span>
        </header>

        <p class="items_help">
            {{ t('manageUi.offeringPlanItems.help') }}
        </p>

        <p
            v-if="error"
            class="items_error"
            role="alert"
        >{{ error }}</p>

        <ol
            v-if="rows.length"
            class="items_rows"
        >
            <li
                v-for="row in rows"
                :key="row.templateId"
                class="items_row"
            >
                <span>{{ nameOf(row.templateId) }}</span>
                <button
                    v-if="!readonly"
                    class="items_remove"
                    :disabled="busy"
                    type="button"
                    :aria-label="t('manageUi.shared.removeAria', { label: nameOf(row.templateId) })"
                    @click="remove(row.templateId)"
                >
                    <Icon
                        name="material-symbols:close"
                        aria-hidden="true"
                    />
                </button>
            </li>
        </ol>

        <p
            v-else
            class="items_empty"
        >
            {{ t('manageUi.offeringPlanItems.empty') }}
        </p>

        <label
            v-if="!readonly"
            class="items_add"
        >
            <span class="sr-only">{{ t('manageUi.offeringPlanItems.addLabel') }}</span>
            <select
                :disabled="busy || !available.length"
                :value="''"
                @change="add($event)"
            >
                <option value="">{{
                    available.length
                        ? t('manageUi.offeringPlanItems.addOption')
                        : t('manageUi.offeringPlanItems.allAdded')
                }}</option>
                <option
                    v-for="option in available"
                    :key="option.id"
                    :value="String(option.id)"
                >{{ option.name }}</option>
            </select>
        </label>
    </section>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';

/**
 * A plan's ordered item list: see `OfferingPlanItem`'s own schema comment
 * for why order is stored rather than computed, and `items.put.ts` for why
 * this is a bespoke endpoint rather than the generic `[relation]` mechanism
 * (that one replaces a SET; a plan's items are a SEQUENCE).
 *
 * SAVES IMMEDIATELY on every add/remove, like `ManageGroupSources` beside it
 * and for the same reason: this is a sub-resource with its own endpoint, and
 * staging it behind the plan's own Save button would let the plan and its
 * items half-succeed.
 */
const props = defineProps<{
    planId: string;
    readonly?: boolean;
}>();

interface ItemRow { templateId: string }
interface TemplateOption { id: string; name: string }

const { t } = useT();

const request = useRequestFetch();

const { data: templates } = await useAsyncData(
    'offering-plan-items:templates',
    () => request<TemplateOption[]>('/api/offering-templates'),
    { default: () => [] as TemplateOption[] },
);

const { data: rowsData, refresh } = await useAsyncData(
    `offering-plan-items:${props.planId}`,
    () => request<ItemRow[]>(`/api/offering-plan-items/${props.planId}`),
    { default: () => [] as ItemRow[] },
);

const rows = computed(() => rowsData.value ?? []);
const allTemplates = computed(() => templates.value ?? []);

function nameOf(id: string): string {
    const template = allTemplates.value.find((t) => String(t.id) === id);

    // The raw id rather than a blank: an unresolvable template is something
    // to see and fix, not something to hide.
    return template ? template.name : id;
}

const available = computed(() => {
    const taken = new Set(rows.value.map((r) => r.templateId));

    return allTemplates.value.filter((t) => !taken.has(String(t.id)));
});

const busy = ref(false);
const error = ref('');

async function save(next: ItemRow[]) {
    busy.value = true;
    error.value = '';

    try {
        await request(`/api/offering-plan-items/${props.planId}`, { method: 'PUT', body: next });
        await refresh();
    } catch (cause) {
        error.value = serverErrorMessage(cause)
            ?? t('manageUi.offeringPlanItems.error');
    } finally {
        busy.value = false;
    }
}

function add(event: Event) {
    const select = event.target as HTMLSelectElement;
    const value = select.value;

    select.value = '';

    if (value) {
        void save([...rows.value, { templateId: value }]);
    }
}

function remove(templateId: string) {
    void save(rows.value.filter((r) => r.templateId !== templateId));
}
</script>

<style scoped lang="scss">
.items {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    padding: var(--space-6);
    border-radius: var(--radius-xl);

    background: $surface1;

    &_head {
        display: flex;
        gap: var(--space-4);
        align-items: baseline;

        h2 {
            margin: 0;
            font-size: var(--font-size-md);
            font-weight: 680;
            color: $content2;
        }
    }

    &_state {
        font-size: var(--font-size-xs);
        color: $content7;
    }

    &_help {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;
    }

    &_error {
        margin: 0;
        padding: var(--space-3) var(--space-5);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $error700;

        background: varToRgba('error500', 0.14);
    }

    &_rows {
        counter-reset: item;

        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        margin: 0;
        padding: 0;

        list-style: none;
    }

    &_row {
        display: flex;
        gap: var(--space-4);
        align-items: center;
        justify-content: space-between;

        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        color: $content3;

        background: $surface0;

        &::before {
            content: counter(item) '.';
            counter-increment: item;

            flex: none;

            font-weight: 650;
            color: $content7;
        }

        span {
            flex: 1;
        }
    }

    &_remove {
        cursor: pointer;

        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;

        width: 24px;
        height: 24px;
        border: 0;
        border-radius: var(--radius-sm);

        color: $surface7;

        background: none;

        svg {
            width: 16px;
            height: 16px;
        }

        @include hover() {
            &:hover {
                color: $error700;
                background: varToRgba('error500', 0.14);
            }
        }
    }

    &_empty {
        margin: 0;
        font-size: var(--font-size-sm);
        font-style: italic;
        color: $content7;
    }

    &_add select {
        width: 100%;
        padding: var(--space-3) var(--space-5);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content4;

        background: $surface0;
    }
}

.sr-only {
    position: absolute;

    overflow: hidden;

    width: 1px;
    height: 1px;

    clip-path: inset(50%);
}
</style>
