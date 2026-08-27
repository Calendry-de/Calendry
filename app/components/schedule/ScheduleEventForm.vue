<template>
    <div
        ref="root"
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
            <label class="evform_field evform_field--wide">
                <span>Name<i>*</i></span>
                <input
                    ref="titleInput"
                    v-model="title"
                    :disabled="busy"
                    maxlength="200"
                    placeholder="Open day, exam sitting, staff meeting…"
                    type="text"
                >
            </label>

            <label class="evform_field">
                <span>Kind<i>*</i></span>
                <select
                    v-if="kinds.length"
                    v-model="kindId"
                    :disabled="busy"
                >
                    <option
                        disabled
                        value=""
                    >Choose…</option>
                    <option
                        v-for="kind in kinds"
                        :key="kind.id"
                        :selected="kind.id === kindId"
                        :value="kind.id"
                    >{{ kind.name }}</option>
                </select>

                <!--
                    An empty list is not an empty control. `kindId` is required by
                    the route, so with no kinds this form cannot be completed at
                    all — and a select holding only "Choose…" says that as a dead
                    end rather than as a reason. The two causes are worth telling
                    apart, because only one of them is the reader's to fix.
                -->
                <p
                    v-else
                    class="evform_blocked"
                >
                    {{ kindsReadable
                        ? 'This tenant has no session kinds yet. One is required, and they are managed under Session kinds.'
                        : 'Session kinds could not be read, and an event needs one. Ask for the session-kind read permission.' }}
                </p>
            </label>

            <label class="evform_field">
                <span>Length (blocks)</span>
                <input
                    v-model.number="durationBlocks"
                    :disabled="busy"
                    :max="maxDuration"
                    min="1"
                    type="number"
                    @change="clampDuration"
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

            <!--
                THE SAME control the Offering page uses, not a second one.

                `ManageRelationPicker` is already standalone and already
                decoupled from persistence — it renders `rows`/`options` and
                emits add/remove, while its usual parent does the saving. So it
                works unchanged against draft state here, and the Events form
                gains the indented group tree: a flat <select multiple> gave no
                hint that picking a cohort implies its seminars.

                A second group picker is exactly the drift ManageWeekdayPicker's
                extraction existed to prevent.
            -->
            <div class="evform_field evform_field--wide">
                <ManageRelationPicker
                    :def="groupRelation"
                    :rows="groupRows"
                    :options="groups"
                    :extra-options="[]"
                    :readonly="busy"
                    @add="addGroup"
                    @remove="removeGroup"
                />
            </div>
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
                :disabled="!kinds.length || !kindId || !title.trim() || busy"
                type="primary"
                @click="submit"
            >{{ busy ? 'Creating…' : 'Create event' }}</common-button>
        </footer>
    </div>
</template>

<script setup lang="ts">
import { type TimeGrid, blockTime, weekdayName } from '~/composables/schedule';
import { useOverlay } from '~/composables/overlay';
import ManageRelationPicker from '~/components/manage/ManageRelationPicker.vue';
import type { RelationDef } from '~/utils/manageRegistry';

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
    /**
     * From the page's own reference wave, not fetched again here. This form used
     * to fetch `/api/session-kinds` on mount, with a comment arguing the page
     * should not pay for a panel most visits never open — true when it was
     * written, false since the inspector's kind picker made the page fetch them
     * anyway. So it was one extra request per open AND a second failure path:
     * the page degrades to an empty list, the form said "Could not load session
     * kinds", and the two could disagree about the same fact.
     */
    kinds: { id: string; name: string }[];
    /** Whether an empty `kinds` means "none configured" or "not readable". */
    kindsReadable: boolean;
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

const titleInput = ref<HTMLInputElement | null>(null);

/**
 * THE FORM IS SCROLLED TO, THEN FOCUSED — in that order, and both are needed.
 *
 * It renders BELOW the week grid, which is 600–810px tall depending on density,
 * so "press Add event, click a slot" put it off the bottom of the viewport with
 * nothing moving: measured 92px below the fold at Comfortable and 297px at
 * Spacious. Pressing a cell looked like nothing had happened.
 *
 * `focus()` alone does scroll, but only MINIMALLY — just enough to reveal the
 * input, which leaves the header above it (`New event · Monday, week 1 · 08:00`)
 * at or past the top edge. That header is the only thing naming the slot that was
 * clicked, so it is the part that must be on screen. Hence an explicit scroll to
 * the form, then `preventScroll` on the focus so the two do not fight.
 *
 * Handing focus BACK is the page's job, not this form's — the element that opened
 * it is a grid cell that becomes `disabled` the moment create mode ends, so a
 * captured reference here would be connected, unfocusable, and silently do
 * nothing. Only the page knows a control that still exists afterwards.
 */
const root = ref<HTMLElement | null>(null);

