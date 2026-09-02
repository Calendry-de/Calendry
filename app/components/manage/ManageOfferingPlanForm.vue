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
            <div class="next">
                <label
                    class="next_label"
                    :for="controlId"
                >Successor plan</label>

                <p
                    v-if="readonly"
                    :id="controlId"
                    class="next_static"
                >{{ currentNextLabel }}</p>

                <select
                    v-else
                    :id="controlId"
                    class="next_control"
                    :value="(draft.nextPlanId as string) ?? ''"
                    @change="draft.nextPlanId = ($event.target as HTMLSelectElement).value || null"
                >
                    <!-- `:selected` so the current value survives SSR; see ManageField. -->
                    <option
                        :selected="!draft.nextPlanId"
                        value=""
                    >None</option>
                    <option
                        v-for="option in nextPlanOptions"
                        :key="option.id"
                        :selected="String(option.id) === String(draft.nextPlanId ?? '')"
                        :value="String(option.id)"
                    >{{ option.name }}</option>
                </select>

                <p
                    v-if="form.fieldErrors.value.nextPlanId"
                    class="next_error"
                    role="alert"
                >{{ form.fieldErrors.value.nextPlanId }}</p>

                <p
                    v-else
                    class="next_hint"
                >What a Group on this plan moves to next: "Semester 3" names "Semester 4", so
                    advancing needs no picker later. Leave unset for a plan nothing follows.</p>
            </div>

            <!--
                EDIT MODE ONLY, and not for tidiness: the item list is a
                sub-resource that saves immediately against
                `/api/offering-plan-items/{id}`, so on the create page there
                is no id for it to hang off, same reasoning as
                `ManageGroupSources` on the Group form.
            -->
            <ManageOfferingPlanItems
                v-if="mode === 'edit' && form.row.value"
                :plan-id="String(form.row.value.id)"
                :readonly="readonly"
            />

            <!-- Same edit-only reasoning again: rolling out to several groups needs a real plan id to apply. -->
            <ManageOfferingPlanBulkApply
                v-if="mode === 'edit' && form.row.value"
                :plan-id="String(form.row.value.id)"
                :readonly="readonly"
            />
        </template>
    </ManageEntityForm>
</template>

<script setup lang="ts">
import type { useEntityForm } from '~/composables/entityForm';
import type { EntityRow } from '~/utils/manageRegistry';
import ManageEntityForm from '~/components/manage/ManageEntityForm.vue';
import ManageOfferingPlanBulkApply from '~/components/manage/ManageOfferingPlanBulkApply.vue';
import ManageOfferingPlanItems from '~/components/manage/ManageOfferingPlanItems.vue';

/**
 * Curriculum plan's detail: the shared form plus its ordered item list and
 * bulk-apply action, plus a successor picker no static registry entry can
 * express: a plan cannot name ITSELF, which depends on which row is being
 * edited (there is no such row at all on the create page, so this control
 * only makes a real choice possible in edit mode; on create it just offers
 * every plan, self-exclusion being vacuous before the row has an id).
 */
const props = defineProps<{
    canDelete: boolean;
    canUpdate: boolean;
    form: ReturnType<typeof useEntityForm>;
    mode: 'create' | 'edit';
}>();

defineEmits<{
    'request-delete': [];
    reset: [];
    save: [];
}>();

const draft = defineModel<Record<string, unknown>>('draft', { required: true });

const controlId = useId();

/** Every plan, fetched by the form composable because the field declares the reference. */
const allPlans = computed<EntityRow[]>(() => props.form.references.value['offering-plans'] ?? []);

const nextPlanOptions = computed(() => allPlans.value
    .filter((plan) => props.mode !== 'edit' || String(plan.id) !== String(props.form.row.value?.id ?? ''))
    .map((plan) => ({ id: String(plan.id), name: String(plan.name ?? plan.id) })));

const currentNextLabel = computed(() => {
    const id = draft.value.nextPlanId as string | null | undefined;

    if (!id) {
        return 'None';
    }

    return allPlans.value.find((plan) => String(plan.id) === String(id))?.name as string ?? id;
});
</script>

<style scoped lang="scss">
.next {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-6);

    &_label {
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content4;
    }

    &_static {
        margin: 0;
        font-size: var(--font-size-md);
        color: $content3;
    }

    &_control {
        padding: var(--space-3) var(--space-5);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content4;

        background: $surface0;
    }

    &_error {
        margin: 0;
        font-size: var(--font-size-xs);
        color: $error700;
    }

    &_hint {
        margin: 0;
        font-size: var(--font-size-xs);
        line-height: 1.5;
        color: $content7;
    }
}
</style>
