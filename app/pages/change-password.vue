<template>
    <CommonBox>
        <h1 class="cp_title">{{ t('auth.changePassword.heading') }}</h1>

        <form
            class="cp_form"
            @submit.prevent="submit"
        >
            <p class="cp_lead">
                {{ forced
                    ? t('auth.changePassword.leadForced')
                    : t('auth.changePassword.lead') }}
            </p>

            <CommonInputText
                v-model="email"
                :placeholder="t('auth.changePassword.emailPlaceholder')"
                input-type="email"
                :disabled="busy"
                :input-attrs="{ autocomplete: 'username', required: true }"
            />

            <CommonInputText
                v-model="currentPassword"
                :placeholder="t('auth.changePassword.currentPlaceholder')"
                input-type="password"
                :disabled="busy"
                :input-attrs="{ autocomplete: 'current-password', required: true }"
            />

            <CommonInputText
                v-model="newPassword"
                :placeholder="t('auth.changePassword.newPlaceholder')"
                input-type="password"
                :disabled="busy"
                :input-attrs="{ autocomplete: 'new-password', required: true, minlength: 12 }"
            />

            <p class="cp_hint">{{ t('auth.changePassword.hint') }}</p>

            <p
                v-if="error"
                class="cp_error"
                role="alert"
            >{{ error }}</p>

            <CommonButton
                native-type="submit"
                type="primary"
                width="100%"
                :disabled="busy"
            >{{ busy ? t('common.action.saving') : t('auth.changePassword.submit') }}</CommonButton>

            <CommonButton
                type="link"
                :disabled="busy"
                @click="navigateTo('/login')"
            >{{ t('auth.changePassword.backToSignIn') }}</CommonButton>
        </form>
    </CommonBox>
</template>

<script setup lang="ts">
import { LOGIN_ERROR_KEY } from '~/composables/session';
import { useT } from '~/composables/i18n';

definePageMeta({ layout: 'empty' });

const { t } = useT();

useHead(() => ({ title: t('auth.changePassword.pageTitle') }));

const route = useRoute();

const email = ref(typeof route.query.email === 'string' ? route.query.email : '');
const currentPassword = ref('');
const newPassword = ref('');
const error = ref('');
const busy = ref(false);

/** Arrived here because a reset forced it, rather than by choice. */
const forced = computed(() => route.query.forced === '1');

async function submit() {
    if (busy.value) {
        return;
    }

    error.value = '';
    busy.value = true;

    try {
        await $fetch('/api/auth/change-password', {
            method: 'POST',
            body: {
                email: email.value,
                currentPassword: currentPassword.value,
                newPassword: newPassword.value,
            },
        });

        // No auto-login: the change endpoint issues no session, so the user
        // signs in normally with the password they just chose.
        await navigateTo('/login?changed=1');
    } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;

        // 422 is the only case worth naming: it is about the new password, not
        // about whether the account exists.
        error.value = status === 422
            ? (serverErrorMessage(e) ?? t('auth.error.passwordRejected'))
            : t(LOGIN_ERROR_KEY);
        currentPassword.value = '';
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped lang="scss">
.cp {
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

    /* `$content7`, not `$surface7`. The ramps are named by ROLE: surfaces are
       what things sit ON, content is what sits on them, so a surface token used
       as text is reading off the wrong ramp entirely, and at ~2:1 against the
       page it was the least legible text on a security screen. */
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