onMounted(() => {
    claim();
    window.addEventListener('keydown', onKey);

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const box = root.value?.getBoundingClientRect();

    /*
     * `center` while the form FITS, `start` once it does not. Centring a form
     * taller than the viewport puts its top edge above zero — at 390×667 that is
     * the header 46px off-screen, which is the one part that must stay: it names
     * the slot the click chose. Aligning to the top guarantees it at any height,
     * and centring keeps the form connected to the grid it came from when there
     * is room for both.
     */
    root.value?.scrollIntoView({
        behavior: still ? 'auto' : 'smooth',
        block: box && box.height > window.innerHeight ? 'start' : 'center',
    });
    titleInput.value?.focus({ preventScroll: true });
});

onBeforeUnmount(() => {
    release();
    window.removeEventListener('keydown', onKey);
});

const kinds = computed(() => props.kinds);
const kindId = ref(props.kinds[0]?.id ?? '');
const roomId = ref('');
const title = ref('');
const groupIds = ref<string[]>([]);

/**
 * The picker's contract: a relation DEFINITION plus the current rows.
 *
 * Built inline rather than imported from the manage registry, because that
 * entry describes the Offering's relation — its `scopeBy` narrows options by
 * the Offering's own `termId`, which this form does not have and does not need
 * (the page already hands it groups for the term in view). Sharing the
 * COMPONENT is the point; sharing a config written for a different parent would
 * couple two screens that have no reason to move together.
 */
const groupRelation: RelationDef = {
    key: 'groups',
    label: 'Groups',
    help: 'Nesting propagates: choosing a cohort also covers its seminars.',
    resource: 'groups',
    valueKey: 'groupId',
    indentTree: true,
    optionLabel: (row) => String(row.name),
    emptyHint: 'No groups available in this term.',
};

/** The picker reads join-shaped rows; the draft holds plain ids. */
const groupRows = computed(() => groupIds.value.map((groupId) => ({ groupId })));

const addGroup = (value: string) => {
    if (!groupIds.value.includes(value)) {
        groupIds.value = [...groupIds.value, value];
    }
};

const removeGroup = (value: string) => {
    groupIds.value = groupIds.value.filter((id) => id !== value);
};
const durationBlocks = ref(1);
const isLocked = ref(true);
const busy = ref(false);
const error = ref('');

/** A Session may not run past the end of the day; the same rule `fitsGrid` applies. */
const maxDuration = computed(() => Math.max(1, props.grid.blocksPerDay - props.target.blockIndex));

/**
 * `max` on a number input is advertised, not enforced — a typed 9 submits, and
 * `fitsGrid` then refuses it with a 400 the reader has to read to discover a
 * limit the control already knew. Clamped on commit rather than on every
 * keystroke, so typing "12" on the way to "1" is not fought.
 */
function clampDuration() {
    const value = Math.trunc(Number(durationBlocks.value));

    durationBlocks.value = Number.isFinite(value)
        ? Math.min(maxDuration.value, Math.max(1, value))
        : 1;
}

async function submit() {
    // Name is required — an Event has no Offering to borrow one from, and the
    // server refuses it too.
    if (!kindId.value || !title.value.trim() || busy.value) {
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
                title: title.value.trim(),
                termWeek: props.week,
                dayOfWeek: props.target.dayOfWeek,
                blockIndex: props.target.blockIndex,
                durationBlocks: durationBlocks.value,
                isLocked: isLocked.value,
                ...(roomId.value ? { roomIds: [roomId.value] } : {}),
                ...(groupIds.value.length ? { groupIds: groupIds.value } : {}),
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
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--space-4);

        h2 {
            margin: 0;
            font-size: var(--font-size-lg);
        }
    }

    &_when {
        margin: var(--space-1) 0 0;
        color: $content6;
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
    }

    &_note {
        margin: 0;
        color: $content6;
        font-size: var(--font-size-sm);
        line-height: 1.5;
    }

    // Where a control would have been, so the gap reads as an explanation rather
    // than as a field that failed to render.
    &_blocked {
        margin: 0;
        padding: var(--space-4) var(--space-5);
        border: 1px dashed $surface5;
        border-radius: var(--radius-md);
        color: $content6;

        font-size: var(--font-size-xs);
        line-height: 1.45;
    }

    &_grid {
        display: grid;
        gap: var(--space-5);
        grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    }

    &_field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        font-size: var(--font-size-sm);

        i {
            color: $primary400;
            font-style: normal;
        }

        select,
        input {
            padding: var(--space-4);
            border: 1px solid $surface5;
            border-radius: var(--radius-md);

            background: $surface0;
            color: inherit;

            font: inherit;
        }
    }

    &_field--wide {
        grid-column: 1 / -1;
    }

    &_multi-hint {
        color: $content6;
        font-size: var(--font-size-xs);
        font-style: normal;
    }

    &_lock {
        display: flex;
        align-items: flex-start;
        gap: var(--space-4);
        font-size: var(--font-size-sm);

        em {
            display: block;
            color: $content6;
            font-size: var(--font-size-xs);
            font-style: normal;
        }
    }

    &_error {
        margin: 0;
        padding: var(--space-4);
        border-radius: var(--radius-md);

        background: rgb(179 38 30 / 12%);
        color: $content6;

        font-size: var(--font-size-sm);
    }

    &_foot {
        display: flex;
        justify-content: flex-end;
    }
}
</style>
