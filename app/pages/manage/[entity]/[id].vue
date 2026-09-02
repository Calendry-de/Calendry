<template>
    <CommonAppShell
        :back-label="entity.plural"
        :back-to="`/manage/${entity.key}`"
        :title="title"
    >
        <!--
            THE SAME ACTION THE LIST HEADER CARRIES, kept on the detail screen so
            entering a run of records does not round-trip through the list.

            Creating lands you HERE (`new.vue` navigates to the row it just made),
            so without this the loop is: back to the list, New, fill, create,
            back to the list. Two navigations per record whose only purpose is to
            reach a button that was already on screen a moment ago.

            Same conditions as the list's copy, read from the same registry entry:
            `hideCreateAction` still suppresses it for the constraint catalogue,
            where "New" would frame a fixed set of switches as a collection you
            populate.
        -->
        <template
            v-if="canCreate && !entity.hideCreateAction"
            #actions
        >
            <CommonButton
                icon="material-symbols:add"
                :to="`/manage/${entity.key}/new`"
                type="secondary"
            >{{ t('managePages.entity.createAction', { entity: entity.label }) }}</CommonButton>
        </template>

        <ManageSaveAsTemplate
            v-if="entity.saveAsTemplate && form.row.value"
            :config="entity.saveAsTemplate"
            :row="form.row.value"
        />

        <component
            :is="bespoke ?? ManageEntityForm"
            v-model:draft="form.draft.value"
            :can-delete="canDelete"
            :can-update="canUpdate"
            :entity="entity"
            :form="form"
            mode="edit"
            @request-delete="confirming = true"
            @reset="form.reset()"
            @save="submit"
        />

        <ManageRelationsPanel
            :can-update="canUpdate"
            :entity="entity"
            mode="edit"
            :relations="relations"
        />

        <ManageDeleteDialog
            :busy="form.busy.value"
            :entity-label="entity.label"
            :error="deleteError"
            :open="confirming"
            :subject="title"
            @cancel="confirming = false"
            @confirm="confirmDelete"
        />
    </CommonAppShell>
</template>

<script setup lang="ts">
import ManageDeleteDialog from '~/components/manage/ManageDeleteDialog.vue';
import ManageEntityForm from '~/components/manage/ManageEntityForm.vue';
import ManageRelationsPanel from '~/components/manage/ManageRelationsPanel.vue';
import ManageSaveAsTemplate from '~/components/manage/ManageSaveAsTemplate.vue';
import CommonAppShell from '~/components/common/CommonAppShell.vue';
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
const id = route.params.id as string;

const { canCreate, canUpdate, canDelete } = useEntityPermissions(entity);

const bespoke = resolveDetailComponent(entity.detailComponent);

const form = useEntityForm(entity, 'edit', id);
const relations = useEntityRelations(entity, id);

// Both composables are synchronous; this is the page's single await point, and
// both resolve before the first render. Awaiting them in parallel rather than in
// sequence keeps SSR to one request wave.
await Promise.all([form.ready, relations.ready]);

/*
 * A FAILED ROW FETCH IS AN ERROR, not an empty form.
 *
 * `useAsyncData`'s handle resolves even when its handler throws, so without this
 * a mistyped or stale id rendered a form with every field blank and answered
 * 200: the API said 404 and the page disagreed. Anyone typing into it was
 * filling in a record that does not exist.
 *
 * Thrown HERE and not in the composable, because only a page can answer with a
 * status. The underlying status is carried through rather than flattened to 500:
 * a 404 and a 403 are different facts for whoever is looking at it.
 *
 * Deliberately narrow: `loadError` is the ROW's failure alone. A reference list
 * that 403s is handled by locking that field, and must NOT reach this: see
 * `isFieldLocked` and `tests/form-reference-wave.test.ts`.
 */
if (form.loadError.value) {
    const cause = form.loadError.value as { statusCode?: number };

    throw createError({
        statusCode: cause.statusCode ?? 404,
        message: serverErrorMessage(form.loadError.value)
            ?? t('managePages.entity.loadFailed', { entity: entity.label }),
        fatal: true,
    });
}

const title = computed(() => (form.row.value ? entity.title(form.row.value) : entity.label));

useHead(() => ({ title: title.value }));

const confirming = ref(false);
const deleteError = ref('');

async function submit() {
    await form.save();
}

async function confirmDelete() {
    deleteError.value = '';

    const removed = await form.remove();

    if (removed) {
        await navigateTo(`/manage/${entity.key}`);

        return;
    }

    // The dialog stays open holding the reason. A 409 here is the database
    // refusing to orphan real references, and that is information the user needs,
    // not a failure to swallow.
    deleteError.value = form.formError.value || t('managePages.entity.deleteFailed');
    confirming.value = true;
}
</script>
