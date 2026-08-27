<template>
    <div class="account">
        <ManageEntityForm
            v-model:draft="draft"
            :can-delete="canDelete && isSoleTenant"
            :can-update="canUpdate"
            :form="form"
            :mode="mode"
            @request-delete="$emit('request-delete')"
            @reset="$emit('reset')"
            @save="$emit('save')"
        >
            <template #fields="{ readonly }">
                <!--
                    Said before anything else on the page, because it decides
                    which of the controls below will be accepted. `role="status"`
                    and not `alert`: nothing is wrong, the login is simply not
                    solely this institution's.
                -->
                <p
                    v-if="mode === 'edit' && !isSoleTenant"
                    class="account_note account_note--shared"
                    role="status"
                >
                    <Icon
                        name="material-symbols:groups-outline"
                        aria-hidden="true"
                    />
                    <span>
                        This login is also used at {{ otherTenantCount }}
                        other institution{{ otherTenantCount === 1 ? '' : 's' }}.
                        Its address, activation and password belong to all of them, so this
                        institution can only change who it acts as here. Removing it from this
                        institution detaches it; it keeps working elsewhere.
                    </span>
                </p>

                <!--
                    The person this login acts AS. Bespoke rather than a
                    `reference` field because the options come from
                    /api/accounts/candidates — people who do not already have one
                    — and a picker whose options are mostly invalid is worse than
                    a short one. See the registry entry.
                -->
                <div
                    class="field"
                    :class="{ 'field--invalid': !!form.fieldErrors.value.personId }"
                >
                    <label
                        class="field_label"
                        :for="personControlId"
                    >
                        Acts as
                        <span
                            class="field_required"
                            aria-hidden="true"
                        >*</span>
                    </label>

                    <p
                        v-if="readonly"
                        :id="personControlId"
                        class="field_static"
                    >{{ selectedPersonLabel }}</p>

                    <select
                        v-else
                        :id="personControlId"
                        class="field_control"
                        :value="String(draft.personId ?? '')"
                        @change="draft.personId = ($event.target as HTMLSelectElement).value || null"
                    >
                        <option
                            :selected="!draft.personId"
                            value=""
                        >— Choose a person —</option>
                        <option
                            v-for="person in options"
                            :key="person.id"
                            :selected="person.id === String(draft.personId ?? '')"
                            :value="person.id"
                        >{{ personLabel(person) }}</option>
                    </select>

                    <p
                        v-if="form.fieldErrors.value.personId"
                        class="field_error"
                        role="alert"
                    >{{ form.fieldErrors.value.personId }}</p>

                    <p
                        v-else-if="!readonly && candidatesLoaded && options.length === 0"
                        class="field_hint field_hint--warn"
                    >
                        Everybody in this institution already has a login, or there is nobody
                        here yet. Add a person under People first — a login has to act as one.
                    </p>

                    <p
                        v-else-if="!readonly"
                        class="field_hint"
                    >
                        Who this credential signs in as. Only people without a login are listed:
                        one person answers to exactly one account, so audit entries stay
                        unambiguous.
                    </p>

                    <!--
                        A truncated list is REPORTED, never presented as the whole
                        of it: a select that silently omits somebody reads as "that
                        person is not here", which is the least diagnosable answer
                        a picker can give.
                    -->
                    <p
                        v-if="!readonly && atCandidateLimit"
                        class="field_hint field_hint--warn"
                    >
                        Showing the first {{ CANDIDATE_LIMIT }} people without a login — there are
                        more. Until this picker can search, issue the login from a terminal:
                        <code>bun run create:account -- --tenant &lt;slug&gt; --email &lt;email&gt;
                        --attach</code>
                    </p>
                </div>

                <!--
                    The initial password, GENERATED IN THE BROWSER and shown in
                    the clear.

                    Deliberately not left to the server, which would also generate
                    one: the response is the only moment it is legible, and the
                    create page navigates to the detail page on success, so a
                    server-generated secret would be gone before it could be read.
                    Generating it here means the value is on screen, next to a Copy
                    button, before anything is submitted.
                -->
                <div
                    v-if="mode === 'create'"
                    class="field"
                    :class="{ 'field--invalid': !!form.fieldErrors.value.password }"
                >
                    <label
                        class="field_label"
                        :for="passwordControlId"
                    >
                        Initial password
                        <span
                            class="field_required"
                            aria-hidden="true"
                        >*</span>
                    </label>

                    <div class="account_password">
                        <input
                            :id="passwordControlId"
                            class="field_control"
                            :value="String(draft.password ?? '')"
                            spellcheck="false"
                            type="text"
                            @input="draft.password = ($event.target as HTMLInputElement).value"
                        >

                        <CommonButton
                            icon="material-symbols:casino-outline"
                            type="secondary"
                            @click="draft.password = randomPassword()"
                        >Generate</CommonButton>

                        <CommonButton
                            v-if="canCopy"
                            icon="material-symbols:content-copy-outline"
                            type="secondary"
                            @click="copy(String(draft.password ?? ''))"
                        >{{ copied ? 'Copied' : 'Copy' }}</CommonButton>
                    </div>

                    <p
                        v-if="form.fieldErrors.value.password"
                        class="field_error"
                        role="alert"
                    >{{ form.fieldErrors.value.password }}</p>

                    <p
                        v-else
                        class="field_hint field_hint--warn"
                    >
                        Copy it now. Only a hash is stored, so this exact value is never
                        readable again — though a new one can be issued from this login’s page
                        at any time. At least {{ PASSWORD_MIN_LENGTH }} characters.
                    </p>
                </div>

                <!--
                    The address is already taken. NOT an error to bounce off: one
                    credential acting in several institutions is the model working
                    as intended, and a lecturer arriving from a partner university
                    is the ordinary case. Detected from the server's own flag, not
                    from its wording — see `form.errorData`.
                -->
                <div
                    v-if="mode === 'create' && accountExists"
                    class="account_attach"
                    role="status"
                >
                    <p class="account_attach_head">This address already has a login.</p>

                    <p class="account_attach_body">
                        It can be attached to {{ selectedPersonLabel }} instead of creating a
                        second one. They would sign in with the password they already have —
                        this institution never sees it — and because the login would then be
                        shared, its address, activation and password could no longer be changed
                        from here.
                    </p>

                    <label class="account_attach_confirm">
                        <input
                            :checked="Boolean(draft.attachExisting)"
                            type="checkbox"
                            @change="draft.attachExisting = ($event.target as HTMLInputElement).checked"
                        >
                        <span>Attach the existing login instead of creating one</span>
                    </label>

                    <p
                        v-if="draft.attachExisting"
                        class="account_attach_body"
                    >Press Create again to attach it.</p>
                </div>
            </template>
        </ManageEntityForm>

        <!--
            Credential operations, deliberately OUTSIDE the form.

            Each is an explicit verb with an immediate effect and no draft to
            discard, so putting them among fields that save together would make
            "Save changes" look like it covered them. Same reasoning that keeps
            Session's move/swap/lock off a generic PATCH.
        -->
        <section
            v-if="mode === 'edit' && canUpdate"
            class="account_ops"
        >
            <h2 class="account_ops_title">Credential</h2>

            <dl class="account_facts">
                <div>
                    <dt>Last sign-in</dt>
                    <dd>{{ lastLogin }}</dd>
                </div>
                <div>
                    <dt>Active sessions</dt>
                    <dd>{{ activeSessions }}</dd>
                </div>
            </dl>

            <p
                v-if="opError"
                class="account_note account_note--error"
                role="alert"
            >{{ opError }}</p>

            <!--
                The issued password, shown once and only here. Kept in a ref and
                never re-fetched: the server hashes it before answering, so there
                is nothing to come back for.
            -->
            <div
                v-if="issued"
                class="account_issued"
                role="status"
            >
                <p class="account_issued_head">New password issued. Sessions revoked: {{ issuedRevoked }}.</p>

                <div class="account_issued_value">
                    <code>{{ issued }}</code>

                    <CommonButton
                        v-if="canCopy"
                        icon="material-symbols:content-copy-outline"
                        type="secondary"
                        @click="copy(issued)"
                    >{{ copied ? 'Copied' : 'Copy' }}</CommonButton>
                </div>

                <p class="account_issued_note">
                    Shown once. They will be asked to choose their own at the next sign-in.
                </p>
            </div>

            <p
                v-if="revokedNotice"
                class="account_note account_note--ok"
                role="status"
            >{{ revokedNotice }}</p>

            <div class="account_ops_actions">
                <CommonButton
                    :disabled="busy || !isSoleTenant"
                    icon="material-symbols:lock-reset"
                    type="secondary"
                    @click="resetPassword"
                >Issue a new password</CommonButton>

                <CommonButton
                    :disabled="busy"
                    icon="material-symbols:logout"
                    type="secondary"
                    @click="revokeSessions"
                >Sign out everywhere</CommonButton>

                <CommonButton
                    v-if="!isSoleTenant"
                    :disabled="busy"
                    icon="material-symbols:link-off"
                    type="destructive"
                    @click="detach"
                >Remove from this institution</CommonButton>
            </div>

            <p class="account_ops_hint">
                <template v-if="isSoleTenant">
                    Issuing a password revokes every session this login holds and requires a
                    change at the next sign-in.
                </template>
                <template v-else>
                    Only this institution’s link can be changed here — issuing a password would
                    change how the login behaves at the others too.
                </template>
                Signing out reaches every institution the login is used at, which is allowed
                because its holder can sign straight back in with the password they know.
            </p>
        </section>
    </div>
