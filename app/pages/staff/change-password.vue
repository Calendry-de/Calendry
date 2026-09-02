<template>
    <CommonBox>
        <h1 class="staff_cp_title">{{ t('staff.brand.heading') }}</h1>

        <form
            class="staff_cp_form"
            @submit.prevent="submit"
        >
            <p class="staff_cp_lead">
                {{ forced ? t('staff.changePassword.forcedLead') : t('staff.changePassword.lead') }}
            </p>

            <CommonInputText
                v-model="email"
                :placeholder="t('staff.changePassword.emailPlaceholder')"
                input-type="email"
                :disabled="busy"
                :input-attrs="{ autocomplete: 'username', required: true }"
            />

            <CommonInputText
                v-model="currentPassword"
                :placeholder="t('staff.changePassword.currentPasswordPlaceholder')"
                input-type="password"
                :disabled="busy"
                :input-attrs="{ autocomplete: 'current-password', required: true }"
            />

            <CommonInputText
                v-model="newPassword"
                :placeholder="t('staff.changePassword.newPasswordPlaceholder')"
                input-type="password"
                :disabled="busy"
                :input-attrs="{ autocomplete: 'new-password', required: true, minlength: 12 }"
            />

            <p class="staff_cp_hint">{{ t('staff.changePassword.hint') }}</p>

            <p
                v-if="error"
                class="staff_cp_error"
                role="alert"
            >{{ error }}</p>

            <CommonButton
                native-type="submit"
                type="primary"
                width="100%"
                :disabled="busy"
            >{{ busy ? t('common.action.saving') : t('staff.changePassword.submit') }}</CommonButton>

            <CommonButton
                type="link"
                :disabled="busy"
                @click="navigateTo(STAFF_LOGIN_ROUTE)"
            >{{ t('staff.changePassword.backToSignIn') }}</CommonButton>
        </form>
    </CommonBox>
</template>

<script setup lang="ts">
import CommonBox from '~/components/common/CommonBox.vue';
import CommonButton from '~/components/common/CommonButton.vue';
import CommonInputText from '~/components/common/CommonInputText.vue';
import { STAFF_LOGIN_ROUTE } from '~/utils/routes';
import { useT } from '~/composables/i18n';

/**
 * Clears a StaffAccount's forced or expired password: issue #106's missing
 * other half. `staff/login.vue` authenticates correctly against
 * `POST /api/staff-auth/login` but, on `requiresPasswordChange`, had nowhere
 * to send the staffer: no session is issued for a forced/expired password,
 * so there was no way to actually clear the flag short of an administrator
 * doing it by hand. Mirrors `app/pages/change-password.vue` exactly, one
 * plane over: same shape, `/api/staff-auth/change-password` instead of
 * `/api/auth/change-password`, and back to `STAFF_LOGIN_ROUTE` rather than
 * the tenant `/login`. Deliberately its own page rather than a shared one:
 * the staff plane has no `useSession`/tenant state to reuse, same reasoning
 * `staff/login.vue` already states for staying separate from `login.vue`.
 */
definePageMeta({ layout: 'empty' });

const { t } = useT();

// A getter, so the tab title follows a language change instead of freezing at
// whatever was active when this page first mounted.
useHead(() => ({ title: t('staff.changePassword.pageTitle') }));

const route = useRoute();

const email = ref(typeof route.query.email === 'string' ? route.query.email : '');
const currentPassword = ref('');
const newPassword = ref('');
const error = ref('');
const busy = ref(false);

/** Arrived here because a forced reset or password expiry required it. */
const forced = computed(() => route.query.forced === '1');

async function submit() {
    if (busy.value) {
        return;
    }

    error.value = '';
    busy.value = true;

    try {
        await $fetch('/api/staff-auth/change-password', {
            method: 'POST',
            body: {
                email: email.value,
                currentPassword: currentPassword.value,
                newPassword: newPassword.value,
            },
        });

        // No auto-login: the change endpoint issues no session, so the
        // staffer signs in normally with the password they just chose.
        await navigateTo(`${STAFF_LOGIN_ROUTE}?changed=1`);
    } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;

        // 422 is the only case worth naming: it is about the new password,
        // not about whether the account exists. Everything else (401: wrong
        // current password, unknown or deactivated account) reads as one
        // generic message, matching staff login's own existence-oracle care.
        error.value = status === 422
            ? (serverErrorMessage(e) ?? t('staff.changePassword.invalidPassword'))
            : t('staff.changePassword.error');
        currentPassword.value = '';
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped lang="scss">
.staff_cp {
    &_title {
        margin: 0;
        font-size: var(--font-size-2xl);
        font-weight: bold;
    }

    &_form {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 300px;
    }

    &_lead {
        margin: 0 0 4px;
        font-size: var(--font-size-md);
        line-height: var(--leading-prose);
        color: $content6;
    }

    &_hint {
        margin: -4px 0 0;
        font-size: var(--font-size-xs);
        color: $content7;
    }

    &_error {
        margin: 0;
        font-size: var(--font-size-md);
        color: $error400;
    }
}
</style>
