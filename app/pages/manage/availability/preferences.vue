<template>
    <CommonAppShell
        description="Preferred teaching days and blocks, for everyone in this institution."
        title="Teaching preferences"
    >
        <!--
            Stated on the administrator's page as well as the lecturer's. An
            administrator looking at a column of carefully-set preferences would
            otherwise reasonably assume the timetable respects them.
        -->
        <p
            class="note note--warn"
            role="status"
        >
            <Icon
                name="material-symbols:build-outline"
                aria-hidden="true"
            />
            <span>
                <strong>Recorded, not yet used by the scheduler.</strong>
                These are stored and editable now; the constraint that makes the solver
                weigh them ships in a later release.
            </span>
        </p>

        <p
            v-if="!canEdit"
            class="note"
        >
            <Icon
                name="material-symbols:lock-outline"
                aria-hidden="true"
            />
            You can view preferences but not change them — that needs
            <code>availability.manage_any</code>.
        </p>

        <p
            v-if="error"
            class="note note--error"
            role="alert"
        >{{ error }}</p>

        <ul class="people">
            <li
                v-for="person in people"
                :key="person.id"
                class="people_row"
            >
                <button
                    class="people_head"
                    type="button"
                    @click="open = open === person.id ? null : person.id"
                >
                    <span class="people_name">{{ person.familyName }}, {{ person.givenName }}</span>
                    <span
                        v-if="person.roles.length"
                        class="people_roles"
                    >{{ person.roles.join(', ') }}</span>
                    <span class="people_summary">{{ describePreferences(person.preference, grid, roomFeatureNames) }}</span>
                    <!--
                        A plain icon, not CommonChevron: that component renders a
                        BUTTON, and a button inside this row's button is invalid
                        markup that browsers resolve by dropping one of them.
                    -->
                    <Icon
                        aria-hidden="true"
                        class="people_caret"
                        :class="{ 'people_caret--open': open === person.id }"
                        name="material-symbols:expand-more"
                    />
                </button>

                <div
                    v-if="open === person.id"
                    class="people_editor"
                >
                    <ManageWeekdayPicker
                        v-model="draftDays"
                        help="Nothing ticked means no day preference."
                        label="Preferred days"
                        :readonly="!canEdit"
                    />

                    <AvailabilityBlockPicker
                        v-model="draftBlocks"
                        :grid="grid"
                        help="Nothing ticked means no preference about the time of day."
                        label="Preferred blocks"
                        :readonly="!canEdit"
                    />

                    <AvailabilityRoomFeaturePicker
                        v-model="draftRoomFeatures"
                        help="Nothing ticked means no preference about the kind of room."
                        label="Preferred room types"
                        :options="roomFeatureOptions"
                        :readonly="!canEdit"
                    />

                    <AvailabilityWeightMultiplier
                        v-model="draftMultiplier"
                        help="Most people should use the default. Raise it where somebody's
                            constraints are genuinely harder than everyone else's, and remember
                            it competes with the institution's other soft rules, not with them."
                        label="How much this person's preference counts"
                        :readonly="!canEdit"
                    />

                    <div
                        v-if="canEdit"
                        class="people_actions"
                    >
                        <CommonButton
                            :disabled="busy"
                            type="primary"
                            @click="save(person.id)"
                        >{{ busy ? 'Saving…' : 'Save' }}</CommonButton>
                        <CommonButton
                            :disabled="busy"
                            type="secondary"
                            @click="open = null"
                        >Cancel</CommonButton>
                    </div>
                </div>
            </li>
        </ul>

        <p
            v-if="!people.length"
            class="note"
        >No active people in this institution yet.</p>
    </CommonAppShell>
</template>

<script setup lang="ts">
import type { TimeGrid } from '~/composables/schedule';
import AvailabilityBlockPicker from '~/components/availability/AvailabilityBlockPicker.vue';
import AvailabilityRoomFeaturePicker from '~/components/availability/AvailabilityRoomFeaturePicker.vue';
import type { RoomFeatureOption } from '~/components/availability/AvailabilityRoomFeaturePicker.vue';
import AvailabilityWeightMultiplier from '~/components/availability/AvailabilityWeightMultiplier.vue';
import CommonAppShell from '~/components/common/CommonAppShell.vue';
import ManageWeekdayPicker from '~/components/manage/ManageWeekdayPicker.vue';
import { describePreferences } from '~/utils/availabilityLabels';
import { useHasPermission, useSession } from '~/composables/session';

