<template>
    <section class="export">
        <h2>{{ t('exports.self.heading') }}</h2>
        <p class="export_hint">
            {{ t('exports.self.hint') }}
        </p>

        <div class="export_actions">
            <CommonButton
                href="/api/me/export?format=json"
                icon="material-symbols:data-object"
                type="outline"
            >{{ t('common.action.downloadJson') }}</CommonButton>

            <CommonButton
                href="/api/me/export?format=xlsx"
                icon="material-symbols:table-outline"
                type="outline"
            >{{ t('common.action.downloadExcel') }}</CommonButton>
        </div>
    </section>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import { useT } from '~/composables/i18n';

/**
 * `GET /api/me/export` (issue #84), self-service: no fetch of its own to
 * manage: both buttons are plain links to a GET route that answers with
 * `content-disposition: attachment`, so the browser downloads the file
 * without navigating away. No permission gate, matching the route itself.
 *
 * Copy is the `exports` namespace even though the component sits in
 * `components/my/` (i18n/CONVENTIONS.md's ownership table names it
 * explicitly): the more specific entry wins, so one screen's export copy is
 * not split across two namespaces.
 */
const { t } = useT();
</script>

<style scoped lang="scss">
.export {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);

    /* Flat. It was a `$surface1` card on the `$surface1` page ground: no
       visible edge, only a 24px indent that made the section look misaligned
       under the page's own intro. */

    h2 {
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
</style>
