<template>
    <CommonBox>
        <h1 class="staff_login_title">Calendry staff</h1>

        <form
            class="staff_login_form"
            @submit.prevent="submit"
        >
            <p class="staff_login_lead">
                Internal sign-in. This is a separate credential from a tenant
                account.
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

            <!--
                Rendered only past CAPTCHA_ATTEMPT_THRESHOLD failed attempts
                (issue #106, mirroring issue #79's login.vue) — see
                renderTurnstile(). Cloudflare's script fills this element with
                its own iframe; it is never used for anything else, so there
                is nothing to keep in sync besides the element existing when
                the widget wants to mount into it.
            -->
            <div
                v-if="showCaptcha"
                ref="turnstileContainer"
                class="staff_login_captcha"
            />

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
import { CAPTCHA_ATTEMPT_THRESHOLD } from '#shared/turnstile';

/**
 * Cloudflare's widget script attaches itself to `window.turnstile`. Declared
 * narrowly rather than reached for through `any` (CLAUDE.md: no `any`) —
 * `render`/`reset` are the only two calls this page makes. Mirrors
 * `app/pages/login.vue`'s own declaration exactly.
 */
interface TurnstileApi {
    render: (
        container: HTMLElement,
        options: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void },
    ) => string;
    reset: (widgetId: string) => void;
}

declare global {
    interface Window {
        turnstile?: TurnstileApi;
    }
}

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

/**
 * Calendry-staff sign-in — issue #76. Deliberately separate from
 * `app/pages/login.vue`: this authenticates a `StaffAccount` against
 * `POST /api/staff-auth/login`, which sets its own cookie
 * (`STAFF_SESSION_COOKIE`) and has nothing to do with the tenant `useSession`
 * composable. No tenant-selection step exists here — a staff principal is
 * never IN a tenant, see `StaffIdentity` in `server/utils/tenantResolver.ts`.
 *
 * CAPTCHA widget behavior (issue #106) mirrors `login.vue`'s exactly: reusing
 * the same `TURNSTILE_SITE_KEY` runtime config and the same
 * `CAPTCHA_ATTEMPT_THRESHOLD` constant so client and server never disagree
 * about when the widget is required.
 */
definePageMeta({ layout: 'empty' });
useHead({ title: 'Staff sign in' });

const route = useRoute();

const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

/*
 * CAPTCHA (issue #106) — a local counter, not server state, same reasoning as
 * login.vue: the server is the real gate (it counts by email across
 * devices/tabs); this counter only decides when to render the widget so a
 * legitimate staffer is not shown it on their very first attempt. Never reset
 * except by navigating away.
 */
const failedAttempts = ref(0);
const showCaptcha = computed(() => failedAttempts.value >= CAPTCHA_ATTEMPT_THRESHOLD);
const turnstileToken = ref('');
const turnstileContainer = ref<HTMLDivElement | null>(null);
let turnstileWidgetId: string | null = null;
let turnstileScriptPromise: Promise<void> | null = null;

/** Loads Cloudflare's widget script at most once per page load. */
function loadTurnstileScript(): Promise<void> {
    if (window.turnstile) {
        return Promise.resolve();
    }

    turnstileScriptPromise ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = TURNSTILE_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Turnstile.'));
        document.head.appendChild(script);
    });

    return turnstileScriptPromise;
}

/**
 * Renders the widget into `turnstileContainer` the first time it becomes
 * visible. Guarded by `turnstileWidgetId` so a later re-render of this
 * `v-if` block does not leak a second Cloudflare iframe into the same element.
 */
async function renderTurnstile() {
    if (turnstileWidgetId || !turnstileContainer.value) {
        return;
    }

    try {
        await loadTurnstileScript();
    } catch {
        // No widget, no token — the next submit will 400 with "CAPTCHA
        // verification required.", which is an honest description of what
        // happened (Cloudflare's script did not load) rather than a fake
        // "sign in" attempt.
        return;
    }

    turnstileWidgetId = window.turnstile?.render(turnstileContainer.value, {
        sitekey: useRuntimeConfig().public.turnstileSiteKey,
        callback: (token) => { turnstileToken.value = token; },
        'expired-callback': () => { turnstileToken.value = ''; },
    }) ?? null;
}

watch(showCaptcha, (shown) => {
    if (shown) {
        // Wait for the `v-if="showCaptcha"` div to actually exist in the DOM
        // before asking Cloudflare to mount into it.
        nextTick(() => { void renderTurnstile(); });
    }
});

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
        const result = await $fetch<{ requiresPasswordChange?: boolean }>('/api/staff-auth/login', {
            method: 'POST',
            body: {
                email: email.value,
                password: password.value,
                // Absent below the threshold — the server treats a missing
                // token as "not required yet" and only checks it once its own
                // count (per email, not this tab's local counter) agrees.
                ...(turnstileToken.value ? { turnstileToken: turnstileToken.value } : {}),
            },
        });

        // Credentials were correct, but the password is forced-reset or
        // expired (issue #106): no session was issued, so navigating to
        // STAFF_ROUTE would only bounce right back here. There is no staff
        // change-password page yet — this names the situation rather than
        // silently pretending the sign-in succeeded.
        if (result.requiresPasswordChange) {
            error.value = 'This password must be changed before signing in. Contact an administrator.';

            return;
        }

        await navigateTo(destination());
    } catch {
        // ONE message for wrong password, unknown staff account, and a
        // deactivated one — the API returns an identical 401 for all three so
        // this page does not become a staff-account-existence oracle.
        error.value = 'Invalid credentials.';
        password.value = '';
        failedAttempts.value += 1;

        // A used or expired token must not be resubmitted silently — reset
        // the widget so the next submit carries a fresh one, matching
        // Turnstile's own single-use-token contract.
        turnstileToken.value = '';

        if (turnstileWidgetId) {
            window.turnstile?.reset(turnstileWidgetId);
        }
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

    // Cloudflare sizes its own iframe (300x65 in the default widget mode);
    // this only reserves the slot so the form does not jump when it mounts.
    &_captcha {
        min-height: 65px;
    }
}
</style>
