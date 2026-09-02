<template>
    <section class="tokens">
        <h2>{{ t('my.apiTokens.head') }}</h2>
        <p class="tokens_hint">{{ t('my.apiTokens.hint') }}</p>

        <p
            v-if="loadError"
            class="note note--error"
            role="alert"
        >{{ loadError }}</p>

        <ul
            v-if="tokens.length"
            class="tokens_list"
        >
            <li
                v-for="row in tokens"
                :key="row.id"
                class="tokens_row"
            >
                <div class="tokens_row_main">
                    <span class="tokens_row_name">{{ row.name }}</span>
                    <!--
                        ONE plural message. `permission{{ n === 1 ? '' : 's' }}`
                        split a word across two mustaches, so no part of it was
                        keyable, and German pluralises the stem.
                    -->
                    <span class="tokens_row_perms">
                        {{ t('my.apiTokens.permissionCount', { count: row.permissions.length }) }}
                    </span>
                </div>

                <dl class="tokens_row_facts">
                    <div>
                        <dt>{{ t('common.field.created') }}</dt>
                        <dd>{{ formatWhen(row.createdAt) }}</dd>
                    </div>
                    <div>
                        <dt>{{ t('my.apiTokens.lastUsed') }}</dt>
                        <dd>{{ row.lastUsedAt ? formatWhen(row.lastUsedAt) : t('common.value.never') }}</dd>
                    </div>
                    <div>
                        <dt>{{ t('common.field.expires') }}</dt>
                        <dd>{{ row.expiresAt ? formatWhen(row.expiresAt) : t('common.value.never') }}</dd>
                    </div>
                </dl>

                <CommonButton
                    :disabled="revokingId === row.id"
                    icon="material-symbols:delete-outline"
                    size="S"
                    type="destructive"
                    @click="revoke(row.id)"
                >{{ revokingId === row.id ? t('my.apiTokens.revoking') : t('my.apiTokens.revoke') }}</CommonButton>
            </li>
        </ul>

        <p
            v-else-if="tokensData.status.value === 'success'"
            class="tokens_empty"
        >{{ t('my.apiTokens.emptyHint') }}</p>

        <p
            v-if="revokeError"
            class="note note--error"
            role="alert"
        >{{ revokeError }}</p>

        <!--
            The issued secret, shown once and only here: the server hashes it
            before answering, so there is nothing to come back for.
        -->
        <div
            v-if="issued"
            class="tokens_issued"
            role="status"
        >
            <p class="tokens_issued_head">{{ t('my.apiTokens.issuedHead') }}</p>

            <div class="tokens_issued_value">
                <code>{{ issued }}</code>

                <CommonButton
                    v-if="canCopy"
                    icon="material-symbols:content-copy-outline"
                    type="secondary"
                    @click="copy(issued)"
                >{{ copied ? t('my.apiTokens.copied') : t('my.apiTokens.copy') }}</CommonButton>
            </div>

            <!--
                `<i18n-t>` so the header stays a `<code>` element inside one
                translatable sentence rather than splitting the sentence in two
                around it.
            -->
            <i18n-t
                class="tokens_issued_note"
                keypath="my.apiTokens.issuedNote"
                scope="global"
                tag="p"
            >
                <template #header>
                    <code>{{ t('my.apiTokens.issuedHeader') }}</code>
                </template>
            </i18n-t>
        </div>

        <CommonButton
            v-if="!creating"
            type="secondary"
            @click="startCreate"
        >{{ t('my.apiTokens.startCreate') }}</CommonButton>

        <form
            v-else
            class="tokens_form"
            @submit.prevent="create"
        >
            <label class="tokens_field">
                <span>{{ t('my.apiTokens.nameLabel') }}</span>
                <input
                    v-model="form.name"
                    :placeholder="t('my.apiTokens.namePlaceholder')"
                    type="text"
                >
            </label>

            <label class="tokens_field tokens_field--narrow">
                <span>{{ t('common.field.expires') }}</span>
                <input
                    v-model="form.expiresAt"
                    type="date"
                >
            </label>

            <fieldset class="grants">
                <legend>{{ t('my.apiTokens.grantsLegend') }}</legend>

                <p class="grants_summary">{{ t('my.apiTokens.grantsSummary') }}</p>

                <!--
                    Why one permission you hold is not in the list below. A
                    silently absent checkbox reads as a bug, and this one is
                    absent on purpose: see `UNDELEGATABLE`.
                -->
                <p class="grants_summary">{{ t('my.apiTokens.grantsExcluded') }}</p>

                <!--
                    The global counterpart of the per-category toggle below,
                    over exactly `heldKeys`: "enable all" can only ever mean
                    every permission the caller already holds, since that is
                    all this form offers and all the server would accept.
                -->
                <div class="grants_bulk">
                    <span class="grants_count">{{ selected.size }}/{{ heldKeys.length }}</span>

                    <button
                        :aria-label="t('my.apiTokens.enableAllAria', { count: heldKeys.length })"
                        class="grants_all"
                        :disabled="selected.size === heldKeys.length"
                        type="button"
                        @click="enableAll"
                    >{{ t('my.apiTokens.enableAll') }}</button>

                    <button
                        :aria-label="t('my.apiTokens.disableAllAria', { count: selected.size })"
                        class="grants_all"
                        :disabled="selected.size === 0"
                        type="button"
                        @click="disableAll"
                    >{{ t('my.apiTokens.disableAll') }}</button>
                </div>

                <div class="grants_presets">
                    <h3>{{ t('my.apiTokens.presetsLegend') }}</h3>

                    <p class="grants_summary">{{ t('my.apiTokens.presetsHint') }}</p>

                    <div class="grants_presets_row">
                        <!--
                            `aria-label` carries the effect (which preset, how
                            many of how many), `aria-describedby` the visible
                            hint: the count reads as "21/48" and the hint is
                            a sentence, so neither belongs in the other's slot.
                        -->
                        <button
                            v-for="preset in presets"
                            :key="preset.id"
                            :aria-describedby="`${hintId}-${preset.id}`"
                            :aria-label="t('my.apiTokens.presetApplyAria', {
                                preset: t(preset.labelKey),
                                count: preset.granted.length,
                                total: preset.total,
                            })"
                            class="grants_preset"
                            type="button"
                            @click="applyPreset(preset)"
                        >
                            <span class="grants_preset_head">
                                <span class="grants_preset_label">{{ t(preset.labelKey) }}</span>
                                <span class="grants_count">{{ preset.granted.length }}/{{ preset.total }}</span>
                            </span>

                            <span
                                :id="`${hintId}-${preset.id}`"
                                class="grants_preset_hint"
                            >{{ t(preset.descriptionKey) }}</span>
                        </button>
                    </div>
                </div>

                <!--
                    ALWAYS RENDERED, empty until something happens: a live
                    region added to the DOM at the same moment as its text is
                    not reliably announced. CSS hides it while `:empty`.
                -->
                <p
                    class="grants_notice"
                    role="status"
                >{{ noticeText }}</p>

                <section
                    v-for="category in heldCategories"
                    :key="category.key"
                    class="grants_group"
                >
                    <header class="grants_head">
                        <h3>{{ categoryLabel(category.key) }}</h3>

                        <span class="grants_count">{{ countIn(category) }}/{{ category.permissions.length }}</span>

                        <button
                            class="grants_all"
                            type="button"
                            @click="toggleCategory(category)"
                        >{{ countIn(category) === category.permissions.length
                            ? t('my.apiTokens.clearAll')
                            : t('my.apiTokens.selectAll') }}</button>
                    </header>

                    <label
                        v-for="permission in category.permissions"
                        :key="permission.key"
                        class="grants_row"
                        :class="{ 'grants_row--on': selected.has(permission.key) }"
                    >
                        <input
                            :checked="selected.has(permission.key)"
                            type="checkbox"
                            @change="toggle(permission.key)"
                        >
                        <code class="grants_key">{{ permission.key }}</code>
                        <span class="grants_desc">{{ permission.description }}</span>
                    </label>
                </section>
            </fieldset>

            <p
                v-if="createError"
                class="note note--error"
                role="alert"
            >{{ createError }}</p>

            <div class="tokens_form_actions">
                <CommonButton
                    :disabled="creatingBusy || !form.name.trim() || selected.size === 0"
                    native-type="submit"
                    type="primary"
                >{{ creatingBusy ? t('common.action.creating') : t('common.action.create') }}</CommonButton>

                <CommonButton
                    type="secondary"
                    @click="cancelCreate"
                >{{ t('common.action.cancel') }}</CommonButton>
            </div>
        </form>
    </section>
