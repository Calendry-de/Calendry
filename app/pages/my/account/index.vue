<template>
    <CommonPage title="My account">
        <p class="intro">Your own display preferences. Nothing here is visible to anyone else.</p>

        <p
            v-if="loadError"
            class="note note--error"
            role="alert"
        >{{ loadError }}</p>

        <form
            class="panel"
            @submit.prevent="save"
        >
            <section class="panel_group">
                <h2>Dates and numbers</h2>
                <p class="panel_hint">
                    A BCP-47 tag (e.g. <code>de-DE</code>, <code>en-GB</code>) your own dates and
                    numbers are shown in. Overrides the institution's default, which in turn
                    overrides your browser's own language setting. Leave empty to use whichever of
                    those applies.
                </p>

                <label class="panel_locale">
                    <span>Your locale</span>
                    <input
                        v-model="localeInput"
                        placeholder="e.g. de-DE — leave empty to inherit"
                        type="text"
                    >
                </label>

                <p
                    v-if="localeError"
                    class="note note--error"
                    role="alert"
                >{{ localeError }}</p>
            </section>

            <div class="panel_actions">
                <CommonButton
                    :disabled="saving || !dirty"
                    native-type="submit"
                    type="primary"
                >{{ saving ? 'Saving…' : 'Save' }}</CommonButton>

                <p
                    v-if="saved"
                    class="panel_saved"
                    role="status"
                >Saved.</p>
                <p
                    v-if="saveError"
                    class="note note--error"
                    role="alert"
                >{{ saveError }}</p>
            </div>
        </form>
    </CommonPage>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import CommonPage from '~/components/common/CommonPage.vue';
import { isUsableLocale } from '#shared/locale';

/**
 * A signed-in Person's own display preferences (issue #17) — today, just
 * `locale`. No permission gate beyond being signed in (the global auth
 * middleware already requires that for every non-anonymous route): this is
 * self-service over the caller's own row, nobody else's.
 */
useHead({ title: 'My account' });

const request = useRequestFetch();

const settings = useAsyncData('me:settings', () => request<{ locale: string | null }>('/api/me/settings'));

await settings;

const loadError = computed(() => (settings.error.value
    ? 'Could not load your account settings. Nothing has been changed.'
    : ''));

const storedLocale = computed(() => settings.data.value?.locale ?? null);
const localeInput = ref(storedLocale.value ?? '');
const localeError = ref('');

const dirty = computed(() => localeInput.value !== (storedLocale.value ?? ''));

const saving = ref(false);
const saved = ref(false);
const saveError = ref('');

async function save() {
    saving.value = true;
    saved.value = false;
    saveError.value = '';
    localeError.value = '';

    const trimmed = localeInput.value.trim();

    if (trimmed && !isUsableLocale(trimmed)) {
        localeError.value = 'Not a recognised locale — try a tag like "de-DE" or "en-GB".';
        saving.value = false;

        return;
    }

    try {
        await request('/api/me/settings', { method: 'PUT', body: { locale: trimmed || null } });
        await settings.refresh();
        saved.value = true;
    }
    catch (error) {
        saveError.value = (error as { statusMessage?: string }).statusMessage
            ?? 'Could not save. Nothing has been changed.';
    }
    finally {
        saving.value = false;
    }
}
</script>

<style scoped lang="scss">
.intro {
    max-width: 68ch;
    margin: 0 0 var(--space-7);
    font-size: var(--font-size-sm);
    color: $content7;
}

.note {
    max-width: 68ch;
    margin-bottom: var(--space-6);
    font-size: var(--font-size-sm);
    color: $content7;

    &--error {
        color: $error700;
    }

    code {
        font-family: monospace;
    }
}

.panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    max-width: 62ch;

    &_group {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);

        h2 {
            font-size: var(--font-size-lg);
            color: $content2;
        }
    }

    &_hint {
        max-width: 68ch;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;

        code {
            font-family: monospace;
        }
    }

    &_locale {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        max-width: 24ch;

        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content4;

        input {
            padding: var(--space-3) var(--space-5);
            border: 1px solid $surface4;
            border-radius: var(--radius-lg);

            font-family: inherit;
            font-size: var(--font-size-md);
            font-weight: 400;
            color: $content4;

            background: $surface0;
        }
    }

    &_actions {
        display: flex;
        gap: var(--space-4);
        align-items: center;
    }

    &_saved {
        margin: 0;
        font-size: var(--font-size-sm);
        color: $success700;
    }
}
</style>