</template>

<script setup lang="ts">
import type { useEntityForm } from '~/composables/entityForm';
import ManageEntityForm from '~/components/manage/ManageEntityForm.vue';
import { PASSWORD_MIN_LENGTH, randomPassword } from '#shared/password';
import { CANDIDATE_LIMIT } from '#shared/accounts';

/**
 * Account's detail: the shared form, plus the two things a login has that no
 * other managed entity does — a person it acts as, and a secret.
 *
 * WHY THIS IS BESPOKE
 *
 * Three reasons, none of which the generic scaffold can express as registry
 * data:
 *
 *   1. the person picker's options come from `/api/accounts/candidates`, not from
 *      `/api/persons` — most people already have a login and offering them
 *      produces a 409 after the form is filled in;
 *   2. a password is a value that must be VISIBLE exactly once and is generated
 *      in the browser, so the create page can navigate away without losing it;
 *   3. resetting a password and revoking sessions are explicit verbs with
 *      immediate effects, and rendering them among fields that save together
 *      would make one Save button appear to cover them.
 *
 * WHAT IT IS NOT: a page. Shell, header, permission handling, dirty tracking,
 * error mapping and the delete dialog all stay shared, exactly as
 * `ManageAccessRoleForm` and `ManageTimeGridEditor` do.
 */