</template>

<script setup lang="ts">
import type { PermissionCategory, PermissionKey } from '#shared/permissions';
import type { ApiTokenPresetId } from '~/utils/apiTokenPresets';
import type { MessageKey } from '~~/i18n/keys';
import CommonButton from '~/components/common/CommonButton.vue';
import { permissionCategories } from '#shared/permissions';
import { useT } from '~/composables/i18n';
import { useSession } from '~/composables/session';
import { API_TOKEN_PRESETS, resolvePreset } from '~/utils/apiTokenPresets';

interface ApiTokenRow {
    id: string;
    name: string;
    permissions: string[];
    isActive: boolean;
    expiresAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
}

interface IssuedToken {
    token: string;
}

/**
 * Self-service token minting (issue #…: the backend has existed since
 * `/api/me/api-tokens` shipped, with no frontend until now).
 *
 * CLIENT-ONLY LIST FETCH (`server: false`), the same departure
 * `ManageAccountForm`'s candidate picker makes and for the same reason: this is
 * a secondary panel on a page whose own top-level await is its locale form, so
 * awaiting here would make this a second async boundary racing the first.
 */
const { t } = useT();
const request = useRequestFetch();
const session = useSession();

const tokensData = useAsyncData(
    'me:api-tokens',
    () => request<ApiTokenRow[]>('/api/me/api-tokens'),
    { default: () => [] as ApiTokenRow[], server: false },
);

