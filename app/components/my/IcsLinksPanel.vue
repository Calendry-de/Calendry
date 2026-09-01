<template>
    <section class="links">
        <h2>Calendar links</h2>
        <p class="links_hint">
            A link an external calendar app (Google Calendar, Outlook, Apple Calendar…)
            re-fetches on its own schedule — never downloaded once and forgotten. Unlike
            an API token this address stays visible here so you can re-copy it any time;
            deleting a link stops it immediately.
        </p>

        <p
            v-if="loadError"
            class="note note--error"
            role="alert"
        >{{ loadError }}</p>

        <ul
            v-if="links.length"
            class="links_list"
        >
            <li
                v-for="row in links"
                :key="row.id"
                class="links_row"
            >
                <div class="links_row_main">
                    <span class="links_row_name">{{ row.name }}</span>
                    <span class="links_row_scope">{{ scopeLabel(row) }}</span>
                    <span class="links_row_scope">{{ subjectLabel(row) }}</span>
                </div>

                <div class="links_row_url">
                    <code>{{ row.url }}</code>

                    <CommonButton
                        v-if="canCopy"
                        icon="material-symbols:content-copy-outline"
                        size="S"
                        type="secondary"
                        @click="copy(row.id, row.url)"
                    >{{ copiedId === row.id ? 'Copied' : 'Copy' }}</CommonButton>
                </div>

                <CommonButton
                    :disabled="deletingId === row.id"
                    icon="material-symbols:delete-outline"
                    size="S"
                    type="destructive"
                    @click="remove(row.id)"
                >{{ deletingId === row.id ? 'Deleting…' : 'Delete' }}</CommonButton>
            </li>
        </ul>

        <p
            v-else-if="linksData.status.value === 'success'"
            class="links_empty"
        >No calendar links yet.</p>

        <p
            v-if="deleteError"
            class="note note--error"
            role="alert"
        >{{ deleteError }}</p>

        <CommonButton
            v-if="!creating"
            type="secondary"
            @click="startCreate"
        >Create a calendar link</CommonButton>

        <form
            v-else
            class="links_form"
            @submit.prevent="create"
        >
            <label class="links_field">
                <span>Name</span>
                <input
                    v-model="form.name"
                    placeholder="e.g. Phone"
                    type="text"
                >
            </label>

            <fieldset
                v-if="canTargetGroups"
                class="links_scope"
            >
                <legend>Whose schedule</legend>

                <label class="links_scope-option">
                    <input
                        v-model="form.subject"
                        type="radio"
                        value="OWN"
                    >
                    <span>My own schedule</span>
                </label>

                <label class="links_scope-option">
                    <input
                        v-model="form.subject"
                        type="radio"
                        value="GROUPS"
                    >
                    <span>Specific group(s)</span>
                </label>

                <label
                    v-if="form.subject === 'GROUPS'"
                    class="links_field links_field--indent"
                >
                    <span>Groups</span>
                    <select
                        v-model="form.groupIds"
                        multiple
                        size="5"
                    >
                        <option
                            v-for="group in groups"
                            :key="group.id"
                            :selected="form.groupIds.includes(group.id)"
                            :value="group.id"
                        >{{ group.name }}</option>
                    </select>
                </label>
            </fieldset>

            <fieldset class="links_scope">
                <legend>What it streams</legend>

                <label class="links_scope-option">
                    <input
                        v-model="form.scope"
                        type="radio"
                        value="ALL"
                    >
                    <span>Every term, rolling window</span>
                </label>

                <label
                    v-if="form.scope === 'ALL'"
                    class="links_field links_field--narrow links_field--indent"
                >
                    <span>Weeks ahead</span>
                    <input
                        v-model.number="form.weeksAhead"
                        max="52"
                        min="1"
                        type="number"
                    >
                </label>

                <label class="links_scope-option">
                    <input
                        v-model="form.scope"
                        type="radio"
                        value="TERM"
                    >
                    <span>One term, in full</span>
                </label>

                <label
                    v-if="form.scope === 'TERM'"
                    class="links_field links_field--indent"
                >
                    <span>Term</span>
                    <select
                        v-model="form.termId"
                        :selected="form.termId"
                    >
                        <option value="">Choose a term…</option>
                        <option
                            v-for="term in terms"
                            :key="term.id"
                            :selected="term.id === form.termId"
                            :value="term.id"
                        >{{ term.name }}</option>
                    </select>
                </label>
            </fieldset>

            <p
                v-if="createError"
                class="note note--error"
                role="alert"
            >{{ createError }}</p>

            <div class="links_form_actions">
                <CommonButton
                    :disabled="creatingBusy || !canSubmit"
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
import CommonButton from '~/components/common/CommonButton.vue';

interface IcsLinkRow {
    id: string;
    name: string;
    url: string;
    scope: 'ALL' | 'TERM';
    termId: string | null;
    weeksAhead: number | null;
    groupIds: string[];
}

interface TermOption {
    id: string;
    name: string;
}

interface GroupOption {
    id: string;
    name: string;
}

/**
 * Self-service calendar-subscription links (issue #15, stream half;
 * group-targeting and the permission gate below are issue #115).
 *
 * CLIENT-ONLY FETCHES (`server: false`), the same departure `ApiTokensPanel`
 * makes on `/my/account`: two independent lists (links, reference data) with
 * nothing else on the page to await, so there is no SSR-meaningful content
 * lost by fetching after mount.
 *
 * REFERENCE DATA COMES FROM `GET /api/me/ics-links/context`, not the generic
 * `term.read`/`group.read`-gated CRUD lists — same reasoning
 * `/api/me/exam-requests/context` gives (issue #108): this page's own gate is
 * `ics_link.generate_own`/`ics_link.generate` alone, and a page must not need
 * a wider permission than its own gate implies just to draw its form.
 * `canTargetGroups` names the group-picker capability explicitly rather than
 * the client inferring it from `groups` being non-empty — a tenant with zero
 * Groups would otherwise look ungated.
 */
