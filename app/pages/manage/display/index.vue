<template>
    <ManageShell
        description="How this institution's schedule is drawn — the standards every session falls back to."
        title="Display"
    >
        <p class="intro">
            Colour is never the only cue on the schedule: a violation carries an icon and
            a label, and a locked session carries a lock, whatever you set here. These are
            the defaults sessions fall back to, not a replacement for those signals.
        </p>

        <p
            v-if="loadError"
            class="note note--error"
            role="alert"
        >{{ loadError }}</p>

        <p
            v-else-if="!canEdit"
            class="note"
        >
            You can see these settings but not change them. Changing them needs the
            permission that also lets you edit session kinds.
        </p>

        <form
            class="panel"
            @submit.prevent="save"
        >
            <section class="panel_group">
                <h2>Online sessions</h2>
                <p class="panel_hint">
                    Online delivery is a <strong>virtual room</strong>, not a flag on the
                    session — so this decides how that fact is drawn, never whether it is
                    true. A session is treated as online when every room it uses is virtual.
                </p>

                <label class="panel_check">
                    <input
                        v-model="form.highlightOnline"
                        type="checkbox"
                        :disabled="!canEdit"
                    >
                    <span>Mark online sessions on the schedule</span>
                </label>

                <ManageColorField
                    v-model="form.onlineColor"
                    :disabled="!canEdit || !form.highlightOnline"
                    help="Left empty, online sessions use a neutral outline instead of a colour."
                    label="Online colour"
                />
            </section>

            <section class="panel_group">
                <h2>Where a session's colour comes from</h2>
                <p class="panel_hint">
                    Checked sources are tried in order, most specific first. Unchecking
                    every source makes the fallback below the only colour on the schedule.
                </p>

                <!--
                    An ordered list rendered as a reorderable set, because the ORDER is
                    the setting. A pair of checkboxes would store the same two values and
                    lose the one thing that decides which wins.
                -->
                <ol class="panel_order">
                    <li
                        v-for="(source, index) in orderedSources"
                        :key="source.key"
                        class="panel_source"
                        :class="{ 'panel_source--off': !source.enabled }"
                    >
                        <label class="panel_check">
                            <input
                                :checked="source.enabled"
                                type="checkbox"
                                :disabled="!canEdit"
                                @change="toggleSource(source.key)"
                            >
                            <span>{{ SOURCE_LABEL[source.key] }}</span>
                        </label>

                        <span class="panel_source-rank">{{ source.enabled ? `${index + 1}` : '—' }}</span>

                        <button
                            v-if="canEdit && source.enabled && index > 0"
                            class="panel_move"
                            type="button"
                            :aria-label="`Move ${SOURCE_LABEL[source.key]} above ${SOURCE_LABEL[orderedSources[index - 1]!.key]}`"
                            @click="promote(source.key)"
                        >
                            <Icon
                                name="material-symbols:arrow-upward"
                                aria-hidden="true"
                            />
                        </button>
                    </li>
                </ol>

                <ManageColorField
                    v-model="form.defaultColor"
                    :disabled="!canEdit"
                    help="Used when no source above supplies a colour. Left empty, chips use the neutral surface."
                    label="Fallback colour"
                />
            </section>

            <section class="panel_group">
                <h2>Dates and numbers</h2>
                <p class="panel_hint">
                    A BCP-47 tag (e.g. <code>de-DE</code>, <code>en-GB</code>) this institution's
                    dates and numbers default to. A person's own setting under
                    <NuxtLink to="/my/account">My account</NuxtLink> overrides this; leaving it empty
                    defers straight to whatever language the visitor's browser requests. This never
                    changes what any label or button SAYS — that stays English until
                    <a href="https://github.com/Calendry-de/Calendry/issues/19" target="_blank" rel="noopener">i18n</a>
                    ships.
                </p>

                <label class="panel_locale">
                    <span>Default locale</span>
                    <input
                        v-model="localeInput"
                        :disabled="!canEdit"
                        placeholder="e.g. de-DE — leave empty for none"
                        type="text"
                    >
                </label>

                <p
                    v-if="localeError"
                    class="note note--error"
                    role="alert"
                >{{ localeError }}</p>
            </section>

            <!--
                A live preview, because every control on this page is about how
                something LOOKS and nothing else on the page shows it. Reading a
                hex value and imagining a chip is the part people get wrong.
            -->
            <section class="panel_group">
                <h2>Preview</h2>
                <div class="preview">
                    <div
                        v-for="sample in samples"
                        :key="sample.label"
                        class="preview_chip"
                        :class="{ 'preview_chip--online': sample.online }"
                        :style="{
                            '--kind-color': sample.color ?? 'transparent',
                            ...(sample.online && form.onlineColor
                                ? { '--online-color': form.onlineColor }
                                : {}),
                        }"
                    >
                        <span class="preview_title">{{ sample.title }}</span>
                        <span class="preview_meta">
                            <span
                                class="preview_dot"
                                aria-hidden="true"
                            />
                            {{ sample.label }}
                        </span>
                    </div>
                </div>
            </section>

            <div
                v-if="canEdit"
                class="panel_actions"
            >
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
    </ManageShell>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import ManageShell from '~/components/manage/ManageShell.vue';
