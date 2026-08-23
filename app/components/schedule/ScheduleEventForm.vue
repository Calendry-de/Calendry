<template>
    <div
        class="evform"
        role="dialog"
        aria-modal="false"
        :aria-label="`New event on ${weekdayName(target.dayOfWeek)}`"
    >
        <header class="evform_head">
            <div>
                <h2>New event</h2>
                <p class="evform_when">
                    {{ weekdayName(target.dayOfWeek) }}, week {{ week }} ·
                    {{ blockTime(grid, target.blockIndex, target.dayOfWeek).start }}
                </p>
            </div>

            <common-button
                icon="material-symbols:close"
                type="transparent"
                @click="$emit('cancel')"
            >Cancel</common-button>
        </header>

        <!--
            An Event is a Session with no Offering. Said once, plainly, because
            the distinction decides whether this is even the right tool — and
            the alternative is a different entity entirely, not a different
            field on this form.
        -->
        <p class="evform_note">
            An event stands on its own — no recurring demand behind it. It occupies this
            room and block, and no solve will move or remove it.
            <br>
            Marking a range of DATES instead — a holiday, a break, an exam period — is
            <NuxtLink to="/manage/calendar-periods">an academic-calendar period</NuxtLink>, not an event.
        </p>

        <div class="evform_grid">
            <label class="evform_field">
                <span>Kind<i>*</i></span>
                <select
                    v-model="kindId"
                    :disabled="busy"
                >
                    <option
                        disabled
                        value=""
                    >Choose…</option>
                    <!-- `:selected` for the SSR reason ManageField documents. -->
                    <option
                        v-for="kind in kinds"
                        :key="kind.id"
                        :selected="kind.id === kindId"
                        :value="kind.id"
                    >{{ kind.name }}</option>
                </select>
            </label>

            <label class="evform_field">
                <span>Length (blocks)</span>
                <input
                    v-model.number="durationBlocks"
                    :disabled="busy"
                    :max="maxDuration"
                    min="1"
                    type="number"
                >
            </label>

            <label class="evform_field">
                <span>Room</span>
                <select
                    v-model="roomId"
                    :disabled="busy"
                >
                    <option value="">— none —</option>
                    <option
                        v-for="room in rooms"
                        :key="room.id"
                        :selected="room.id === roomId"
                        :value="room.id"
                    >{{ room.name }}</option>
                </select>
            </label>

            <label class="evform_field">
                <span>Group</span>
                <select
                    v-model="groupId"
                    :disabled="busy"
                >
                    <option value="">— none —</option>
                    <option
                        v-for="group in groups"
                        :key="group.id"
                        :selected="group.id === groupId"
                        :value="group.id"
                    >{{ group.name }}</option>
                </select>
            </label>
        </div>

        <label class="evform_lock">
            <input
                v-model="isLocked"
                :disabled="busy"
                type="checkbox"
            >
            <span>
                Locked
                <em>
                    An event is already exempt from solves because it has no offering —
                    this additionally stops a manual re-place.
                </em>
            </span>
        </label>

        <p
            v-if="error"
            class="evform_error"
            role="alert"
        >{{ error }}</p>

        <footer class="evform_foot">
            <common-button
                :disabled="!kindId || busy"
                type="primary"
                @click="submit"
            >{{ busy ? 'Creating…' : 'Create event' }}</common-button>
        </footer>
    </div>
</template>

<script setup lang="ts">
import { type TimeGrid, blockTime, weekdayName } from '~/composables/schedule';
import { useOverlay } from '~/composables/overlay';

/**
 * The create-an-Event form, opened by clicking a slot while the grid is in
 * `create` mode.
 *
 * WHY THE TARGET SLOT IS A PROP AND NOT A FIELD. Day, block and week arrive from the
 * click, so the two inputs most likely to compose a placement the grid cannot
 * hold — `blockIndex` past the end of the day, a weekday the tenant does not
 * teach — cannot be typed at all. `fitsGrid()` still guards the route, because
 * the API is reachable without this form; it is simply not the first line of
 * defence here.
 */
const props = defineProps<{
    grid: TimeGrid;
    termId: string;
    week: number;
    target: { dayOfWeek: number; blockIndex: number };
    rooms: { id: string; name: string }[];
    groups: { id: string; name: string }[];
}>();

