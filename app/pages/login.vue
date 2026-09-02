<template>
    <CommonBox>
        <h1 class="login_title">Calendry</h1>

        <!-- STEP 1: credentials -->
        <form
            v-if="step === 'credentials'"
            class="login_form"
            @submit.prevent="submitCredentials"
        >
            <p
                v-if="justChanged"
                class="login_changed"
                role="status"
            >Password changed. Sign in with your new password.</p>
            <p
                v-else
                class="login_lead"
            >Sign in to continue.</p>

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
                class="login_error"
                role="alert"
            >{{ error }}</p>

            <!--
                Rendered only past CAPTCHA_ATTEMPT_THRESHOLD failed attempts
                (issue #79); see renderTurnstile(). Cloudflare's script fills
                this element with its own iframe; it is never used for
                anything else, so there is nothing to keep in sync besides the
                element existing when the widget wants to mount into it.
            -->
            <div
                v-if="showCaptcha"
                ref="turnstileContainer"
                class="login_captcha"
            />

            <!--
                native-type="submit" makes this a real submit button inside the
                <form>, so Enter in either field works and the @submit.prevent
                handler is the single entry point. No @click here: that would
                fire the handler twice. CommonButton defaults to type="button",
                so this opt-in is what keeps Enter-to-submit working.
            -->
            <CommonButton
                native-type="submit"
                type="primary"
                width="100%"
                :disabled="busy"
            >{{ busy ? 'Signing in…' : 'Sign in' }}</CommonButton>

            <p class="login_note">
                Accounts are created by an administrator. There is no self-service sign-up.
            </p>

            <p class="login_note">
                New to Calendry? <NuxtLink
                    class="login_link"
                    :to="LANDING_ROUTE"
                >What it is, and what it does not do yet</NuxtLink>.
            </p>
        </form>

        <!-- STEP 2: tenant selection, only when the account has several identities -->
        <div
            v-else
            class="login_form"
        >
            <p class="login_lead">
                Your account belongs to more than one institution. Choose one to continue.
            </p>

            <CommonButton
                v-for="tenant in availableTenants"
                :key="tenant.tenantId"
                type="secondary"
                width="100%"
                :disabled="busy"
                @click="chooseTenant(tenant.tenantId)"
            >
                <span class="login_tenant-name">{{ tenant.name }}</span>
                <span class="login_tenant-slug">{{ tenant.slug }}</span>
            </CommonButton>

            <p
                v-if="error"
                class="login_error"
                role="alert"
            >{{ error }}</p>

            <CommonButton
                type="link"
                :disabled="busy"
                @click="cancelSelection"
            >Use a different account</CommonButton>
        </div>
    </CommonBox>
</template>

<script setup lang="ts">
import { LOGIN_ERROR, type SessionTenant, fetchSession, useSession } from '~/composables/session';
import { useStore } from '~/store';
import { LANDING_ROUTE, isInternalPath, resolveHomeRoute } from '~/utils/routes';
import { CAPTCHA_ATTEMPT_THRESHOLD } from '#shared/turnstile';

/**
 * Cloudflare's widget script attaches itself to `window.turnstile`. Declared
 * narrowly rather than reached for through `any` (CLAUDE.md: no `any`);
 * `render`/`reset` are the only two calls this page makes.
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
 * Two-step sign-in.
 *
 *   credentials → (one identity)  → redirect
 *   credentials → (many identities) → tenant selection → redirect
 *
 * The tenant step is never skipped silently: the API returns
 * tenantSelectionRequired and the session has no active Person until a choice
 * is made, so an ambiguous account genuinely cannot proceed by accident.
 */
definePageMeta({ layout: 'empty' });
useHead({ title: 'Sign in' });

const route = useRoute();
const session = useSession();
const store = useStore();

const step = ref<'credentials' | 'tenant'>('credentials');
const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);
const availableTenants = ref<SessionTenant[]>([]);
const justChanged = computed(() => route.query.changed === '1');

/*
 * CAPTCHA (issue #79): a local counter, not server state. The server is the
 * real gate (it counts by email across devices/tabs); this counter only
 * decides when to render the widget so a legitimate user is not shown it on
 * their very first attempt. Never reset except by navigating away: a widget
 * that vanished after a correct guess would be pointless, but a widget that
 * vanished after ANOTHER wrong guess would let an attacker dodge it by
 * alternating device/tab, so it stays up for the rest of this page load once
 * shown.
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
 * `v-if` block (there is none today, but the guard is what makes that safe to
 * add) does not leak a second Cloudflare iframe into the same element.
 */
