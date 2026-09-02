<template>
    <CommonAppShell
        :description="t('exports.tenant.description')"
        :title="t('exports.tenant.heading')"
    >
        <p class="intro">
            {{ t('exports.tenant.intro') }}
        </p>

        <div class="actions">
            <CommonButton
                href="/api/tenant/export?format=json"
                icon="material-symbols:data-object"
                type="secondary"
            >{{ t('common.action.downloadJson') }}</CommonButton>

            <CommonButton
                href="/api/tenant/export?format=xlsx"
                icon="material-symbols:table-outline"
                type="secondary"
            >{{ t('common.action.downloadExcel') }}</CommonButton>
        </div>
    </CommonAppShell>
</template>

<script setup lang="ts">
import CommonAppShell from '~/components/common/CommonAppShell.vue';
import CommonButton from '~/components/common/CommonButton.vue';
import { useSession } from '~/composables/session';
import { useT } from '~/composables/i18n';

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
            /*
             * `$t`, not `useT()`: route middleware is not a component setup,
             * inline in `definePageMeta` no less, so it cannot close over this
             * file's own `t` either. `app/plugins/i18n.ts` provides the
             * resolved translator for exactly this, and page middleware runs
             * after every global one, so `i18n.global.ts` has already settled
             * the language.
             */
            const { $t } = useNuxtApp();
            const held = new Set(useSession().value?.permissions ?? []);

            if (!held.has('tenant.export')) {
                return abortNavigation(createError({
                    statusCode: 403,
                    message: $t('exports.tenant.denied'),
                }));
            }
        },
    ],
});

const { t } = useT();

// A getter, so the tab title follows a language change instead of freezing at
// whatever was active when this page first mounted.
useHead(() => ({ title: t('exports.tenant.heading') }));
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