const emit = defineEmits<{ cancel: []; created: [] }>();

/**
 * Claiming the keyboard makes the page's own Escape handler stand down — which
 * is correct (it would otherwise cancel create mode out from under this form)
 * but leaves Escape doing NOTHING unless the claimant handles it. The claim is
 * a transfer of the key, not a suppression of it.
 */
const { claim, release } = useOverlay('schedule-event-form');

function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && !busy.value) {
        emit('cancel');
    }
}

onMounted(() => {
    claim();
    window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
    release();
    window.removeEventListener('keydown', onKey);
});

const kinds = ref<{ id: string; name: string }[]>([]);
const kindId = ref('');
const roomId = ref('');
const groupId = ref('');
const durationBlocks = ref(1);
const isLocked = ref(true);
const busy = ref(false);
const error = ref('');

/** A Session may not run past the end of the day; the same rule `fitsGrid` applies. */
const maxDuration = computed(() => Math.max(1, props.grid.blocksPerDay - props.target.blockIndex));

/**
 * Kinds are fetched here rather than threaded through the page's async data:
 * this form only ever exists after a click, so there is no SSR pass to keep
 * consistent, and adding a fetch to every schedule render to serve a panel
 * most visits never open would be the wrong trade.
 */
onMounted(async () => {
    try {
        const res = await $fetch<{ rows: { id: string; name: string }[] }>('/api/session-kinds', {
            query: { limit: 200 },
        });

        kinds.value = res.rows ?? [];
        kindId.value = kinds.value[0]?.id ?? '';
    } catch {
        error.value = 'Could not load session kinds.';
    }
});

async function submit() {
    if (!kindId.value || busy.value) {
        return;
    }

    busy.value = true;
    error.value = '';

    try {
        await $fetch('/api/sessions', {
            method: 'POST',
            body: {
                termId: props.termId,
                kindId: kindId.value,
                termWeek: props.week,
                dayOfWeek: props.target.dayOfWeek,
                blockIndex: props.target.blockIndex,
                durationBlocks: durationBlocks.value,
                isLocked: isLocked.value,
                ...(roomId.value ? { roomIds: [roomId.value] } : {}),
                ...(groupId.value ? { groupIds: [groupId.value] } : {}),
            },
        });

        emit('created');
    } catch (caught: unknown) {
        const data = (caught as { data?: { statusMessage?: string; message?: string } }).data;

        /*
         * The server's message names the grid and its real shape — "…is not a
         * slot in 'Standard week', which has 3 blocks on days 1, 2, 3, 4, 5, 6".
         * Shown inline beside the controls rather than as a toast, because it
         * is a correction to what is on screen, not a notification about
         * something that happened elsewhere.
         */
        error.value = data?.statusMessage ?? data?.message ?? 'Could not create the event.';
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped lang="scss">
.evform {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);

    padding: var(--space-6);
    border-radius: var(--radius-lg);

    background: $surface1;

    &_head {
        display: flex;
        gap: var(--space-4);
        align-items: flex-start;
        justify-content: space-between;

        h2 {
            margin: 0;
            font-size: var(--font-size-lg);
        }
    }

    &_when {
        margin: var(--space-1) 0 0;
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content6;
    }

    &_note {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content6;
    }

    &_grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
        gap: var(--space-5);
    }

    &_field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        font-size: var(--font-size-sm);

        i {
            font-style: normal;
            color: $primary400;
        }

        select,
        input {
            padding: var(--space-4);
            border: 1px solid $surface5;
            border-radius: var(--radius-md);

            font: inherit;
            color: inherit;

            background: $surface0;
        }
    }

    &_lock {
        display: flex;
        gap: var(--space-4);
        align-items: flex-start;
        font-size: var(--font-size-sm);

        em {
            display: block;
            font-size: var(--font-size-xs);
            font-style: normal;
            color: $content6;
        }
    }

    &_error {
        margin: 0;
        padding: var(--space-4);
        border-radius: var(--radius-md);

        font-size: var(--font-size-sm);
        color: $content6;

        background: rgb(179 38 30 / 12%);
    }

    &_foot {
        display: flex;
        justify-content: flex-end;
    }
}
</style>
