<template>
    <CommonPage :title="t('my.account.pageTitle')">
        <p class="intro">{{ t('my.account.intro') }}</p>

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
                <h2>{{ t('my.account.localeHead') }}</h2>
                <!--
                    `<i18n-t>` so the two example tags stay `<code>` elements
                    inside ONE translatable sentence. Split into "A BCP-47 tag
                    (e.g. ", a tag, ", ", a tag and the rest, the sentence would
                    exist only in English word order.

                    THE ONE SENTENCE IN THIS SLICE THAT WAS NOT EXTRACTED
                    VERBATIM, and deliberately: it said this field affects
                    "dates and numbers", which stopped being true when issue
                    #19's `resolveLanguage()` began deriving the MESSAGE
                    LANGUAGE from the same value (`shared/language.ts`). Typing
                    `fr-FR` now flips the whole UI from German to English, so
                    the old wording was a false statement about a control, not
                    merely copy somebody could improve. It names both axes now.
                    The error text below is unchanged: it never claimed the app
                    is translated into whatever tag you type.
                -->
                <i18n-t
                    class="panel_hint"
                    keypath="my.account.localeHint"
                    scope="global"
                    tag="p"
                >
                    <template #germanTag>
                        <code>de-DE</code>
                    </template>
                    <template #britishTag>
                        <code>en-GB</code>
                    </template>
                </i18n-t>

                <label class="panel_field">
                    <span>{{ t('my.account.localeLabel') }}</span>
                    <input
                        v-model="localeInput"
                        :placeholder="t('my.account.localePlaceholder')"
                        type="text"
                    >
                </label>

                <p
                    v-if="localeError"
                    class="note note--error"
                    role="alert"
                >{{ localeError }}</p>
            </section>

            <section class="panel_group">
                <h2>{{ t('my.account.timezoneHead') }}</h2>
                <i18n-t
                    class="panel_hint"
                    keypath="my.account.timezoneHint"
                    scope="global"
                    tag="p"
                >
                    <template #berlin>
                        <code>Europe/Berlin</code>
                    </template>
                    <template #newYork>
                        <code>America/New_York</code>
                    </template>
                </i18n-t>

                <label class="panel_field">
                    <span>{{ t('my.account.timezoneLabel') }}</span>
                    <input
                        v-model="timezoneInput"
                        :placeholder="t('my.account.timezonePlaceholder')"
                        type="text"
                    >
                </label>

                <p
                    v-if="timezoneError"
                    class="note note--error"
                    role="alert"
                >{{ timezoneError }}</p>
            </section>

            <div class="panel_actions">
                <CommonButton
                    :disabled="saving || !dirty"
                    native-type="submit"
                    type="primary"
                >{{ saving ? t('common.action.saving') : t('common.action.save') }}</CommonButton>

                <p
                    v-if="saved"
                    class="panel_saved"
                    role="status"
                >{{ t('my.account.saved') }}</p>
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
import { isUsableTimeZone } from '#shared/timezone';
import { useT } from '~/composables/i18n';

/**
 * A signed-in Person's own display preferences (issue #17's `locale`,
 * `timezone` added alongside it). No permission gate beyond being signed in
 * (the global auth middleware already requires that for every non-anonymous
 * route): this is self-service over the caller's own row, nobody else's.
 */
const { t } = useT();

useHead(() => ({ title: t('my.account.pageTitle') }));

const request = useRequestFetch();

interface MeSettings { locale: string | null; timezone: string | null }

const settings = useAsyncData('me:settings', () => request<MeSettings>('/api/me/settings'));

await settings;

const loadError = computed(() => (settings.error.value
    ? t('my.account.loadError')
    : ''));

const storedLocale = computed(() => settings.data.value?.locale ?? null);
const localeInput = ref(storedLocale.value ?? '');
const localeError = ref('');

const storedTimezone = computed(() => settings.data.value?.timezone ?? null);
const timezoneInput = ref(storedTimezone.value ?? '');
const timezoneError = ref('');

const dirty = computed(() => localeInput.value !== (storedLocale.value ?? '')
    || timezoneInput.value !== (storedTimezone.value ?? ''));

const saving = ref(false);
const saved = ref(false);
const saveError = ref('');

async function save() {
    saving.value = true;
    saved.value = false;
    saveError.value = '';
    localeError.value = '';
    timezoneError.value = '';

    const trimmedLocale = localeInput.value.trim();
    const trimmedTimezone = timezoneInput.value.trim();

    if (trimmedLocale && !isUsableLocale(trimmedLocale)) {
        localeError.value = t('my.account.localeError');
        saving.value = false;

        return;
    }

    if (trimmedTimezone && !isUsableTimeZone(trimmedTimezone)) {
        timezoneError.value = t('my.account.timezoneError');
        saving.value = false;

        return;
    }

    try {
        await request('/api/me/settings', {
            method: 'PUT',
            body: { locale: trimmedLocale || null, timezone: trimmedTimezone || null },
        });
        await settings.refresh();
        saved.value = true;
    }
    catch (error) {
        saveError.value = serverErrorMessage(error)
            ?? t('my.account.saveError');
    }
    finally {
        saving.value = false;
    }
}
</script>

<style scoped lang="scss">
.intro {
    max-width: 68ch;
    margin: 0;

    font-size: var(--font-size-md);
    line-height: var(--leading-prose);
    color: $content6;
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

        /* `margin: 0`: the browser's 0.83em on an `h2` doubled the group's own
           gap, so the two sections floated apart from their fields. */
        h2 {
            margin: 0;
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

    &_field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        /* Wide enough for its own placeholder ("e.g. de-DE, leave empty to
           inherit"), which 24ch clipped mid-word. */
        max-width: 40ch;

        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content4;

        input {
            width: 100%;
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