const tokens = computed(() => tokensData.data.value ?? []);
const loadError = computed(() => (tokensData.error.value ? t('my.apiTokens.loadError') : ''));

function formatWhen(iso: string): string {
    return new Date(iso).toLocaleString();
}

/**
 * Keys no token can ever use, so no token is offered them.
 *
 * `api_token.manage_own` gates MANAGING tokens, and all three of its routes
 * refuse a bearer caller on `identity.kind` before any permission is read
 * (CLAUDE.md § "Four principals": a token can never mint or revoke tokens).
 * A holder can therefore check this box and the resulting token is refused
 * anyway: a control that appears to grant something and grants nothing, which
 * is the same lie the presets' own comment refuses to tell. Filtered out here
 * rather than in the catalogue, because the key is perfectly real for the
 * session holding it; it is only meaningless INSIDE a token.
 */
const UNDELEGATABLE: ReadonlySet<string> = new Set<string>(['api_token.manage_own']);

/**
 * Only the permissions the caller currently holds: minting a token cannot
 * exceed them (the server enforces this as a subset check), so offering the
 * rest of the catalogue would just 403 on submit. Same "options come from what
 * the caller can already see" rule the schedule filters follow.
 *
 * Minus `UNDELEGATABLE`, which is why `grantsExcluded` says so in words: a box
 * silently missing from a list of everything you hold is indistinguishable
 * from a bug.
 */
const heldCategories = computed<PermissionCategory[]>(() => {
    const held = new Set(session.value?.permissions ?? []);

    return permissionCategories()
        .map((category) => ({
            key: category.key,
            permissions: category.permissions.filter(
                (permission) => held.has(permission.key) && !UNDELEGATABLE.has(permission.key),
            ),
        }))
        .filter((category) => category.permissions.length > 0);
});

function categoryLabel(key: string): string {
    const words = key.replace(/_/g, ' ');

    return words.charAt(0).toUpperCase() + words.slice(1);
}

function countIn(category: PermissionCategory): number {
    return category.permissions.filter((permission) => selected.value.has(permission.key)).length;
}

const creating = ref(false);
const creatingBusy = ref(false);
const createError = ref('');
const issued = ref('');
const selected = ref<Set<string>>(new Set());
const form = reactive({ name: '', expiresAt: '' });

function startCreate() {
    creating.value = true;
    issued.value = '';
    createError.value = '';
    form.name = '';
    form.expiresAt = '';
    selected.value = new Set();
    notice.value = null;
}

function cancelCreate() {
    creating.value = false;
}

function toggle(key: string) {
    const next = new Set(selected.value);

    if (!next.delete(key)) {
        next.add(key);
    }

    selected.value = next;
    // A notice describes a selection that no longer exists once a box is
    // touched by hand, so it is retired rather than left to read as current.
    notice.value = null;
}