const props = defineProps<{
    form: ReturnType<typeof useEntityForm>;
    mode: 'create' | 'edit';
    canUpdate: boolean;
    canDelete: boolean;
}>();

defineEmits<{ save: []; reset: []; 'request-delete': [] }>();

const draft = defineModel<Record<string, unknown>>('draft', { required: true });

const request = useRequestFetch();
const router = useRouter();

const personControlId = useId();
const passwordControlId = useId();

interface Candidate {
    id: string;
    givenName: string;
    familyName: string;
    email: string | null;
    isActive: boolean;
}

const row = computed(() => props.form.row.value as {
    id?: string;
    personId?: string;
    personName?: string;
    isSoleTenant?: boolean;
    otherTenantCount?: number;
    activeSessions?: number;
    lastLoginAt?: string | null;
} | null);

/**
 * DEFAULTS TO "SOLE TENANT" ONLY ON THE CREATE PAGE, where there is no row yet
 * and a login being created is necessarily this institution's alone.
 *
 * On the edit page it reads the row, and a missing value falls to `false` — the
 * restrictive side. A guard that fails open would offer a reset button on a
 * shared login and answer 409 when pressed; failing closed offers one button
 * fewer than it could, which is the cheaper mistake.
 */
const isSoleTenant = computed(() => (
    props.mode === 'create' ? true : Boolean(row.value?.isSoleTenant)
));

const otherTenantCount = computed(() => row.value?.otherTenantCount ?? 0);
const activeSessions = computed(() => row.value?.activeSessions ?? 0);

const lastLogin = computed(() => {
    const value = row.value?.lastLoginAt;

    // Never signed in and "we do not know" are the same fact here, and both are
    // worth saying out loud rather than rendering as an empty cell.
    return value ? new Date(value).toLocaleString() : 'Never';
});

/**
 * The people this login may act as.
 *
 * `include` keeps the CURRENT person in the list even though they already have a
 * login — this one. Without it the select would open on an option that is not
 * there and read as unset, and the first save would clear the link.
 *
 * TOLERANT: this endpoint is gated on `account.manage`, so a caller holding only
 * `account.read` gets a 403 and the page must still render — read-only, where the
 * picker prints the stored name and never needs the list at all.
 */
