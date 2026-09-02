<template>
    <CommonAppShell
        :title="entity.plural"
        :description="entity.description"
    >
        <!--
            The entity name is NOT lowercased: German capitalises nouns, so
            `.toLowerCase()` rendered "räume". One message, one named
            placeholder, no transform (i18n/CONVENTIONS.md § "Never
            case-transform user-facing text").
        -->
        <template
            v-if="canCreate && !entity.hideCreateAction"
            #actions
        >
            <CommonButton
                icon="material-symbols:add"
                :to="`/manage/${entity.key}/new`"
                type="primary"
            >{{ t('managePages.entity.createAction', { entity: entity.label }) }}</CommonButton>
        </template>

        <component
            :is="bespokeList ?? ManageList"
            v-model:page="list.page.value"
            v-model:search="list.search.value"
            :can-create="canCreate"
            :entity="entity"
            :list="list"
        />
    </CommonAppShell>
</template>

<script setup lang="ts">
import ManageList from '~/components/manage/ManageList.vue';
import CommonAppShell from '~/components/common/CommonAppShell.vue';
import { resolveListComponent } from '~/components/manage/detailComponents';
import { useEntityList, useEntityPermissions } from '~/composables/entityList';
import { findManageEntity } from '~/utils/manageRegistry';
import { useT } from '~/composables/i18n';

/**
 * One list page for every managed entity.
 *
 * `key` forces a fresh component per entity. Vue Router reuses a component
 * instance when only the params change, so without this, navigating
 * /manage/rooms → /manage/persons would keep the first entity's composable
 * state and quietly show the wrong list.
 */
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

useHead(() => ({ title: entity.plural }));

const { canCreate } = useEntityPermissions(entity);

const bespokeList = resolveListComponent(entity.listComponent);

const list = useEntityList(entity);

// Synchronous composable, single await at setup top level. SSR must resolve
// before first render or the page hydrates from an empty list.
await list.ready;
</script>