async function renderTurnstile() {
    if (turnstileWidgetId || !turnstileContainer.value) {
        return;
    }

    try {
        await loadTurnstileScript();
    } catch {
        // No widget, no token: the next submit will 400 with "CAPTCHA
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

// Arriving with ?select=1 means an already-signed-in user came back to change
// institution. Skip straight to the selection step using the identities the
// session already knows about, so no re-authentication is required.
if (route.query.select === '1' && session.value?.availableTenants.length) {
    availableTenants.value = session.value.availableTenants;
    step.value = 'tenant';
}

function destination(): string {
    const redirect = route.query.redirect;

    if (typeof redirect === 'string' && isInternalPath(redirect)) {
        return redirect;
    }

    // #73: an ordinary sign-in with no `?redirect=` returns a visitor to where
    // they left off rather than always HOME_ROUTE, which is empty on a session's first
    // sign-in, since nothing has been visited yet. Issue #107: the fallback
    // itself is no longer the bare constant: `resolveHomeRoute()` sends a
    // caller who lacks `dashboard.view` to `/schedule` instead. `finish()`
    // calls `fetchSession(true)` before this runs, so `session.value` already
    // carries this sign-in's permissions.
    return store.lastVisitedPage || resolveHomeRoute(session.value?.permissions ?? []);
}

async function submitCredentials() {
    if (busy.value) {
        return;
    }

    error.value = '';
    busy.value = true;

    try {
        const result = await $fetch<{
            requiresPasswordChange?: boolean;
            tenantSelectionRequired: boolean;
            availableTenants: SessionTenant[];
        }>('/api/auth/login', {
            method: 'POST',
            body: {
                email: email.value,
                password: password.value,
                // Absent below the threshold: the server treats a missing
                // token as "not required yet" and only checks it once its own
                // count (per email, not this tab's local counter) agrees.
                ...(turnstileToken.value ? { turnstileToken: turnstileToken.value } : {}),
            },
        });

        // Credentials were correct, but an operator forced a reset: no session
        // was issued, so the only way forward is changing the password.
        if (result.requiresPasswordChange) {
            await navigateTo(`/change-password?forced=1&email=${encodeURIComponent(email.value)}`);

            return;
        }

        if (result.tenantSelectionRequired) {
            availableTenants.value = result.availableTenants;
            step.value = 'tenant';

            return;
        }

        await finish();
    } catch {
        // ONE message for every failure mode: wrong password, unknown account,
        // and an account with no active Person all land here. The API already
        // returns identical 401s for the first two; distinguishing them in the
        // UI would reintroduce the account-existence oracle that the server
        // deliberately avoids.
        error.value = LOGIN_ERROR;
        password.value = '';
        failedAttempts.value += 1;

        // A used or expired token must not be resubmitted silently, so reset
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

async function chooseTenant(tenantId: string) {
    if (busy.value) {
        return;
    }

    error.value = '';
    busy.value = true;

    try {
        await $fetch('/api/auth/select-tenant', { method: 'POST', body: { tenantId } });
        await finish();
    } catch {
        error.value = 'That institution is not available for this account.';
    } finally {
        busy.value = false;
    }
}

async function cancelSelection() {
    await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);

    session.value = null;
    availableTenants.value = [];
    password.value = '';
    step.value = 'credentials';
}

/** Refresh shared state before navigating so the guard sees the new session. */
async function finish() {
    await fetchSession(true);
    await navigateTo(destination());
}
</script>

<style scoped lang="scss">
.login {
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
    }

    &_error {
        margin: 0;
        color: $error400;
    }

    &_changed {
        margin: 0 0 4px;
        font-size: var(--font-size-md);
        line-height: var(--leading-prose);
        color: $success300;
    }

    &_note {
        margin: 8px 0 0;
        font-size: var(--font-size-sm);
        color: $content7;
    }

    &_tenant {
        &-name {
            display: block;
        }

        &-slug {
            display: block;
            margin-top: 2px;
            font-size: var(--font-size-xs);
            color: $content7;
        }
    }

    // Cloudflare sizes its own iframe (300x65 in the default widget mode);
    // this only reserves the slot so the form does not jump when it mounts.
    &_captcha {
        min-height: 65px;
    }

    &_link {
        color: $primary600;
        text-decoration: underline;
    }
}
</style>
