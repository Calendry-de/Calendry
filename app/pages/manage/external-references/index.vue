<template>
    <CommonAppShell
        description="Links you hand to something outside the app."
        title="External references"
    >
        <p class="intro">
            Just calendar links today; a student-facing schedule link (no account at
            all) is the obvious next thing to live here too.
        </p>

        <IcsLinksPanel/>
    </CommonAppShell>
</template>

<script setup lang="ts">
import CommonAppShell from '~/components/common/CommonAppShell.vue';
import IcsLinksPanel from '~/components/my/IcsLinksPanel.vue';

/**
 * Filed under Management (issue #15's stream half) rather than "My settings"
 * — the dashboard's manage-entities overview picks this up automatically
 * (`useManageSections()` filters on the `manage.` id prefix), the same way it
 * picks up Screens, a comparable device/link credential.
 *
 * NOT a registry entity, so NOT gated through the `manage` middleware or
 * `manageRegistry.ts` — same shape `/manage/display` and `/manage/access-defaults`
 * take for a bespoke page. NO PERMISSION AT ALL, deliberately, unlike every
 * sibling on this grid: the panel below is pure self-service over the
 * caller's own Sessions (the same authority `/my/account` already exercises
 * with no permission), never the institution's data, so there is nothing here
 * for a permission to gate.
 */
useHead({ title: 'External references' });
</script>

<style scoped lang="scss">
.intro {
    max-width: 68ch;
    margin-bottom: var(--space-7);
    font-size: var(--font-size-md);
    color: $content6;
}
</style>
