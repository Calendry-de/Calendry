<template>
    <CommonPage title="My teaching preferences">
        <p class="intro">
            Days and times you would rather teach. Unlike unavailability, a preference is a
            <strong>soft</strong> wish — it never blocks a placement, so it needs no approval
            and takes effect as soon as you save it.
        </p>

        <!--
            The honest disclosure, on the page where the data is entered.
            `person_preference` has no wire field yet: the proto and solver work
            that makes these count is a separate slice. Saying so here is what
            keeps this from repeating the lecturer_veto story, where a rule
            looked healthy for months while being fed nothing.
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
                Your preferences are saved and visible to administrators, but the timetable
                does not weigh them yet — that arrives in a later release. Nothing you set
                here will change a schedule today.
            </span>
        </p>

        <section class="card">
            <ManageWeekdayPicker
                v-model="draftDays"
                help="Leave everything unticked if you have no day preference."
                label="Preferred days"
            />

            <AvailabilityBlockPicker
                v-model="draftBlocks"
                :grid="grid"
                help="Leave everything unticked if you have no preference about the time of day."
                label="Preferred blocks"
            />

            <p
                v-if="error"
                class="note note--error"
                role="alert"
            >{{ error }}</p>

            <p
                v-else-if="saved"
                class="note note--ok"
                role="status"
            >Saved.</p>

            <div class="actions">
                <CommonButton
                    :disabled="busy || !dirty"
                    type="primary"
                    @click="save"
                >{{ busy ? 'Saving…' : 'Save preferences' }}</CommonButton>

                <CommonButton
                    v-if="dirty"
                    :disabled="busy"
                    type="secondary"
                    @click="seed"
                >Discard changes</CommonButton>
            </div>
        </section>
    </CommonPage>
</template>

<script setup lang="ts">
import type { TimeGrid } from '~/composables/schedule';
import AvailabilityBlockPicker from '~/components/availability/AvailabilityBlockPicker.vue';
import ManageWeekdayPicker from '~/components/manage/ManageWeekdayPicker.vue';

definePageMeta({ middleware: 'my' });

useHead({ title: 'My teaching preferences' });

interface Payload {
    grid: TimeGrid | null;
    preference: { preferredDays: number[]; preferredBlocks: number[] } | null;
}

const request = useRequestFetch();

const { data, refresh } = await useAsyncData(
    'my:preferences',
    () => request<Payload>('/api/me/availability'),
);

const grid = computed(() => data.value?.grid ?? null);

const draftDays = ref<number[]>([]);
const draftBlocks = ref<number[]>([]);
const pristine = ref('');
const busy = ref(false);
const saved = ref(false);
const error = ref('');

function seed() {
    draftDays.value = [...(data.value?.preference?.preferredDays ?? [])];
    draftBlocks.value = [...(data.value?.preference?.preferredBlocks ?? [])];
    pristine.value = JSON.stringify([draftDays.value, draftBlocks.value]);
    saved.value = false;
    error.value = '';
}

/*
 * Seeded from the AWAITED data, not from a watcher. Vue does not flush watchers
 * during SSR, so a `watch(..., { immediate: true })` would run once on the
 * server with nothing fetched and render empty controls over real preferences —
 * the failure CLAUDE.md records from Step 13. The watcher below is for later
 * client-side refreshes only.
 */
seed();
watch(data, seed);

const dirty = computed(() => JSON.stringify([draftDays.value, draftBlocks.value]) !== pristine.value);

async function save() {
    busy.value = true;
    error.value = '';
    saved.value = false;

    try {
        await request('/api/me/preferences', {
            method: 'PUT',
            body: { preferredDays: draftDays.value, preferredBlocks: draftBlocks.value },
        });

        await refresh();
        saved.value = true;
    } catch (cause) {
        error.value = (cause as { statusMessage?: string }).statusMessage ?? 'Could not save that.';
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped lang="scss">
.intro,
.note {
    margin: 0;
    font-size: var(--font-size-sm);
    line-height: 1.6;
    color: $content7;
}

.note {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;

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

    &--ok {
        color: $success700;
    }
}

.card {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);

    padding: var(--space-6);
    border-radius: var(--radius-xl);

    background: $surface1;
}

.actions {
    display: flex;
    gap: var(--space-3);
}
</style>
