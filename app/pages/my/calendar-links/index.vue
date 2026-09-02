<template>
    <CommonPage :title="t('my.calendarLinks.pageTitle')">
        <p class="intro">{{ t('my.calendarLinks.intro') }}</p>

        <IcsLinksPanel/>
    </CommonPage>
</template>

<script setup lang="ts">
import CommonPage from '~/components/common/CommonPage.vue';
import IcsLinksPanel from '~/components/my/IcsLinksPanel.vue';
import { useT } from '~/composables/i18n';

/**
 * MOVED from `/manage/external-references` (issue #115): self-service over
 * the caller's own data (or, holding `ics_link.generate`, over Groups they
 * may target) belongs in `/my`, not Management; see `navigation.ts`'s
 * `my.calendar-links` entry for the fuller reasoning. Gated through the
 * shared `my` middleware, matching every other `/my/*` page:
 * `MY_SECTION_PERMISSIONS['/my/calendar-links']` is the single place that
 * key list is written.
 */
definePageMeta({ middleware: 'my' });

const { t } = useT();

useHead(() => ({ title: t('my.calendarLinks.pageTitle') }));
</script>

<style scoped lang="scss">
.intro {
    max-width: 68ch;
    margin-bottom: var(--space-7);
    font-size: var(--font-size-md);
    color: $content6;
}
</style>
