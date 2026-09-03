<template>
    <StaffPanel :title="t('staff.createTenant.heading')">
        <template #lead>
            <i18n-t
                class="create_lead"
                keypath="staff.createTenant.cliNote"
                tag="p"
                scope="global"
            >
                <template #cli>
                    <code>provision:tenant</code>
                </template>
            </i18n-t>
        </template>

        <form
            class="create_form"
            @submit.prevent="createTenant"
        >
            <div class="create_grid">
                <CommonInputText
                    v-model="form.slug"
                    :placeholder="t('common.field.slug')"
                    :disabled="creating"
                    :input-attrs="{ required: true, autocomplete: 'off' }"
                >{{ t('common.field.slug') }}</CommonInputText>

                <CommonInputText
                    v-model="form.name"
                    :placeholder="t('staff.createTenant.namePlaceholder')"
                    :disabled="creating"
                    :input-attrs="{ required: true }"
                >{{ t('common.field.name') }}</CommonInputText>

                <CommonInputText
                    v-model="form.adminEmail"
                    :placeholder="t('staff.createTenant.adminEmail')"
                    input-type="email"
                    :disabled="creating"
                    :input-attrs="{ required: true }"
                >{{ t('staff.createTenant.adminEmail') }}</CommonInputText>

                <CommonInputText
                    v-model="form.adminName"
                    :placeholder="t('staff.createTenant.adminName')"
                    :disabled="creating"
                    :input-attrs="{ required: true }"
                >{{ t('staff.createTenant.adminName') }}</CommonInputText>

                <CommonInputText
                    v-model="form.federationSlug"
                    :placeholder="t('staff.createTenant.optionalPlaceholder')"
                    :disabled="creating"
                >{{ t('staff.createTenant.federationSlug') }}</CommonInputText>

                <!--
                    `placeholder="UTC"` stays a literal: it is an IANA zone
                    name, an example of the value this field takes, not copy
                    this repo authored about it.
                -->
                <CommonInputText
                    v-model="form.timezone"
                    placeholder="UTC"
                    :disabled="creating"
                >{{ t('common.field.timezone') }}</CommonInputText>
            </div>

            <p
                v-if="error"
                class="create_note create_note--error"
                role="alert"
            >{{ error }}</p>

            <!--
                The initial password is shown ONCE, here, and nowhere else. It
                is set apart so an operator copying it does not lose it among
                the other notes.
            -->
            <p
                v-if="info"
                class="create_note create_note--success"
                role="status"
            >{{ info }}</p>

            <div>
                <CommonButton
                    native-type="submit"
                    type="primary"
                    :disabled="creating"
                >{{ creating ? t('common.action.creating') : t('staff.createTenant.submit') }}</CommonButton>
            </div>
        </form>
    </StaffPanel>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import CommonInputText from '~/components/common/CommonInputText.vue';
import StaffPanel from '~/components/staff/StaffPanel.vue';
import { useT } from '~/composables/i18n';

/** Tenant creation (issue #76), moved out of the page unchanged. */
const emit = defineEmits<{ created: [] }>();

const { t } = useT();

const form = reactive({
    slug: '',
    name: '',
    adminEmail: '',
    adminName: '',
    federationSlug: '',
    timezone: '',
});

const creating = ref(false);
const error = ref('');
const info = ref('');

interface CreateTenantResult {
    tenant: { id: string; slug: string; name: string };
    person: { id: string; email: string };
    account: { id: string; reusedAccount: boolean };
    initialPassword: string | null;
}

async function createTenant() {
    if (creating.value) {
        return;
    }

    error.value = '';
    info.value = '';
    creating.value = true;

    try {
        const result = await $fetch<CreateTenantResult>('/api/staff/tenants', {
            method: 'POST',
            body: {
                slug: form.slug,
                name: form.name,
                adminEmail: form.adminEmail,
                adminName: form.adminName,
                federationSlug: form.federationSlug || undefined,
                timezone: form.timezone || undefined,
            },
        });

        info.value = result.initialPassword
            ? t('staff.createTenant.createdWithPassword', {
                slug: result.tenant.slug,
                password: result.initialPassword,
            })
            : t('staff.createTenant.createdReusedAccount', {
                slug: result.tenant.slug,
                email: result.person.email,
            });

        form.slug = '';
        form.name = '';
        form.adminEmail = '';
        form.adminName = '';
        form.federationSlug = '';
        form.timezone = '';

        emit('created');
    } catch (caught) {
        const statusCode = (caught as { statusCode?: number })?.statusCode;
        const stated = serverErrorMessage(caught);

        error.value = statusCode === 409
            ? (stated ?? t('staff.createTenant.conflict', { slug: form.slug }))
            : (stated ?? t('staff.createTenant.error'));
    } finally {
        creating.value = false;
    }
}
</script>

<style scoped lang="scss">
.create {
    &_lead {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: var(--leading-prose);
        color: $content7;

        code { font-size: var(--font-size-xs); }
    }

    &_form {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }

    &_grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: var(--space-4);
    }

    &_note {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: var(--leading-prose);

        &--error { color: $error700; }

        &--success {
            padding: var(--space-4) var(--space-5);
            border: 1px solid varToRgba('success500', 0.4);
            border-radius: var(--radius-lg);

            color: $content2;
            overflow-wrap: anywhere;

            background: varToRgba('success500', 0.1);
        }
    }
}
</style>