const request = useRequestFetch();

const linksData = useAsyncData(
    'me:ics-links',
    () => request<IcsLinkRow[]>('/api/me/ics-links'),
    { default: () => [] as IcsLinkRow[], server: false },
);

interface ContextResponse {
    terms: TermOption[];
    groups: GroupOption[];
    canTargetGroups: boolean;
}

const contextData = useAsyncData(
    'me:ics-links:context',
    () => request<ContextResponse>('/api/me/ics-links/context'),
    { default: () => ({ terms: [], groups: [], canTargetGroups: false }) as ContextResponse, server: false },
);

const links = computed(() => linksData.data.value ?? []);
const terms = computed(() => contextData.data.value?.terms ?? []);
const groups = computed(() => contextData.data.value?.groups ?? []);
const canTargetGroups = computed(() => contextData.data.value?.canTargetGroups ?? false);
const loadError = computed(() => (linksData.error.value ? 'Could not load your calendar links.' : ''));

function scopeLabel(row: IcsLinkRow): string {
    if (row.scope === 'ALL') {
        const weeks = row.weeksAhead ?? 0;

        return `All terms · next ${weeks} week${weeks === 1 ? '' : 's'}`;
    }

    const term = terms.value.find((t) => t.id === row.termId);

    return term ? `Term: ${term.name}` : 'One term';
}

function subjectLabel(row: IcsLinkRow): string {
    if (!row.groupIds.length) {
        return 'My own schedule';
    }

    const names = row.groupIds.map((id) => groups.value.find((g) => g.id === id)?.name ?? 'Unknown group');

    return `Group: ${names.join(', ')}`;
}

/** The server's sentence, or a generic one. Same extraction the account form uses. */
function messageOf(error: unknown): string {
    const e = error as { statusMessage?: string; data?: { statusMessage?: string } };

    return e.data?.statusMessage ?? e.statusMessage ?? 'Could not complete that.';
}

const creating = ref(false);
const creatingBusy = ref(false);
const createError = ref('');
const form = reactive<{
    name: string;
    subject: 'OWN' | 'GROUPS';
    groupIds: string[];
    scope: 'ALL' | 'TERM';
    weeksAhead: number;
    termId: string;
}>({
    name: '',
    subject: 'OWN',
    groupIds: [],
    scope: 'ALL',
    weeksAhead: 4,
    termId: '',
});

const canSubmit = computed(() => {
    if (!form.name.trim()) {
        return false;
    }

    if (form.subject === 'GROUPS' && form.groupIds.length === 0) {
        return false;
    }

    return form.scope === 'ALL'
        ? form.weeksAhead >= 1 && form.weeksAhead <= 52
        : Boolean(form.termId);
});

function startCreate() {
    creating.value = true;
    createError.value = '';
    form.name = '';
    form.subject = 'OWN';
    form.groupIds = [];
    form.scope = 'ALL';
    form.weeksAhead = 4;
    form.termId = '';
}

function cancelCreate() {
    creating.value = false;
}

async function create() {
    if (creatingBusy.value || !canSubmit.value) {
        return;
    }

    creatingBusy.value = true;
    createError.value = '';

    try {
        const groupIds = canTargetGroups.value && form.subject === 'GROUPS' ? form.groupIds : [];
        const body = form.scope === 'ALL'
            ? { name: form.name.trim(), scope: 'ALL' as const, weeksAhead: form.weeksAhead, groupIds }
            : { name: form.name.trim(), scope: 'TERM' as const, termId: form.termId, groupIds };

        await request('/api/me/ics-links', { method: 'POST', body });

        creating.value = false;
        await linksData.refresh();
    } catch (error) {
        createError.value = messageOf(error);
    } finally {
        creatingBusy.value = false;
    }
}

const deletingId = ref('');
const deleteError = ref('');

async function remove(id: string) {
    deletingId.value = id;
    deleteError.value = '';

    try {
        await request(`/api/me/ics-links/${id}`, { method: 'DELETE' });
        await linksData.refresh();
    } catch (error) {
        deleteError.value = messageOf(error);
    } finally {
        deletingId.value = '';
    }
}

const canCopy = computed(() => import.meta.client && Boolean(navigator.clipboard));
const copiedId = ref('');

async function copy(id: string, url: string) {
    try {
        await navigator.clipboard.writeText(url);
        copiedId.value = id;
        setTimeout(() => { copiedId.value = ''; }, 2000);
    } catch {
        // Clipboard access can be refused outright. The value is on screen and
        // selectable either way, so this needs no error of its own.
    }
}
</script>

<style scoped lang="scss">
.links {
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

        &_scope {
            font-size: var(--font-size-xs);
            color: $content7;
        }

        &_url {
            display: flex;
            flex: 1 1 260px;
            gap: var(--space-3);
            align-items: center;

            min-width: 0;

            code {
                overflow-x: auto;
                flex: 1 1 auto;

                min-width: 0;
                padding: var(--space-2) var(--space-4);
                border-radius: var(--radius-md);

                font-size: var(--font-size-xs);
                white-space: nowrap;

                background: $surface3;
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

        input,
        select {
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

        &--indent {
            margin-left: var(--space-7);
        }
    }

    &_scope {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);

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

        &-option {
            display: flex;
            gap: var(--space-3);
            align-items: center;

            font-size: var(--font-size-sm);
            color: $content4;
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
</style>
