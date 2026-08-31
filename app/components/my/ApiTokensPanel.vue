<template>
    <section class="tokens">
        <h2>API tokens</h2>
        <p class="tokens_hint">
            A bearer credential for scripts and integrations, restricted to whichever
            permissions you pick below and never more than you hold — losing an access role
            narrows every token minted from it immediately. The secret is shown once, right
            after creation, and cannot be recovered afterwards; revoking a token takes effect
            straight away.
        </p>

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
                    <span class="tokens_row_perms">
                        {{ row.permissions.length }} permission{{ row.permissions.length === 1 ? '' : 's' }}
                    </span>
                </div>

                <dl class="tokens_row_facts">
                    <div>
                        <dt>Created</dt>
                        <dd>{{ formatWhen(row.createdAt) }}</dd>
                    </div>
                    <div>
                        <dt>Last used</dt>
                        <dd>{{ row.lastUsedAt ? formatWhen(row.lastUsedAt) : 'Never' }}</dd>
                    </div>
                    <div>
                        <dt>Expires</dt>
                        <dd>{{ row.expiresAt ? formatWhen(row.expiresAt) : 'Never' }}</dd>
                    </div>
                </dl>

                <CommonButton
                    :disabled="revokingId === row.id"
                    icon="material-symbols:delete-outline"
                    size="S"
                    type="destructive"
                    @click="revoke(row.id)"
                >{{ revokingId === row.id ? 'Revoking…' : 'Revoke' }}</CommonButton>
            </li>
        </ul>

        <p
            v-else-if="tokensData.status.value === 'success'"
            class="tokens_empty"
        >No API tokens yet.</p>

        <p
            v-if="revokeError"
            class="note note--error"
            role="alert"
        >{{ revokeError }}</p>

        <!--
            The issued secret, shown once and only here — the server hashes it
            before answering, so there is nothing to come back for.
        -->
        <div
            v-if="issued"
            class="tokens_issued"
            role="status"
        >
            <p class="tokens_issued_head">Token created.</p>

            <div class="tokens_issued_value">
                <code>{{ issued }}</code>

                <CommonButton
                    v-if="canCopy"
                    icon="material-symbols:content-copy-outline"
                    type="secondary"
                    @click="copy(issued)"
                >{{ copied ? 'Copied' : 'Copy' }}</CommonButton>
            </div>

            <p class="tokens_issued_note">
                Shown once. Use it as <code>Authorization: Bearer &lt;token&gt;</code> — if it's
                lost, revoke this token and mint a new one.
            </p>
        </div>

        <CommonButton
            v-if="!creating"
            type="secondary"
            @click="startCreate"
        >Create a token</CommonButton>

        <form
            v-else
            class="tokens_form"
            @submit.prevent="create"
        >
            <label class="tokens_field">
                <span>Name</span>
                <input
                    v-model="form.name"
                    placeholder="e.g. Import script"
                    type="text"
                >
            </label>

            <label class="tokens_field tokens_field--narrow">
                <span>Expires</span>
                <input
                    v-model="form.expiresAt"
                    type="date"
                >
            </label>

            <fieldset class="grants">
                <legend>Permissions</legend>

                <p class="grants_summary">
                    A token cannot hold more than you do — only permissions you currently hold
                    are offered.
                </p>

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
                        >{{ countIn(category) === category.permissions.length ? 'Clear' : 'All' }}</button>
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
                >{{ creatingBusy ? 'Creating…' : 'Create' }}</CommonButton>

                <CommonButton
                    type="secondary"
                    @click="cancelCreate"
                >Cancel</CommonButton>
            </div>
        </form>
    </section>
</template>

<script setup lang="ts">
import type { PermissionCategory } from '#shared/permissions';
import CommonButton from '~/components/common/CommonButton.vue';
import { permissionCategories } from '#shared/permissions';
import { useSession } from '~/composables/session';

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
 * Self-service token minting (issue #… — the backend has existed since
 * `/api/me/api-tokens` shipped, with no frontend until now).
 *
 * CLIENT-ONLY LIST FETCH (`server: false`), the same departure
 * `ManageAccountForm`'s candidate picker makes and for the same reason: this is
 * a secondary panel on a page whose own top-level await is its locale form, so
 * awaiting here would make this a second async boundary racing the first.
 */
const request = useRequestFetch();
const session = useSession();

const tokensData = useAsyncData(
    'me:api-tokens',
    () => request<ApiTokenRow[]>('/api/me/api-tokens'),
    { default: () => [] as ApiTokenRow[], server: false },
);

const tokens = computed(() => tokensData.data.value ?? []);
const loadError = computed(() => (tokensData.error.value ? 'Could not load your API tokens.' : ''));

function formatWhen(iso: string): string {
    return new Date(iso).toLocaleString();
}

/**
 * Only the permissions the caller currently holds — minting a token cannot
 * exceed them (the server enforces this as a subset check), so offering the
 * rest of the catalogue would just 403 on submit. Same "options come from what
 * the caller can already see" rule the schedule filters follow.
 */
const heldCategories = computed<PermissionCategory[]>(() => {
    const held = new Set(session.value?.permissions ?? []);

    return permissionCategories()
        .map((category) => ({
            key: category.key,
            permissions: category.permissions.filter((permission) => held.has(permission.key)),
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
}

function toggleCategory(category: PermissionCategory) {
    const next = new Set(selected.value);
    const complete = category.permissions.every((permission) => next.has(permission.key));

    for (const permission of category.permissions) {
        if (complete) {
            next.delete(permission.key);
        } else {
            next.add(permission.key);
        }
    }

    selected.value = next;
}

/** The server's sentence, or a generic one. Same extraction the account form uses. */
function messageOf(error: unknown): string {
    const e = error as { statusMessage?: string; data?: { statusMessage?: string } };

    return e.data?.statusMessage ?? e.statusMessage ?? 'Could not complete that.';
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

        // Absent, not null, when left blank — the server treats both as
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