import ManageColorField from '~/components/manage/ManageColorField.vue';
import { COLOR_SOURCES, DISPLAY_DEFAULTS } from '#shared/sessionColor';
import type { ColorSource, DisplaySettings } from '#shared/sessionColor';
import { isUsableLocale } from '#shared/locale';
import { useHasPermission, useSession } from '~/composables/session';

/**
 * The tenant's display standards — a SINGLETON, not a list.
 *
 * Bespoke rather than another row on the generic manage scaffold, and the
 * reason is the shape: the scaffold renders a list of records with a detail
 * pane, and there is exactly one of these per tenant, forever. A list of one is
 * a worse version of a form. The ordering control and the live preview are the
 * other half — neither is a field type the registry has, and inventing them
 * there would put two one-off components into a system that serves fourteen
 * entities (CLAUDE.md's "bespoke means one slot" rule, applied one level up).
 */
definePageMeta({
    /*
     * Gated INLINE rather than through the `manage` middleware: that one resolves
     * `to.params.entity` against the entity registry and 404s anything it does
     * not recognise, and this page is not a registry entity — it has no list, no
     * row form and no `/api/display` resource behind it. Routed through it, the
     * page 404s on a static path with no `entity` param at all.
     *
     * `tenant.read` to LOOK, which is what the nav gates on too; the form renders
     * read-only without `tenant.update`. Same split as the availability pages,
     * and for the same reason: seeing a setting is not the same permission as
     * changing it for everyone.
     *
     * BOTH KEYS MOVED TOGETHER, from `session.read`/`session_kind.update`. Under
     * the old pair this page sat in the navigation of everybody who could look at
     * a timetable — an institution's settings offered to every lecturer — and a
     * role holding `session_kind.update` could save changes to a page it was
     * never shown. `GET /api/display-settings` still answers `session.read`,
     * because the schedule needs the colours to draw; the endpoint being wider
     * than this gate is deliberate and documented there.
     */
    middleware: [
        () => {
            const held = new Set(useSession().value?.permissions ?? []);

            if (!held.has('tenant.read')) {
                return abortNavigation(createError({
                    statusCode: 403,
                    statusMessage: 'Viewing this institution\'s display settings needs tenant.read.',
                }));
            }
        },
    ],
});

useHead({ title: 'Display' });

const SOURCE_LABEL: Record<ColorSource, string> = {
    offering: 'The offering’s own colour',
    kind: 'The session kind’s colour',
};

const canEdit = useHasPermission('tenant.update');
const request = useRequestFetch();

const settings = useAsyncData(
    'display-settings',
    () => request<DisplaySettings & { defaultLocale: string | null; configured: boolean }>('/api/display-settings'),
);

await settings;

const loadError = computed(() => (settings.error.value
    ? 'Could not load the display settings. Nothing has been changed.'
    : ''));

/** The form is seeded from the awaited response, never from a watcher — a
    watcher-seeded ref is `undefined` at first render server-side. */
const form = reactive({
    highlightOnline: settings.data.value?.highlightOnline ?? DISPLAY_DEFAULTS.highlightOnline,
    onlineColor: settings.data.value?.onlineColor ?? null,
    colorSourceOrder: [...(settings.data.value?.colorSourceOrder ?? DISPLAY_DEFAULTS.colorSourceOrder)],
    defaultColor: settings.data.value?.defaultColor ?? null,
    defaultLocale: settings.data.value?.defaultLocale ?? null as string | null,
});

// A separate text ref rather than binding `form.defaultLocale` directly:
// an in-progress keystroke ("d", "de", "de-") is invalid `Intl` input and
// must not flip `dirty`/fail validation on every character — only the
// commit into `form.defaultLocale` (on save) is validated.
const localeInput = ref(form.defaultLocale ?? '');
const localeError = ref('');

const initial = JSON.stringify(form);
const dirty = computed(() => JSON.stringify(form) !== initial || localeInput.value !== (form.defaultLocale ?? ''));

/**
 * Enabled sources first, in their stated order, then the disabled ones. Both
 * are rendered so turning one back on is one click rather than a hunt for where
 * it went.
 */