/**
 * The one place a bulk change is written, shared by the per-category toggle,
 * the global one and the presets. `on` rather than a per-key decision: every
 * caller here has already decided which direction it means, and a helper that
 * toggled each key individually would make "enable all" depend on the starting
 * state.
 */
function setSelection(keys: readonly string[], on: boolean) {
    const next = new Set(selected.value);

    for (const key of keys) {
        if (on) {
            next.add(key);
        } else {
            next.delete(key);
        }
    }

    selected.value = next;
}

function toggleCategory(category: PermissionCategory) {
    const keys = category.permissions.map((permission) => permission.key);

    setSelection(keys, countIn(category) !== keys.length);
    notice.value = null;
}

/**
 * Every permission the caller holds, flattened out of `heldCategories` rather
 * than read from the session again: the categories are already filtered to what
 * may be granted, so deriving from them is what makes "enable all" structurally
 * incapable of selecting a key the server would refuse.
 */
const heldKeys = computed<string[]>(() => heldCategories.value
    .flatMap((category) => category.permissions.map((permission) => permission.key)));

const heldSet = computed<ReadonlySet<string>>(() => new Set(heldKeys.value));

interface PresetView {
    id: ApiTokenPresetId;
    labelKey: MessageKey;
    descriptionKey: MessageKey;
    /** What applying it selects: wanted AND held. */
    granted: PermissionKey[];
    /** What it wanted and cannot have. Non-empty means it cannot be satisfied. */
    missing: PermissionKey[];
    /** Everything the preset wants, held or not. */
    total: number;
}

const presets = computed<PresetView[]>(() => API_TOKEN_PRESETS.map((preset) => {
    const { granted, missing } = resolvePreset(preset, heldSet.value);

    return {
        id: preset.id,
        labelKey: preset.labelKey,
        descriptionKey: preset.descriptionKey,
        granted,
        missing,
        total: granted.length + missing.length,
    };
}));

/**
 * What the last bulk action did, as DATA rather than a resolved sentence: a
 * string stored here would freeze the language it was built in
 * (i18n/CONVENTIONS.md), and the three preset outcomes have to stay three
 * distinct states rather than one message with a count in it.
 */
type GrantsNotice =
    | { kind: 'all'; count: number }
    | { kind: 'cleared' }
    | { kind: 'presetFull'; label: MessageKey; count: number }
    | { kind: 'presetPartial'; label: MessageKey; count: number; total: number; missing: string[] }
    | { kind: 'presetEmpty'; label: MessageKey; total: number };

const notice = ref<GrantsNotice | null>(null);

/** How many missing keys are named before the list is elided. */
const MISSING_NAMED = 6;

/**
 * One sentence per state, in a function rather than inline in the `computed`
 * so the switch can be exhaustive: `vue/return-in-computed-property` cannot see
 * that a discriminated switch covers every case, while typecheck can, and the
 * exhaustiveness is what makes a new notice kind a compile error instead of an
 * empty live region.
 */
function noticeSentence(state: GrantsNotice): string {
    switch (state.kind) {
        case 'all':
            return t('my.apiTokens.noticeAllSelected', { count: state.count });
        case 'cleared':
            return t('my.apiTokens.noticeCleared');
        case 'presetFull':
            return t('my.apiTokens.noticePresetFull', {
                preset: t(state.label),
                count: state.count,
            });
        case 'presetPartial': {
            // Truncated with an ellipsis rather than a word: the keys are
            // identifiers, so this is punctuation between finished items and
            // the true number is in the message's own count.
            const named = state.missing.slice(0, MISSING_NAMED).join(', ');
            const keys = state.missing.length > MISSING_NAMED ? `${ named }…` : named;

            // Two complete sentences, joined by a space. Neither carries the
            // other's grammar, so the join is punctuation.
            return `${ t('my.apiTokens.noticePresetPartial', {
                preset: t(state.label),
                count: state.count,
                total: state.total,
            }) } ${ t('my.apiTokens.noticePresetMissing', { count: state.missing.length, keys }) }`;
        }
        case 'presetEmpty':
            return t('my.apiTokens.noticePresetEmpty', {
                preset: t(state.label),
                count: state.total,
            });
    }
}

