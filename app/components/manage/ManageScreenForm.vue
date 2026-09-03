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

                <!--
                    THE ROOM PLAN'S TWO KNOBS, named where the address is
                    handed over, because the display itself has nothing to
                    click and the URL is the only place they can be set. Only
                    for the board that reads them: offering them alongside a
                    substitution plan's address would describe settings that
                    board ignores.
                -->
                <p
                    v-if="screenMode === 'ROOM_BOARD'"
                    class="issued_hint"
                >{{ t('manageUi.screenForm.planOptions') }}</p>

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

            <!--
                ONE AXIS AT A TIME, and which one is decided by the `mode`
                select the generic field list renders above. Showing both would
                offer a filter the chosen board never reads, which is the
                clearest way to make somebody believe they have narrowed a
                display that is in fact showing everything.

                The hidden axis is NOT cleared: `groupIds`/`roomIds` are both
                declared registry fields, so both travel on every save and a
                screen switched back to its old mode finds its old scope intact.
            -->
            <div class="scope">
                <p class="scope_label">{{ t(axis.labelKey) }}</p>

                <!--
                    "EMPTY MEANS EVERYTHING" is stated, not implied, on BOTH
                    axes. A blank multi-select reads as "nothing selected, so
                    nothing shown", which is the opposite of what these tables
                    do, the same fail-open reading `group_term` has, and the
                    same reason its picker spells it out.
                -->
                <!--
                    `<i18n-t>` so the emphasis stays markup inside one
                    translatable sentence rather than splitting the fail-open
                    rule across three text nodes.
                -->
                <i18n-t
                    class="scope_help"
                    :keypath="axis.helpKey"
                    scope="global"
                    tag="p"
                >
                    <template #everyRoom>
                        <strong>{{ t('manageUi.screenForm.everyRoomEmphasis') }}</strong>
                    </template>
                    <template #everyGroup>
                        <strong>{{ t('manageUi.screenForm.everyGroupEmphasis') }}</strong>
                    </template>
                </i18n-t>

                <p
                    v-if="readonly"
                    class="scope_static"
                >{{ selected.length ? selectedNames : t(axis.everyKey) }}</p>

                <fieldset
                    v-else
                    class="scope_set"
                >
                    <legend class="scope_legend">{{ t(axis.legendKey) }}</legend>

                    <label
                        v-for="option in options"
                        :key="option.id"
                        class="scope_item"
                    >
                        <input
                            :checked="selected.includes(option.id)"
                            type="checkbox"
                            @change="toggle(option.id)"
                        >
                        <span>{{ option.name }}</span>
                    </label>

                    <p
                        v-if="!options.length"
                        class="scope_help"
                    >{{ t(axis.emptyKey) }}</p>
                </fieldset>

                <p class="scope_help">{{ t('manageUi.screenForm.modeNote') }}</p>
            </div>

            <!--
                THE PLAN'S OWN HOURS (issue #131), room board only: the
                substitution plan draws a list, not a day, and has no axis for
                these to mean anything on.

                Not fields on the generic list, for two reasons. They are
                MODE-SPECIFIC, which the generic list cannot express, and they
                are stored as minutes since midnight while the only sane
                control for them is `<input type="time">`; the conversion lives
                here rather than becoming a new generic field type for one
                entity's pair of columns.
            -->
            <div
                v-if="screenMode === 'ROOM_BOARD'"
                class="scope"
            >
                <p class="scope_label">{{ t('manageUi.screenForm.windowLabel') }}</p>

                <!--
                    EMPTY MEANS THE TIMETABLE'S OWN DAY, stated rather than
                    implied, the same way the scope's empty state is: a blank
                    time input reads as "no plan at all", and what it actually
                    means is "whatever the TimeGrid says today runs from".
                -->
                <p class="scope_help">{{ t('manageUi.screenForm.windowHelp') }}</p>

                <p
                    v-if="readonly"
                    class="scope_static"
                >{{ windowSummary }}</p>

                <fieldset
                    v-else
                    class="window"
                >
                    <legend class="scope_legend">{{ t('manageUi.screenForm.windowLegend') }}</legend>

                    <label class="window_field">
                        <span>{{ t('manageUi.screenForm.windowStart') }}</span>
                        <input
                            :value="planStart"
                            type="time"
                            @change="setWindow('planStartMinute', $event)"
                        >
                    </label>

                    <label class="window_field">
                        <span>{{ t('manageUi.screenForm.windowEnd') }}</span>
                        <input
                            :value="planEnd"
                            type="time"
                            @change="setWindow('planEndMinute', $event)"
                        >
                    </label>
                </fieldset>
            </div>
        </template>
    </ManageEntityForm>
</template>

<script setup lang="ts">
import type { useEntityForm } from '~/composables/entityForm';
import type { MessageKey } from '~~/i18n/keys';
import type { ScreenMode } from '#shared/screenKey';
import { SCREEN_MODE_PATHS, asScreenMode, randomScreenKey } from '#shared/screenKey';
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

/**
 * WHICH SCOPE AXIS THIS SCREEN ACTUALLY USES (issue #31), derived from the
 * mode rather than shown alongside it. `ROOM_BOARD` reads `screen_room`,
 * `SUBSTITUTION_PLAN` reads `screen_group`, and neither reads the other's;
 * see the `ScreenMode` enum's own comment on why they are not intersected.
 *
 * An unrecognised stored mode falls back to the room axis HERE and only here,
 * so an operator can still see and edit the row. The BOARD routes do the
 * opposite and refuse it by name: a form that cannot be opened is a dead end,
 * a wall drawing the wrong board silently is a wrong answer.
 */