definePageMeta({
    // Inline, not the `manage` middleware — see the reviews page for why.
    // `read_any` is enough to LOOK; the editor renders read-only without
    // `manage_any`, which is the whole reason the two keys are separate.
    middleware: [
        () => {
            const held = new Set(useSession().value?.permissions ?? []);

            if (!held.has('availability.read_any') && !held.has('availability.manage_any')) {
                return abortNavigation(createError({
                    statusCode: 403,
                    statusMessage: 'Viewing teaching preferences needs availability.read_any '
                        + 'or availability.manage_any.',
                }));
            }
        },
    ],
});

useHead({ title: 'Teaching preferences' });

interface PersonRow {
    id: string;
    givenName: string;
    familyName: string;
    roles: string[];
    preference: {
        preferredDays: number[];
        preferredBlocks: number[];
        weightMultiplier: number | null;
        preferredRoomFeatureIds: string[];
    } | null;
}

const request = useRequestFetch();

const { data, refresh } = await useAsyncData(
    'manage:availability-preferences',
    () => request<{
        grid: TimeGrid | null;
        people: PersonRow[];
        roomFeatureOptions: RoomFeatureOption[];
    }>('/api/availability/preferences'),
);

const grid = computed(() => data.value?.grid ?? null);
const people = computed(() => data.value?.people ?? []);
const roomFeatureOptions = computed(() => data.value?.roomFeatureOptions ?? []);

// Id → display name for the collapsed summary, which holds ids and shows names.
const roomFeatureNames = computed(
    () => new Map(roomFeatureOptions.value.map((option) => [option.id, option.name || option.key])),
);

const canEdit = useHasPermission('availability.manage_any');

const open = ref<string | null>(null);
const draftDays = ref<number[]>([]);
const draftBlocks = ref<number[]>([]);
const draftMultiplier = ref<number | null>(null);
const draftRoomFeatures = ref<string[]>([]);
const busy = ref(false);
const error = ref('');

/*
 * Seeded when a row is opened rather than by a watcher with `immediate`, for the
 * SSR reason recorded in CLAUDE.md — and because only one row is edited at a
 * time, so there is nothing to seed until somebody picks one.
 */
watch(open, (personId) => {
    const person = people.value.find((row) => row.id === personId);

    draftDays.value = [...(person?.preference?.preferredDays ?? [])];
    draftBlocks.value = [...(person?.preference?.preferredBlocks ?? [])];
    draftRoomFeatures.value = [...(person?.preference?.preferredRoomFeatureIds ?? [])];
    // `null` is the real default state, and a person with no preference row at
    // all is also on the default — both seed the same way.
    draftMultiplier.value = person?.preference?.weightMultiplier ?? null;
    error.value = '';
});

async function save(personId: string) {
    busy.value = true;
    error.value = '';

    try {
        /*
         * The whole state, every time. This endpoint is a true replace — an
         * absent `weightMultiplier` means `null`, not "leave it alone" — so
         * sending it only when it changed would make it a partial-update side
         * channel while the two arrays stay full-replace, and clearing an
         * override would depend on which fields the page happened to include.
         */
        await request(`/api/availability/preferences/${personId}`, {
            method: 'PUT',
            body: {
                preferredDays: draftDays.value,
                preferredBlocks: draftBlocks.value,
                preferredRoomFeatureIds: draftRoomFeatures.value,
                weightMultiplier: draftMultiplier.value,
            },
        });

        await refresh();
        open.value = null;
    } catch (cause) {
        error.value = (cause as { statusMessage?: string }).statusMessage ?? 'Could not save that.';
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped lang="scss">
.note {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;

    margin: 0;

    font-size: var(--font-size-sm);
    line-height: 1.6;
    color: $content7;

    svg {
        flex: none;
        width: 16px;
        height: 16px;
    }

    &--warn {
        color: $warning700;
    }

    &--error {
        font-weight: 600;
        color: $error700;
    }
}

.people {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);

    margin: 0;
    padding: 0;

    list-style: none;

    &_row {
        border-radius: var(--radius-xl);
        background: $surface1;
    }

    &_head {
        cursor: pointer;

        display: grid;
        grid-template-columns: minmax(160px, 1fr) auto minmax(160px, 1fr) auto;
        gap: var(--space-4);
        align-items: center;

        width: 100%;
        padding: var(--space-4) var(--space-5);
        border: none;

        font-family: inherit;
        text-align: left;

        background: none;
    }

    &_name {
        font-size: var(--font-size-md);
        font-weight: 650;
        color: $content2;
    }

    &_caret {
        width: 20px;
        height: 20px;
        color: $content7;
        transition: transform 0.15s;

        &--open {
            transform: rotate(180deg);
        }
    }

    &_roles,
    &_summary {
        font-size: var(--font-size-sm);
        color: $content7;
    }

    &_editor {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
        padding: 0 var(--space-5) var(--space-5);
    }

    &_actions {
        display: flex;
        gap: var(--space-3);
    }
}
</style>