const noticeText = computed<string>(() => (notice.value ? noticeSentence(notice.value) : ''));

function enableAll() {
    setSelection(heldKeys.value, true);
    notice.value = { kind: 'all', count: heldKeys.value.length };
}

function disableAll() {
    setSelection(heldKeys.value, false);
    notice.value = { kind: 'cleared' };
}

/**
 * REPLACES the selection rather than adding to it: a preset names a whole kind
 * of token, so applying two in a row must not accumulate into a third thing
 * nobody chose.
 *
 * THREE OUTCOMES, NEVER MERGED. A preset the caller cannot fully satisfy still
 * selects what it can, but says so, and one that matches nothing it holds says
 * that instead of leaving a button that looks like it did nothing. Silently
 * under-granting would mint a token that fails later at a call site nobody
 * connects back to this screen, which is the guard CLAUDE.md asks for: "found
 * nothing" and "matched nothing" must not render identically.
 */
function applyPreset(preset: PresetView) {
    selected.value = new Set(preset.granted);

    if (preset.granted.length === 0) {
        notice.value = { kind: 'presetEmpty', label: preset.labelKey, total: preset.total };

        return;
    }

    if (preset.missing.length === 0) {
        notice.value = { kind: 'presetFull', label: preset.labelKey, count: preset.granted.length };

        return;
    }

    notice.value = {
        kind: 'presetPartial',
        label: preset.labelKey,
        count: preset.granted.length,
        total: preset.total,
        missing: preset.missing,
    };
}

/** One base per instance, so the preset hints' ids cannot collide. */
const hintId = useId();

/**
 * The server's sentence, or a generic one. Same extraction the account form uses.
 *
 * `statusMessage` stays ENGLISH by decision (issue #19 deferred it); only the
 * app-authored fallback is keyed.
 */
function messageOf(error: unknown): string {
    return serverErrorMessage(error) ?? t('my.apiTokens.genericError');
}

async function create() {
    if (creatingBusy.value) {
        return;
    }

    creatingBusy.value = true;
    createError.value = '';

    try {
        const body: { name: string; permissions: string[]; expiresAt?: string } = {
            name: form.name.trim(),
            permissions: [...selected.value],
        };

        // Absent, not null, when left blank: the server treats both as
        // "does not expire", and this is the codebase's convention for a
        // form-fed optional field.
        if (form.expiresAt) {
            body.expiresAt = new Date(`${form.expiresAt}T23:59:59`).toISOString();
        }

        const created = await request<IssuedToken>('/api/me/api-tokens', { method: 'POST', body });

        issued.value = created.token;
        creating.value = false;
        await tokensData.refresh();
    } catch (error) {
        createError.value = messageOf(error);
    } finally {
        creatingBusy.value = false;
    }
}

const revokingId = ref('');
const revokeError = ref('');

async function revoke(id: string) {
    revokingId.value = id;
    revokeError.value = '';

    try {
        await request(`/api/me/api-tokens/${id}`, { method: 'DELETE' });
        await tokensData.refresh();
    } catch (error) {
        revokeError.value = messageOf(error);
    } finally {
        revokingId.value = '';
    }
}

const canCopy = computed(() => import.meta.client && Boolean(navigator.clipboard));
const copied = ref(false);

async function copy(value: string) {
    try {
        await navigator.clipboard.writeText(value);
        copied.value = true;
        setTimeout(() => { copied.value = false; }, 2000);
    } catch {
        // Clipboard access can be refused outright. The value is on screen and
        // selectable either way, so this needs no error of its own.
    }
}
</script>

