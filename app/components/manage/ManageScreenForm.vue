<template>
    <ManageEntityForm
        v-model:draft="draft"
        :can-delete="canDelete"
        :can-update="canUpdate"
        :form="form"
        :mode="mode"
        @request-delete="$emit('request-delete')"
        @reset="$emit('reset')"
        @save="$emit('save')"
    >
        <template #fields="{ readonly }">
            <!--
                THE KEY, SHOWN ONCE.

                Not a nicety: only the SHA-256 is stored, so this panel is the
                only moment the URL exists anywhere. If it is dismissed
                unread, the screen is unreachable and the only remedy is
                deleting it and making another, which is why the copy says so
                rather than leaving somebody to discover it at the wall.
            -->
            <section
                v-if="issued && mode === 'create'"
                class="issued"
                role="status"
            >
                <h3 class="issued_title">{{ t('manageUi.screenForm.issuedTitle') }}</h3>

                <p class="issued_url">{{ issued }}</p>

                <p class="issued_warn">
                    <Icon
                        name="material-symbols:warning-outline"
                        aria-hidden="true"
                    />
                    <span>
                        {{ t('manageUi.screenForm.issuedWarning') }}
                    </span>
                </p>

                <CommonButton
                    :text="t('manageUi.screenForm.copyAddress')"
                    type="secondary"
                    @click="copy"
                />
                <p
                    v-if="copied"
                    class="issued_copied"
                    role="status"
                >{{ t('manageUi.screenForm.copied') }}</p>
            </section>

            <div class="scope">
                <p class="scope_label">{{ t('manageUi.screenForm.scopeLabel') }}</p>

                <!--
                    "EMPTY MEANS EVERY ROOM" is stated, not implied. A blank
                    multi-select reads as "nothing selected, so nothing shown",
                    which is the opposite of what the table does, the same
                    fail-open reading `group_term` has, and the same reason its
                    picker spells it out.
                -->
                <!--
                    `<i18n-t>` so the emphasis stays markup inside one
                    translatable sentence rather than splitting the fail-open
                    rule across three text nodes.
                -->
                <i18n-t
                    class="scope_help"
                    keypath="manageUi.screenForm.scopeHelp"
                    scope="global"
                    tag="p"
                >
                    <template #everyRoom>
                        <strong>{{ t('manageUi.screenForm.everyRoomEmphasis') }}</strong>
                    </template>
                </i18n-t>

                <p
                    v-if="readonly"
                    class="scope_static"
                >{{ selected.length ? selectedNames : t('manageUi.screenForm.everyRoom') }}</p>

                <fieldset
                    v-else
                    class="scope_set"
                >
                    <legend class="scope_legend">{{ t('manageUi.screenForm.roomsLegend') }}</legend>

                    <label
                        v-for="room in rooms"
                        :key="room.id"
                        class="scope_item"
                    >
                        <input
                            :checked="selected.includes(room.id)"
                            type="checkbox"
                            @change="toggle(room.id)"
                        >
                        <span>{{ room.name }}</span>
                    </label>

                    <p
                        v-if="!rooms.length"
                        class="scope_help"
                    >{{ t('manageUi.screenForm.noRooms') }}</p>
                </fieldset>
            </div>
        </template>
    </ManageEntityForm>
</template>

<script setup lang="ts">
import type { useEntityForm } from '~/composables/entityForm';
import { randomScreenKey } from '#shared/screenKey';
import CommonButton from '~/components/common/CommonButton.vue';
import ManageEntityForm from '~/components/manage/ManageEntityForm.vue';
import { useT } from '~/composables/i18n';

/**
 * A lobby display's detail: the shared form plus two things it cannot express.
 *
 * 1. The KEY, which exists exactly once (at the moment of creation) because
 *    only its hash is stored. The generic scaffold shows the row it saved; it
 *    has nowhere to put a secret that is not part of the row.
 * 2. The ROOM SCOPE, whose empty state means "every room" and therefore has to
 *    say so in words. A blank multi-select otherwise reads as the opposite.
 */
const props = defineProps<{
    form: ReturnType<typeof useEntityForm>;
    mode: 'create' | 'edit';
    canUpdate: boolean;
    canDelete: boolean;
}>();

defineEmits<{ save: []; reset: []; 'request-delete': [] }>();