const orderedSources = computed(() => {
    const enabled = form.colorSourceOrder
        .filter((key): key is ColorSource => COLOR_SOURCES.includes(key as ColorSource))
        .map((key) => ({ key, enabled: true }));

    const disabled = COLOR_SOURCES
        .filter((key) => !form.colorSourceOrder.includes(key))
        .map((key) => ({ key, enabled: false }));

    return [...enabled, ...disabled];
});

function toggleSource(key: ColorSource) {
    form.colorSourceOrder = form.colorSourceOrder.includes(key)
        ? form.colorSourceOrder.filter((entry) => entry !== key)
        : [...form.colorSourceOrder, key];
}

function promote(key: ColorSource) {
    const at = form.colorSourceOrder.indexOf(key);

    if (at < 1) {
        return;
    }

    const next = [...form.colorSourceOrder];

    [next[at - 1], next[at]] = [next[at]!, next[at - 1]!];
    form.colorSourceOrder = next;
}

/** Three chips that exercise every branch of the resolution the page configures. */
const samples = computed(() => {
    const first = form.colorSourceOrder[0];

    return [
        {
            title: 'INF201 · Databases',
            label: first === 'offering' ? 'offering colour' : 'kind colour',
            color: first ? '#3389C6' : form.defaultColor,
            online: false,
        },
        {
            title: 'MAT100 · Analysis',
            label: 'no colour set — fallback',
            color: form.defaultColor,
            online: false,
        },
        {
            title: 'SEM04 · Remote seminar',
            label: form.highlightOnline ? 'online' : 'online, not marked',
            color: form.highlightOnline ? (form.onlineColor ?? null) : null,
            online: form.highlightOnline,
        },
    ];
});

const saving = ref(false);
const saved = ref(false);
const saveError = ref('');

async function save() {
    saving.value = true;
    saved.value = false;
    saveError.value = '';
    localeError.value = '';

    const trimmedLocale = localeInput.value.trim();

    if (trimmedLocale && !isUsableLocale(trimmedLocale)) {
        localeError.value = 'Not a recognised locale — try a tag like "de-DE" or "en-GB".';
        saving.value = false;

        return;
    }

    form.defaultLocale = trimmedLocale || null;

    try {
        await request('/api/display-settings', { method: 'PUT', body: { ...form } });
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
    margin-bottom: var(--space-7);
    font-size: var(--font-size-md);
    color: $content6;
}

.note {
    max-width: 68ch;
    margin-bottom: var(--space-6);
    font-size: var(--font-size-sm);
    color: $content6;

    &--error { color: $error700; }
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
        font-size: var(--font-size-sm);
        color: $content6;
    }

    &_check {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        min-height: 44px;

        font-size: var(--font-size-md);
        color: $content2;

        input {
            width: 18px;
            height: 18px;
            accent-color: $primary600;
        }
    }

    &_order {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        list-style: none;
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

    &_source {
        display: flex;
        gap: var(--space-5);
        align-items: center;

        padding: var(--space-2) var(--space-5);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        background: $surface1;

        &--off {
            color: $content6;
            background: none;
        }
    }

    &_source-rank {
        min-width: 2ch;

        font-size: var(--font-size-sm);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: $content6;
        text-align: center;
    }

    &_move {
        cursor: pointer;

        display: flex;
        align-items: center;
        justify-content: center;

        min-width: 44px;
        min-height: 44px;
        margin-left: auto;
        border: 0;
        border-radius: var(--radius-sm);

        color: $content6;

        background: none;

        svg {
            width: 16px;
            height: 16px;
        }

        @include hover() {
            &:hover {
                color: $primary700;
                background: varToRgba('primary500', 0.12);
            }
        }
    }

    &_actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-5);
        align-items: center;
    }

    &_saved {
        font-size: var(--font-size-sm);
        color: $success700;
    }
}

.preview {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);

    padding: var(--space-5);
    border-radius: var(--radius-lg);

    background: $surface0;

    &_chip {
        display: flex;
        flex: 1 1 16ch;
        flex-direction: column;
        gap: var(--space-1);

        padding: var(--space-4);
        border: 1px solid $surface5;
        border-radius: var(--radius-sm);

        background: $surface3;

        // The online treatment: a dashed edge, so it survives greyscale and
        // does not depend on the colour being set at all.
        &--online {
            border-color: var(--kind-color, #{$content6});
            border-style: dashed;
        }
    }

    &_title {
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content1;
    }

    &_meta {
        display: flex;
        gap: var(--space-3);
        align-items: center;

        font-size: var(--font-size-xs);
        color: $content6;
    }

    &_dot {
        width: 8px;
        height: 8px;
        border: 1px solid $surface5;
        border-radius: 50%;

        background: var(--kind-color, transparent);
    }
}
</style>