<style scoped lang="scss">
.tokens {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);

    h2 {
        font-size: var(--font-size-lg);
        color: $content2;
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

    &_empty {
        margin: 0;
        font-size: var(--font-size-sm);
        color: $content7;
    }

    &_list {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);

        margin: 0;
        padding: 0;

        list-style: none;
    }

    &_row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-5);
        align-items: center;

        padding: var(--space-5);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        &_main {
            display: flex;
            flex-direction: column;
            gap: var(--space-1);
            min-width: 16ch;
        }

        &_name {
            font-size: var(--font-size-md);
            font-weight: 600;
            color: $content3;
        }

        &_perms {
            font-size: var(--font-size-xs);
            color: $content7;
        }

        &_facts {
            display: flex;
            gap: var(--space-6);
            margin: 0 0 0 auto;

            dt {
                font-size: var(--font-size-xs);
                color: $content7;
            }

            dd {
                margin: 0;
                font-size: var(--font-size-sm);
                color: $content4;
            }
        }
    }

    &_issued {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);

        padding: var(--space-5);
        border: 1px solid $primary500;
        border-radius: var(--radius-lg);

        &_head {
            margin: 0;
            font-size: var(--font-size-sm);
            font-weight: 650;
            color: $content3;
        }

        &_value {
            display: flex;
            gap: var(--space-4);
            align-items: center;

            code {
                overflow-x: auto;

                padding: var(--space-2) var(--space-4);
                border-radius: var(--radius-md);

                font-size: var(--font-size-md);

                background: $surface3;
            }
        }

        &_note {
            margin: 0;
            font-size: var(--font-size-sm);
            color: $content7;

            code {
                font-family: monospace;
            }
        }
    }

    &_form {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);

        padding: var(--space-6);
        border: 1px solid $surface4;
        border-radius: var(--radius-xl);

        &_actions {
            display: flex;
            gap: var(--space-4);
        }
    }

    &_field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        max-width: 40ch;

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

        &--narrow {
            max-width: 20ch;
        }
    }
}

.note {
    max-width: 68ch;
    margin: 0;
    font-size: var(--font-size-sm);
    color: $content7;

    &--error {
        color: $error700;
    }
}

.grants {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    margin: 0;
    padding: var(--space-6);
    border: 1px solid $surface4;
    border-radius: var(--radius-xl);

    legend {
        padding: 0 var(--space-2);
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content4;
    }

    &_summary {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;
    }

    &_group {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        padding-top: var(--space-3);
        border-top: 1px solid $surface3;
    }

    &_head {
        display: flex;
        gap: var(--space-3);
        align-items: baseline;

        h3 {
            margin: 0;
            font-size: var(--font-size-sm);
            font-weight: 680;
            color: $content3;
        }
    }

    &_count {
        font-size: var(--font-size-xs);
        font-variant-numeric: tabular-nums;
        color: $content7;
    }

    &_all {
        cursor: pointer;

        margin-left: auto;
        padding: var(--space-1) var(--space-3);
        border: 1px solid $surface4;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-xs);
        color: $content4;

        background: $surface0;

        &:hover {
            border-color: $primary500;
            color: $primary700;
        }

        &:disabled {
            cursor: default;
            opacity: 0.5;
        }
    }

    &_bulk {
        display: flex;
        gap: var(--space-3);
        align-items: baseline;

        .grants_all:first-of-type {
            margin-left: auto;
        }

        .grants_all + .grants_all {
            margin-left: 0;
        }
    }

    &_presets {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        padding-top: var(--space-3);
        border-top: 1px solid $surface3;

        h3 {
            margin: 0;
            font-size: var(--font-size-sm);
            font-weight: 680;
            color: $content3;
        }

        &_row {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-3);
        }
    }

    &_preset {
        cursor: pointer;

        display: flex;
        flex: 1 1 22ch;
        flex-direction: column;
        gap: var(--space-1);

        max-width: 34ch;
        padding: var(--space-3) var(--space-4);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        text-align: left;

        background: $surface0;

        &:hover {
            border-color: $primary500;
        }

        &_head {
            display: flex;
            gap: var(--space-3);
            align-items: baseline;
            justify-content: space-between;
        }

        &_label {
            font-size: var(--font-size-sm);
            font-weight: 650;
            color: $content3;
        }

        &_hint {
            font-size: var(--font-size-xs);
            line-height: 1.4;
            color: $content7;
        }
    }

    &_notice {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content4;

        &:empty {
            display: none;
        }
    }

    &_row {
        cursor: pointer;

        display: flex;
        gap: var(--space-3);
        align-items: baseline;

        margin: 0;
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-md);

        &--on {
            background: $surface2;
        }
    }

    &_key {
        flex: 0 0 auto;
        min-width: 190px;
        font-size: var(--font-size-xs);
        color: $content3;
    }

    &_desc {
        font-size: var(--font-size-sm);
        color: $content7;
    }
}
</style>
