<template>
    <CommonAppShell
        :back-label="entity.plural"
        :back-to="`/manage/${entity.key}`"
        :description="t('managePages.entity.newDescription', { entity: entity.label })"
        :title="t('managePages.entity.newTitle', { entity: entity.label })"
    >
        <ManageTemplateStarter
            v-if="entity.startFromTemplate"
            :config="entity.startFromTemplate"
            :draft="form.draft.value"
        />

        <component
            :is="bespoke ?? ManageEntityForm"
            v-model:draft="form.draft.value"
            :can-delete="false"
            :can-update="true"
            :entity="entity"
            :form="form"
            mode="create"
            @reset="form.reset()"
            @save="submit"
        />

        <ManageRelationsPanel
            :can-update="true"
            :entity="entity"
            mode="create"
            :relations="relations"
        />
    </CommonAppShell>
</template>

<script setup lang="ts">
import ManageEntityForm from '~/components/manage/ManageEntityForm.vue';
import ManageRelationsPanel from '~/components/manage/ManageRelationsPanel.vue';
import CommonAppShell from '~/components/common/CommonAppShell.vue';
import ManageTemplateStarter from '~/components/manage/ManageTemplateStarter.vue';
import { resolveDetailComponent } from '~/components/manage/detailComponents';
import { useEntityForm } from '~/composables/entityForm';
import { useEntityRelations } from '~/composables/entityRelations';
import { useEntityPermissions } from '~/composables/entityList';
import { findManageEntity } from '~/utils/manageRegistry';
import { useT } from '~/composables/i18n';

definePageMeta({
    middleware: 'manage',
    key: (route) => route.path,
});

const route = useRoute();
const { t } = useT();

// The middleware has already rejected an unknown section; this is the type
// narrowing, not a second guard. `t` is what resolves the registry's copy
// (issue #19); the middleware could not pass one, so it checked the wordless
// `findManageSection` instead.
const entity = findManageEntity(route.params.entity as string, t)!;

// NO `.toLowerCase()` on the entity name, here or in the title above: German
// capitalises every noun, so a lowercased "Räume" renders "räume". One message
// with a named placeholder, per i18n/CONVENTIONS.md § "Never case-transform
// user-facing text". The name itself arrives already translated from
// `manageEntities(t)`.
useHead(() => ({ title: t('managePages.entity.newTitle', { entity: entity.label }) }));

const { canCreate } = useEntityPermissions(entity);

// Read permission got us here; create is a separate grant. Redirecting rather
// than rendering a form whose save is guaranteed to 403.
if (!canCreate.value) {
    await navigateTo(`/manage/${entity.key}`);
}

const bespoke = resolveDetailComponent(entity.detailComponent);

const form = useEntityForm(entity, 'create');

// No id yet, so this fetches nothing and only supplies the "save first" notice.
// Instantiated anyway so the panel's shape is identical on both pages.
const relations = useEntityRelations(entity, undefined);

await Promise.all([form.ready, relations.ready]);

async function submit() {
    const id = await form.save();

    if (id) {
        await navigateTo(`/manage/${entity.key}/${id}`);
    }
}
</script>