const candidatesData = useAsyncData(
    `account-form:candidates:${row.value?.id ?? 'new'}`,
    () => request<Candidate[]>('/api/accounts/candidates', {
        query: row.value?.personId ? { include: row.value.personId } : {},
    }),
    {
        default: () => [] as Candidate[],
        /*
         * CLIENT ONLY, and the one place this component departs from the
         * codebase's "first render comes from the awaited promise" rule — because
         * it is a CHILD of the page, and the page holds the single top-level
         * await. Awaiting here would make this an async component; not awaiting
         * while fetching on the server would render the options list twice from
         * two different states, which is a hydration mismatch.
         *
         * Safe only because nothing about the FIRST render depends on it: the
         * read-only path prints `row.personName`, the create path opens on its
         * placeholder option, and the empty-state warning below waits for
         * `candidatesLoaded` rather than reading "not yet fetched" as "none".
         */
        server: false,
    },
);

const candidates = computed(() => candidatesData.data.value ?? []);

/**
 * Whether the list is an ANSWER yet.
 *
 * Without this the picker announces "everybody already has a login" for the
 * moment before its own fetch resolves — a guard that cannot tell "found nothing"
 * from "have not looked", which is the failure mode CLAUDE.md names outright.
 */
const candidatesLoaded = computed(() => candidatesData.status.value === 'success');

/**
 * Whether the endpoint's cap was reached. Compared against ITS constant, not a
 * repeated literal — two copies of a limit are two chances for the message to
 * stop matching the query.
 */
const atCandidateLimit = computed(() => candidates.value.length >= CANDIDATE_LIMIT);

function personLabel(person: Candidate): string {
    const name = `${person.givenName} ${person.familyName}`.trim();

    return person.email ? `${name} — ${person.email}` : name;
}

/**
 * The select's options: the person this login ALREADY acts as, plus everybody
 * who could take one.
 *
 * THE CURRENT PERSON COMES FROM THE ROW, not from the fetch, and that is what
 * makes the first render true. The candidates arrive client-side, so a select
 * built from them alone renders on the server as "— Choose a person —" with the
 * placeholder selected — a page stating that a login belongs to nobody, on a
 * login that plainly belongs to somebody, corrected a moment later. The row is
 * part of the page's own awaited data, so this option is there from the first
 * byte.
 *
 * Deduplicated because the fetch asks for the current person explicitly
 * (`?include=`) and would otherwise list them twice.
 */
const options = computed<Candidate[]>(() => {
    const current = String(draft.value.personId ?? '');
    const list = candidates.value;

    if (!current || list.some((person) => person.id === current)) {
        return list;
    }

    return [
        {
            id: current,
            // The row carries one display name, not its parts. Put in
            // `givenName` so `personLabel` renders it unchanged.
            givenName: row.value?.personName ?? 'Currently attached person',
            familyName: '',
            email: null,
            isActive: true,
        },
        ...list,
    ];
});

/**
 * What the read-only view prints. Resolves through `options`, so it works before
 * the candidates arrive and for a caller without `account.manage`, who never
 * gets them at all — printing a raw uuid under "Acts as" is worse than printing
 * nothing.
 */
const selectedPersonLabel = computed(() => {
    const id = String(draft.value.personId ?? '');
    const match = options.value.find((person) => person.id === id);

    return match ? personLabel(match) : (row.value?.personName || '—');
});

/** The server's flag, never its wording. See `useEntityForm().errorData`. */
const accountExists = computed(() => Boolean(props.form.errorData.value?.accountExists));

/*
 * Generated on the CLIENT, after hydration, so the server never renders a secret
 * into the HTML it sends and there is no hydration mismatch to reconcile. The
 * field is empty for the instant before this runs, which is why it also carries a
 * Generate button rather than depending on this.
 */
onMounted(() => {
    if (props.mode === 'create' && !draft.value.password) {
        draft.value.password = randomPassword();
    }
});

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

const busy = ref(false);
const opError = ref('');
const issued = ref('');
const issuedRevoked = ref(0);
const revokedNotice = ref('');

/** The server's sentence, or a generic one. Same extraction the form composable uses. */
function messageOf(error: unknown): string {
    const e = error as { statusMessage?: string; data?: { statusMessage?: string; message?: string } };

    return e.data?.statusMessage ?? e.statusMessage ?? e.data?.message ?? 'Could not complete that.';
}

async function run(action: () => Promise<void>) {
    if (busy.value) {
        return;
    }

    busy.value = true;
    opError.value = '';

    try {
        await action();
    } catch (error) {
        opError.value = messageOf(error);
    } finally {
        busy.value = false;
    }
}

