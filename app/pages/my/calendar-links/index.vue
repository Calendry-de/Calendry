<template>
    <CommonPage title="Calendar links">
        <p class="intro">
            Subscribe an external calendar app (Google Calendar, Outlook, Apple
            Calendar…) to your own schedule, or — if you may — to a specific
            Group's.
        </p>

        <IcsLinksPanel/>
    </CommonPage>
</template>

<script setup lang="ts">
import CommonPage from '~/components/common/CommonPage.vue';
import IcsLinksPanel from '~/components/my/IcsLinksPanel.vue';

/**
 * MOVED from `/manage/external-references` (issue #115): self-service over
 * the caller's own data (or, holding `ics_link.generate`, over Groups they
 * may target) belongs in `/my`, not Management — see `navigation.ts`'s
 * `my.calendar-links` entry for the fuller reasoning. Gated through the
 * shared `my` middleware, matching every other `/my/*` page:
 * `MY_SECTION_PERMISSIONS['/my/calendar-links']` is the single place that
 * key list is written.
 */
definePageMeta({ middleware: 'my' });

useHead({ title: 'Calendar links' });
</script>

<style scoped lang="scss">
.intro {
    max-width: 68ch;
    margin-bottom: var(--space-7);
    font-size: var(--font-size-md);
    color: $content6;
}
</style>
