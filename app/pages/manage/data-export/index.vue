<template>
    <CommonAppShell
        description="Every Person, login, Group, Room, Offering, Session, exam request and Constraint this institution owns, in one download."
        title="Data export"
    >
        <p class="intro">
            For a departing institution taking its data with it, or answering a Right to
            Access request that spans more than one person. A single Person's own record can
            be exported from their own page instead; this is everything at once.
        </p>

        <div class="actions">
            <CommonButton
                href="/api/tenant/export?format=json"
                icon="material-symbols:data-object"
                type="secondary"
            >Download JSON</CommonButton>

            <CommonButton
                href="/api/tenant/export?format=xlsx"
                icon="material-symbols:table-outline"
                type="secondary"
            >Download Excel</CommonButton>
        </div>
    </CommonAppShell>
</template>

<script setup lang="ts">
import CommonAppShell from '~/components/common/CommonAppShell.vue';
import CommonButton from '~/components/common/CommonButton.vue';
import { useSession } from '~/composables/session';

/**
 * The tenant-wide half of issue #84: `GET /api/tenant/export`. Bespoke
 * settings page rather than a registry entity, same reasoning as
 * `/manage/curriculum-progression`: there is no list of rows to CRUD, just
 * one action, and both download buttons are plain links: the route answers
 * with `content-disposition: attachment`, so no fetch/blob handling is
 * needed here.
 *
 * Erasing a tenant has NO matching page here: it is staff-only
 * (`DELETE /api/staff/tenants/:id`), never tenant self-service, so it lives
 * in the staff panel instead. See shared/permissions.ts's `tenant.export`
 * comment.
 */
definePageMeta({
    middleware: [
        () => {
            const held = new Set(useSession().value?.permissions ?? []);

            if (!held.has('tenant.export')) {
                return abortNavigation(createError({
                    statusCode: 403,
                    statusMessage: 'Data export needs tenant.export.',
                }));
            }
        },
    ],
});

useHead({ title: 'Data export' });
</script>

<style scoped lang="scss">
.intro {
    max-width: 68ch;
    margin-bottom: var(--space-6);
    font-size: var(--font-size-md);
    color: $content6;
}

.actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}
</style>
