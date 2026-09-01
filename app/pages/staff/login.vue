<template>
    <CommonBox>
        <h1 class="staff_login_title">Calendry staff</h1>

        <form
            class="staff_login_form"
            @submit.prevent="submit"
        >
            <p class="staff_login_lead">
                Internal sign-in. This is a separate credential from a tenant
                account — see issue #76.
            </p>

            <CommonInputText
                v-model="email"
                placeholder="Email"
                input-type="email"
                :disabled="busy"
                :input-attrs="{ autocomplete: 'username', required: true, autofocus: true }"
            />

            <CommonInputText
                v-model="password"
                placeholder="Password"
                input-type="password"
                :disabled="busy"
                :input-attrs="{ autocomplete: 'current-password', required: true }"
            />

            <p
                v-if="error"
                class="staff_login_error"
                role="alert"
            >{{ error }}</p>

            <CommonButton
                native-type="submit"
                type="primary"
                width="100%"
                :disabled="busy"
            >{{ busy ? 'Signing in…' : 'Sign in' }}</CommonButton>
        </form>
    </CommonBox>
</template>

<script setup lang="ts">
import CommonBox from '~/components/common/CommonBox.vue';
import CommonButton from '~/components/common/CommonButton.vue';
import CommonInputText from '~/components/common/CommonInputText.vue';
import { STAFF_ROUTE, isInternalPath } from '~/utils/routes';

/**
 * Calendry-staff sign-in — issue #76. Deliberately separate from
 * `app/pages/login.vue`: this authenticates a `StaffAccount` against
 * `POST /api/staff-auth/login`, which sets its own cookie
 * (`STAFF_SESSION_COOKIE`) and has nothing to do with the tenant `useSession`
 * composable. No tenant-selection step exists here — a staff principal is
 * never IN a tenant, see `StaffIdentity` in `server/utils/tenantResolver.ts`.
 */
definePageMeta({ layout: 'empty' });
useHead({ title: 'Staff sign in' });

const route = useRoute();

const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

function destination(): string {
    const redirect = route.query.redirect;

    return typeof redirect === 'string' && isInternalPath(redirect) ? redirect : STAFF_ROUTE;
}

async function submit() {
    if (busy.value) {
        return;
    }

    error.value = '';
    busy.value = true;

    try {
        await $fetch('/api/staff-auth/login', {
            method: 'POST',
            body: { email: email.value, password: password.value },
        });

        await navigateTo(destination());
    } catch {
        // ONE message for wrong password, unknown staff account, and a
        // deactivated one — the API returns an identical 401 for all three so
        // this page does not become a staff-account-existence oracle.
        error.value = 'Invalid credentials.';
        password.value = '';
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped lang="scss">
.staff_login {
    &_title {
        margin: 0;
        font-size: var(--font-size-2xl);
        font-weight: bold;
    }

    &_form {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 280px;
    }

    &_lead {
        margin: 0 0 4px;
        color: $content6;
        font-size: var(--font-size-sm);
    }

    &_error {
        margin: 0;
        color: $error400;
    }
}
</style>
