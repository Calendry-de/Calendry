<template>
    <CommonPage :title="t('my.dataExport.pageTitle')">
        <p class="intro">{{ t('my.dataExport.intro') }}</p>

        <DataExportPanel/>
    </CommonPage>
</template>

<script setup lang="ts">
import DataExportPanel from '~/components/my/DataExportPanel.vue';
import CommonPage from '~/components/common/CommonPage.vue';
import { useT } from '~/composables/i18n';

/**
 * A Person's own data export (the subject-access half of issue #84), on its
 * own page rather than buried under the locale form on `/my/account`.
 *
 * NO PERMISSION GATE, and deliberately no `middleware: 'my'`: this exports the
 * caller's OWN row and nobody else's, which is authority a Person always has
 * over themselves. The tenant-wide export is a different thing entirely and
 * lives at `/manage/data-export` behind `tenant.export`.
 */
const { t } = useT();

useHead(() => ({ title: t('my.dataExport.pageTitle') }));
</script>

<style scoped lang="scss">
.intro {
    max-width: 68ch;
    margin: 0 0 var(--space-l);

    font-size: var(--font-size-sm);
    line-height: 1.5;
    color: $content7;
}
</style>
