<template>
    <div class="person">
        <ManageEntityForm
            v-model:draft="draft"
            :can-delete="canDelete"
            :can-update="canUpdate"
            :form="form"
            :mode="mode"
            @request-delete="$emit('request-delete')"
            @reset="$emit('reset')"
            @save="$emit('save')"
        />

        <!--
            Issue #84: GDPR data export. Edit mode only: on create there is
            no id yet for the export route to name. A separate permission
            from `person.read`/`person.update` (see shared/permissions.ts's
            `person.export` comment), so gated on its own rather than on
            `canUpdate`/`canDelete`.
        -->
        <section
            v-if="mode === 'edit' && canExport"
            class="person_export"
        >
            <h2 class="person_export_title">{{ t('manageUi.personForm.exportTitle') }}</h2>

            <p class="person_export_hint">
                {{ t('manageUi.personForm.exportHint', { person: personLabel }) }}
            </p>

            <div class="person_export_actions">
                <CommonButton
                    :href="exportUrl('json')"
                    icon="material-symbols:data-object"
                    type="secondary"
                >{{ t('common.action.downloadJson') }}</CommonButton>

                <CommonButton
                    :href="exportUrl('xlsx')"
                    icon="material-symbols:table-outline"
                    type="secondary"
                >{{ t('common.action.downloadExcel') }}</CommonButton>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import type { useEntityForm } from '~/composables/entityForm';
import ManageEntityForm from '~/components/manage/ManageEntityForm.vue';
import CommonButton from '~/components/common/CommonButton.vue';
import { useT } from '~/composables/i18n';

/**
 * Person's detail: the shared generic form (every field here is plain,
 * nothing custom to inject into its `fields` slot) plus the GDPR export
 * action issue #84 adds. Bespoke for the same reason `ManageAccountForm`
 * keeps its credential ops OUTSIDE the form: a download is an explicit,
 * immediate action with no draft to discard, not a field that saves
 * alongside the rest.
 */
const props = defineProps<{
    form: ReturnType<typeof useEntityForm>;
    mode: 'create' | 'edit';
    canUpdate: boolean;
    canDelete: boolean;
}>();

defineEmits<{ save: []; reset: []; 'request-delete': [] }>();

const { t } = useT();

const draft = defineModel<Record<string, unknown>>('draft', { required: true });

const canExport = useHasPermission('person.export');

const row = computed(() => props.form.row.value as { id?: string; givenName?: string; familyName?: string } | null);

const personLabel = computed(() => {
    const name = `${row.value?.givenName ?? ''} ${row.value?.familyName ?? ''}`.trim();

    return name || t('manageUi.personForm.thisPerson');
});

function exportUrl(format: 'json' | 'xlsx'): string {
    return `/api/person-export/${row.value?.id ?? ''}?format=${format}`;
}
</script>

<style scoped lang="scss">
.person {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);

    &_export {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);

        max-width: 620px;
        padding: var(--space-7);
        border-radius: var(--radius-xl);

        background: $surface1;

        &_title {
            margin: 0;
            font-size: var(--font-size-md);
            font-weight: 680;
            color: $content3;
        }

        &_hint {
            margin: 0;
            font-size: var(--font-size-sm);
            line-height: 1.5;
            color: $content7;
        }

        &_actions {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-4);
        }
    }
}
</style>