function resetPassword() {
    return run(async () => {
        issued.value = '';
        revokedNotice.value = '';

        /*
         * The password is generated HERE and sent, rather than left to the
         * server, for one reason: the response is the only moment it exists in
         * the clear, and a lost response would mean a login nobody can use. The
         * server generates one when none is sent, so the CLI and any API caller
         * keep working; this page simply never relies on that.
         */
        const password = randomPassword();

        const result = await request<{ oneTimePassword: string; sessionsRevoked: number }>(
            `/api/accounts/${row.value?.id}/reset-password`,
            { method: 'POST', body: { password } },
        );

        issued.value = result.oneTimePassword;
        issuedRevoked.value = result.sessionsRevoked;

        // The row's `mustChangePassword` flag and session count both moved, and
        // the panel above reads them off the row.
        await props.form.refresh();
    });
}

function revokeSessions() {
    return run(async () => {
        revokedNotice.value = '';

        const result = await request<{ sessionsRevoked: number }>(
            `/api/accounts/${row.value?.id}/revoke-sessions`,
            { method: 'POST' },
        );

        revokedNotice.value = result.sessionsRevoked === 0
            ? 'There were no active sessions to revoke.'
            : `${result.sessionsRevoked} session(s) revoked. `
                + 'The login still works — they can sign back in with their own password.';
    });
}

/**
 * Detach this institution's link. Only reachable for a shared login, because for
 * any other one it would leave a working password nobody can see — the server
 * refuses that outright (`assertDetachable`) and this button is hidden.
 */
function detach() {
    return run(async () => {
        await request(`/api/accounts/${row.value?.id}/detach`, { method: 'POST' });

        await router.push('/manage/accounts');
    });
}
</script>

<style scoped lang="scss">
.account {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);

    &_note {
        display: flex;
        gap: var(--space-4);
        align-items: flex-start;

        margin: 0;
        padding: 10px var(--space-5);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-sm);
        line-height: 1.5;

        svg {
            flex: none;
            width: 16px;
            height: 16px;
            margin-top: 2px;
        }

        &--shared {
            color: $content4;
            background: $surface3;
        }

        &--error {
            font-weight: 600;
            color: $error700;
            background: varToRgba('error500', 0.14);
        }

        &--ok {
            color: $content4;
            background: $surface2;
        }
    }

    &_password {
        display: flex;
        gap: var(--space-3);
        align-items: center;

        .field_control {
            flex: 1;
            min-width: 0;
            font-family: monospace;
        }
    }

    &_attach {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);

        padding: var(--space-5);
        border: 1px solid $warning500;
        border-radius: var(--radius-lg);

        &_head {
            margin: 0;
            font-size: var(--font-size-md);
            font-weight: 650;
            color: $warning700;
        }

        &_body {
            margin: 0;
            font-size: var(--font-size-sm);
            line-height: 1.5;
            color: $content5;
        }

        &_confirm {
            cursor: pointer;

            display: flex;
            gap: var(--space-3);
            align-items: center;

            font-size: var(--font-size-sm);
            color: $content3;
        }
    }

    &_ops {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);

        max-width: 620px;
        padding: var(--space-7);
        border-radius: var(--radius-xl);

        background: $surface1;

        &_title {
            margin: 0;
            font-size: var(--font-size-md);
            font-weight: 680;
            color: $content3;
        }

        &_actions {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-4);
        }

        &_hint {
            margin: 0;
            font-size: var(--font-size-sm);
            line-height: 1.5;
            color: $content7;
        }
    }

    &_facts {
        display: flex;
        gap: var(--space-7);
        margin: 0;

        dt {
            font-size: var(--font-size-xs);
            color: $content7;
        }

        dd {
            margin: 0;
            font-size: var(--font-size-md);
            font-variant-numeric: tabular-nums;
            color: $content3;
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
        }
    }
}

/*
 * The bespoke controls above borrow `ManageField`'s classes so a hand-written
 * select is indistinguishable from a generated one. Scoped styles cannot reach
 * another component's stylesheet, so the shapes are restated here — deliberately
 * the shapes only, with every value still coming from the same tokens.
 */
.field {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    &_label {
        font-size: var(--font-size-sm);
        font-weight: 620;
        color: $content4;
    }

    &_required {
        color: $error700;
    }

    &_control {
        width: 100%;
        padding: 10px var(--space-4);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content2;

        background: $surface0;

        &:focus-visible {
            border-color: $primary500;
            outline: none;
        }
    }

    &_static {
        margin: 0;
        font-size: var(--font-size-md);
        color: $content3;
    }

    &_hint {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;

        &--warn {
            color: $warning700;
        }
    }

    &_error {
        margin: 0;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $error700;
    }

    &--invalid .field_control {
        border-color: $error500;
    }
}
</style>
