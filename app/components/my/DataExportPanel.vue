<template>
    <section class="export">
        <h2>Your data</h2>
        <p class="export_hint">
            Everything Calendry holds about you — profile, roles, group memberships, sessions,
            unavailability, preferences, exam requests, API tokens, calendar links and your own
            audit trail. A GDPR Right to Access request, self-service.
        </p>

        <div class="export_actions">
            <CommonButton
                href="/api/me/export?format=json"
                icon="material-symbols:data-object"
                type="secondary"
            >Download JSON</CommonButton>

            <CommonButton
                href="/api/me/export?format=xlsx"
                icon="material-symbols:table-outline"
                type="secondary"
            >Download Excel</CommonButton>
        </div>
    </section>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';

/**
 * `GET /api/me/export` (issue #84), self-service — no fetch of its own to
 * manage: both buttons are plain links to a GET route that answers with
 * `content-disposition: attachment`, so the browser downloads the file
 * without navigating away. No permission gate, matching the route itself.
 */
</script>

<style scoped lang="scss">
.export {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);

    padding: var(--space-7);
    border-radius: var(--radius-xl);

    background: $surface1;

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