const AXES = {
    ROOM_BOARD: {
        field: 'roomIds',
        resource: 'rooms',
        labelKey: 'manageUi.screenForm.scopeLabel',
        helpKey: 'manageUi.screenForm.scopeHelp',
        everyKey: 'manageUi.screenForm.everyRoom',
        legendKey: 'manageUi.screenForm.roomsLegend',
        emptyKey: 'manageUi.screenForm.noRooms',
    },
    SUBSTITUTION_PLAN: {
        field: 'groupIds',
        resource: 'groups',
        labelKey: 'manageUi.screenForm.groupScopeLabel',
        helpKey: 'manageUi.screenForm.groupScopeHelp',
        everyKey: 'manageUi.screenForm.everyGroup',
        legendKey: 'manageUi.screenForm.groupsLegend',
        emptyKey: 'manageUi.screenForm.noGroups',
    },
} as const satisfies Record<ScreenMode, {
    field: string;
    resource: string;
    labelKey: MessageKey;
    helpKey: MessageKey;
    everyKey: MessageKey;
    legendKey: MessageKey;
    emptyKey: MessageKey;
}>;

/* `screenMode`, not `mode`: the component already has a `mode` prop
 * (create/edit), and a computed of the same name shadows it in the template. */
const screenMode = computed<ScreenMode>(() => asScreenMode(draft.value.mode) ?? 'ROOM_BOARD');
const axis = computed(() => AXES[screenMode.value]);

/** Rows to choose from, fetched by the form composable via the field's reference. */
const options = computed(() => (props.form.references.value[axis.value.resource] ?? [])
    .map((row) => ({ id: String(row.id), name: String(row.name ?? row.code ?? row.id) })));

const selected = computed<string[]>(() => {
    const value = draft.value[axis.value.field];

    return Array.isArray(value) ? value.map(String) : [];
});

const selectedNames = computed(() => options.value
    .filter((option) => selected.value.includes(option.id))
    .map((option) => option.name)
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

    // THE ADDRESS FOR THE MODE THAT WAS CHOSEN. The two boards are two pages
    // and each data route refuses the other's key by name, so handing out
    // `/screen` for a substitution plan would issue an address that is wrong
    // from the moment it is copied.
    return `${origin}${SCREEN_MODE_PATHS[screenMode.value]}?key=${key}`;
});

/*
 * Seeded once, on the create form only. `onMounted` rather than at setup so it
 * never runs during SSR: a key generated server-side would be replaced by a
 * different one on hydration, and the address a person copied would stop being
 * the address that got saved.
 */
onMounted(() => {
    if (props.mode === 'create' && !draft.value.key) {
        /*
         * `screenMode` seeded alongside the key so the draft SAYS what the
         * select already shows. A `select` with a null model renders its first
         * option, and the create route defaults the same way, so the two
         * agreed; stating it makes the issued address below derive from a real
         * value rather than from the fallback.
         */
        draft.value = {
            ...draft.value,
            key: randomScreenKey(),
            mode: draft.value.mode ?? 'ROOM_BOARD',
        };
    }
});

/**
 * The plan window, as the `<input type="time">` pair sees it.
 *
 * MINUTES IN THE DATABASE, `HH:MM` IN THE CONTROL, and this is the only place
 * that converts. The column is minutes since tenant-local midnight because
 * that is what every other time in this product is (a TimeGrid block, a
 * blackout, the board's own entries) and because it is timezone-free: an
 * `HH:MM` string would have to be read against some zone to be compared with a
 * block boundary, and the whole point of `Tenant.timezone` is that only one
 * zone is ever involved.
 */
function minutesOf(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clockOf(minutes: number | null): string {
    if (minutes === null) {
        return '';
    }

    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const planStart = computed(() => clockOf(minutesOf(draft.value.planStartMinute)));
const planEnd = computed(() => clockOf(minutesOf(draft.value.planEndMinute)));

const windowSummary = computed(() => {
    const start = planStart.value;
    const end = planEnd.value;

    if (!start && !end) {
        return t('manageUi.screenForm.windowGrid');
    }

    // One end alone is a legitimate configuration ("start at seven, end
    // wherever the timetable does"), so the missing half is NAMED rather than
    // rendered as a gap in a range.
    return t('manageUi.screenForm.windowRange', {
        start: start || t('manageUi.screenForm.windowGridStart'),
        end: end || t('manageUi.screenForm.windowGridEnd'),
    });
});

/**
 * NULL ON AN EMPTY INPUT, never left at the old value: clearing the field is
 * how somebody hands the day back to the TimeGrid, and the PATCH route reads
 * null on these two columns as CLEAR for exactly that reason.
 */
function setWindow(field: 'planStartMinute' | 'planEndMinute', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const match = /^(\d{2}):(\d{2})$/.exec(value);

    draft.value = {
        ...draft.value,
        [field]: match ? Number(match[1]) * 60 + Number(match[2]) : null,
    };
}

function toggle(id: string): void {
    const next = selected.value.includes(id)
        ? selected.value.filter((current) => current !== id)
        : [...selected.value, id];

    draft.value = { ...draft.value, [axis.value.field]: next };
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

    &_hint {
        margin: 0;
        font-size: var(--font-size-xs);
        color: $content7;
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

.window {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);

    margin: 0;
    padding: 0;
    border: 0;

    &_field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);

        font-size: var(--font-size-sm);
        color: $content7;

        &:focus-within {
            color: $content1;
        }
    }
}
</style>