const draft = defineModel<Record<string, unknown>>('draft', { required: true });

const { t } = useT();

const copied = ref(false);

/** Rooms to choose from, fetched by the form composable via the field's reference. */
const rooms = computed(() => (props.form.references.value.rooms ?? [])
    .map((row) => ({ id: String(row.id), name: String(row.name ?? row.code ?? row.id) })));

const selected = computed<string[]>(() => {
    const value = draft.value.roomIds;

    return Array.isArray(value) ? value.map(String) : [];
});

const selectedNames = computed(() => rooms.value
    .filter((room) => selected.value.includes(room.id))
    .map((room) => room.name)
    .join(', '));

/**
 * The full display URL, from the draft key.
 *
 * A DRAFT FIELD, generated below, not something read back from the server: only
 * the hash is stored, and the create page navigates to the saved row on success,
 * so a server-issued key would be unreadable by the time it arrived. Identical
 * reasoning to an account's initial password, which is why it is identical
 * machinery.
 *
 * Empty in edit mode, because there is nothing to show: the key cannot be
 * recovered, only replaced.
 */
const issued = computed(() => {
    const key = String(draft.value.key ?? '');

    if (!key) {
        return '';
    }

    const origin = import.meta.client ? window.location.origin : '';

    return `${origin}/screen?key=${key}`;
});

/*
 * Seeded once, on the create form only. `onMounted` rather than at setup so it
 * never runs during SSR: a key generated server-side would be replaced by a
 * different one on hydration, and the address a person copied would stop being
 * the address that got saved.
 */
onMounted(() => {
    if (props.mode === 'create' && !draft.value.key) {
        draft.value = { ...draft.value, key: randomScreenKey() };
    }
});

function toggle(roomId: string): void {
    const next = selected.value.includes(roomId)
        ? selected.value.filter((id) => id !== roomId)
        : [...selected.value, roomId];

    draft.value = { ...draft.value, roomIds: next };
}

async function copy(): Promise<void> {
    try {
        await navigator.clipboard.writeText(issued.value);
        copied.value = true;
    } catch {
        // Clipboard access can be refused outright. The address is on screen
        // and selectable, so this is a convenience failing, not the feature.
        copied.value = false;
    }
}
</script>

<style scoped lang="scss">
.issued {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: flex-start;

    padding: var(--space-5);

    // The content ramp: no step of the surface ramp reaches 3:1 against this
    // ground in either theme, and this panel must not be missable.
    border: 1px solid varToRgba('content7', 0.6);
    border-radius: var(--radius-md);

    &_title {
        margin: 0;
        font-size: var(--font-size-md);
        font-weight: 650;
        color: $content1;
    }

    &_url {
        margin: 0;
        padding: var(--space-3);
        border-radius: var(--radius-sm);

        font-family: monospace;
        font-size: var(--font-size-sm);
        color: $content1;
        overflow-wrap: anywhere;

        background: $surface2;
    }

    &_warn {
        display: flex;
        gap: var(--space-3);
        align-items: flex-start;

        max-width: 68ch;
        margin: 0;

        font-size: var(--font-size-sm);
        line-height: 1.6;
        color: $warning800;

        > .iconify {
            flex: none;
            width: 16px;
            height: 16px;
        }
    }

    &_copied {
        margin: 0;
        font-size: var(--font-size-sm);
        color: $content7;
    }
}

.scope {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    &_label {
        margin: 0;
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content2;
    }

    &_help {
        max-width: 68ch;
        margin: 0;

        font-size: var(--font-size-sm);
        line-height: 1.6;
        color: $content7;
    }

    &_static {
        margin: 0;
        font-size: var(--font-size-sm);
        color: $content2;
    }

    &_set {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3) var(--space-5);

        margin: 0;
        padding: var(--space-4);
        border: 1px solid varToRgba('content7', 0.4);
        border-radius: var(--radius-md);
    }

    &_legend {
        padding-inline: var(--space-2);
        font-size: var(--font-size-xs);
        color: $content7;
    }

    &_item {
        display: flex;
        gap: var(--space-2);
        align-items: center;

        font-size: var(--font-size-sm);
        color: $content1;

        input {
            accent-color: $primary500;
        }

        &:focus-within {
            outline: 2px solid $primary600;
            outline-offset: 2px;
        }
    }
}
</style>
