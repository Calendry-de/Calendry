<template>
    <aside
        class="inspector"
        :class="{ 'inspector--open': !!session }"
        aria-label="Session details"
    >
        <div
            v-if="!session"
            class="inspector_empty"
        >
            <Icon
                name="material-symbols:ads-click"
                class="inspector_empty-icon"
                aria-hidden="true"
            />
            <p>{{ canMove || canUpdate ? 'Select a session to see its details and edit it' : 'Select a session to see its details' }}.</p>
        </div>

        <template v-else>
            <header class="inspector_head">
                <!-- An EVENT's name is editable in place; an Offering-linked
                     Session's comes from its Offering. No control exists where
                     there is nothing the user may change. -->
                <input
                    v-if="editable"
                    class="inspector_title inspector_title--edit"
                    :disabled="busy"
                    maxlength="200"
                    :value="session.title ?? ''"
                    @change="$emit('set-details', { title: ($event.target as HTMLInputElement).value })"
                >
                <h2
                    v-else
                    class="inspector_title"
                >{{ sessionLabel(session) }}</h2>
                <p class="inspector_sub">
                    {{ session.offering?.code ? `${session.offering.code} · ` : '' }}{{ session.kind?.name }}
                </p>
                <button
                    type="button"
                    class="inspector_close"
                    aria-label="Close details"
                    @click="$emit('close')"
                >
                    <Icon
                        name="material-symbols:close"
                        aria-hidden="true"
                    />
                </button>
            </header>

            <dl class="inspector_facts">
                <div>
                    <dt>When</dt>
                    <dd>
                        <!-- The full date: "Tuesday, 09:00–12:15" leaves the
                             reader to work out WHICH Tuesday. -->
                        <template v-if="sessionDate">
                            {{ formatSlotDate(sessionDate, locale, 'full') }},
                        </template>
                        <template v-else>
                            {{ weekdayName(session.dayOfWeek, locale) }},
                        </template>
                        {{ blockTime(grid, session.blockIndex, session.dayOfWeek).start }}–{{
                            blockTime(grid, endBlock, session.dayOfWeek).end }}
                        <span class="inspector_muted">· week {{ session.termWeek }}</span>
                    </dd>
                </div>
                <div v-if="canMove || session.rooms.length">
                    <dt>{{ session.rooms.length === 1 ? 'Room' : 'Rooms' }}</dt>
                    <!-- Read-only renders as TEXT, not a disabled control: a
                         disabled select reads as "unavailable right now"
                         rather than "not yours to change". -->
                    <dd v-if="!canMove">{{ roomNames }}</dd>
                    <dd v-else>
                        <select
                            class="inspector_rooms"
                            multiple
                            :size="Math.min(5, Math.max(3, rooms.length))"
                            :disabled="busy"
                            @change="onRoomsChange"
                        >
                            <option
                                v-for="room in rooms"
                                :key="room.id"
                                :value="room.id"
                                :selected="session.rooms.some(r => r.roomId === room.id)"
                            >{{ room.name }}</option>
                        </select>
                        <!-- The limit stated where the choice is made: the
                             schema is many-to-many but the solver wire carries
                             ONE room_id, so a second room is silently narrowed
                             on the next run. -->
                        <p
                            v-if="session.rooms.length > 1"
                            class="inspector_hint"
                        >The solver places a session in one room — the extras are kept here but not sent to it.</p>
                    </dd>
                </div>
                <div v-if="editable || session.kind">
                    <dt>Kind</dt>
                    <dd v-if="!editable">{{ session.kind?.name ?? '—' }}</dd>
                    <dd v-else>
                        <select
                            class="inspector_control"
                            :disabled="busy"
                            @change="$emit('set-details', { kindId: ($event.target as HTMLSelectElement).value })"
                        >
                            <!-- `:selected`, not `:value` on the select: a
                                 select's value is a property, so SSR drops it. -->
                            <option
                                v-for="k in kinds"
                                :key="k.id"
                                :selected="k.id === session.kindId"
                                :value="k.id"
                            >{{ k.name }}</option>
                        </select>
                    </dd>
                </div>

                <!--
                    ALWAYS RENDERED, even when empty: a row that disappears makes
                    "no lecturer is assigned" indistinguishable from "this panel
                    does not track lecturers", and only the first is a defect
                    somebody needs to see.
                -->
                <div>
                    <dt>{{ lecturers.length === 1 ? 'Lecturer' : 'Lecturers' }}</dt>
                    <dd v-if="lecturers.length">{{ lecturerNames }}</dd>
                    <dd
                        v-else
                        class="inspector_muted"
                    >Nobody assigned</dd>
                </div>
                <div>
                    <dt>{{ attendees.length === 1 ? 'Person' : 'People' }}</dt>
                    <dd
                        v-if="!editable && !attendees.length"
                        class="inspector_muted"
                    >Nobody assigned individually</dd>
                    <dd v-else-if="!editable">{{ attendeeNames }}</dd>
                    <dd v-else>
                        <!--
                            The SAME picker as groups. It replaced a
                            `<select multiple>`, where the selection was only
                            legible by scanning for highlighted rows and a stray
                            plain click silently cleared every other person. The
                            list is still every person in the tenant — a search
                            field is tracked separately.
                        -->
                        <ManageRelationPicker
                            :def="personRelation"
                            :rows="session.people"
                            :options="people"
                            :extra-options="[]"
                            :readonly="busy"
                            @add="onPersonAdd"
                            @remove="onPersonRemove"
                        />
                    </dd>
                </div>
                <div v-if="editable">
                    <dt>{{ session.groups.length === 1 ? 'Group' : 'Groups' }}</dt>
                    <dd>
                        <!-- The SAME picker the Offering page and the Event
                             creation form use. Its third consumer, and the
                             reason it was reused rather than reimplemented. -->
                        <ManageRelationPicker
                            :def="groupRelation"
                            :rows="session.groups"
                            :options="groups"
                            :extra-options="[]"
                            :readonly="busy"
                            @add="onGroupAdd"
                            @remove="onGroupRemove"
                        />
                    </dd>
                </div>

                <div v-else>
                    <dt>{{ session.groups.length === 1 ? 'Group' : 'Groups' }}</dt>
                    <dd
                        v-if="!session.groups.length"
                        class="inspector_muted"
                    >No group attends this</dd>
                    <dd v-else>
                        <!-- One level of ancestry, muted: "Seminar A1" alone is
                             ambiguous across cohorts, and the nesting is what
                             explains why a clash propagates. -->
                        <span
                            v-for="(g, i) in session.groups"
                            :key="g.groupId"
                        >{{ i ? ', ' : '' }}{{ lookup.group(g.groupId)
                        }}<span
                            v-if="lookup.groupParent(g.groupId)"
                            class="inspector_muted"
                        > · under {{ lookup.groupParent(g.groupId) }}</span></span>
                    </dd>
                </div>
            </dl>

            <section
                v-if="violations.length"
                class="inspector_violations"
                :class="`inspector_violations--${worst}`"
            >
                <h3>
                    <Icon
                        :name="worst === 'hard' ? 'material-symbols:error' : 'material-symbols:warning-outline'"
                        aria-hidden="true"
                    />
                    {{ violations.length }} violation{{ violations.length === 1 ? '' : 's' }}
                </h3>
                <ul>
                    <li
                        v-for="violation in violations"
                        :key="violation.id"
                    >
                        {{ describeViolation(violation, lookup) }}
                        <span class="inspector_muted">— {{ violation.constraint.name }}</span>
                    </li>
                </ul>
                <p class="inspector_note">
                    Recorded, not blocking. The edit that caused this was allowed.
                </p>
            </section>

            <div class="inspector_actions">
                <CommonButton
                    v-if="canMove"
                    :type="placing ? 'secondary-black' : 'primary'"
                    width="100%"
                    :disabled="busy || session.isLocked"
                    @click="$emit('toggle-place')"
                >{{ placing ? 'Cancel move' : 'Move…' }}</CommonButton>

                <p
                    v-if="canMove && session.isLocked"
                    class="inspector_hint"
                >Unlock this session before moving it.</p>

                <CommonButton
                    v-if="canSwap"
                    :type="swapping ? 'secondary-black' : 'secondary'"
                    width="100%"
                    :disabled="busy || session.isLocked"
                    @click="$emit('toggle-swap')"
                >{{ swapping ? 'Cancel swap' : 'Swap with…' }}</CommonButton>

                <p
                    v-if="swapping"
                    class="inspector_hint"
                >Now choose the session to swap places with.</p>

                <CommonButton
                    v-if="canLock"
                    type="secondary"
                    width="100%"
                    :disabled="busy"
                    @click="$emit('toggle-lock')"
                >{{ session.isLocked ? 'Unlock' : 'Lock in place' }}</CommonButton>

                <!--
                    EVENTS ONLY. An Offering-linked Session cannot be deleted —
                    its Offering's frequency would go unmet and the next solve
                    would place it again — so the action is absent rather than
                    disabled.
                -->
                <template v-if="canDelete && session.offeringId === null">
                    <CommonButton
                        v-if="!confirmingDelete"
                        type="destructive"
                        width="100%"
                        :disabled="busy"
                        @click="confirmingDelete = true"
                    >Delete event</CommonButton>

                    <template v-else>
                        <p class="inspector_hint">
                            Delete this event? It is not backed by an offering, so nothing
                            will re-create it.
                        </p>

                        <CommonButton
                            type="destructive"
                            width="100%"
                            :disabled="busy"
                            @click="$emit('delete')"
                        >{{ busy ? 'Deleting…' : 'Yes, delete it' }}</CommonButton>

                        <CommonButton
                            type="secondary"
                            width="100%"
                            :disabled="busy"
                            @click="confirmingDelete = false"
                        >Keep it</CommonButton>
                    </template>
                </template>

                <p
                    v-if="!canMove && !canLock && !canDelete"
                    class="inspector_hint"
                >You have view-only access to this schedule.</p>
            </div>
        </template>
    </aside>
</template>

<script setup lang="ts">
import type { ScheduleSession, TimeGrid, Violation } from '~/composables/schedule';
import {
    attendeesOf, blockTime, describeViolation, formatSlotDate,
    lecturersOf, sessionLabel, weekdayName,
} from '~/composables/schedule';
import { useViewerLocale } from '~/composables/locale';
import ManageRelationPicker from '~/components/manage/ManageRelationPicker.vue';
import type { RelationDef } from '~/utils/manageRegistry';

const props = defineProps<{
    session: ScheduleSession | null;
    grid: TimeGrid;
    violations: Violation[];
    canMove: boolean;
    canLock: boolean;
    canSwap: boolean;
    canDelete: boolean;
    canUpdate: boolean;
    /** Calendar date of this Session's slot; null before a term resolves. */
    sessionDate: Date | null;
    /** Tenant vocabulary, for the kind picker. */
    kinds: { id: string; name: string }[];
    /** Everyone in the tenant, for the people picker. */
    people: { id: string; name: string }[];
    /** Groups available in this term, for the group picker. */
    groups: { id: string; name: string; parentGroupId: string | null }[];
    placing: boolean;
    swapping: boolean;
    busy: boolean;
    /** Every room the tenant has, for the picker. */
    rooms: { id: string; name: string }[];
    lookup: {
        room: (id: string) => string;
        person: (id: string) => string;
        group: (id: string) => string;
        /** Immediate parent's name, or null for a root group. */
        groupParent: (id: string) => string | null;
    };
}>();

/**
 * Reset whenever the SUBJECT changes, so a confirm armed on one Event cannot fire
 * at the next. Watching the id, not the object: the row is refetched after every
 * edit and would otherwise re-arm.
 */
const locale = useViewerLocale();

/**
 * An Offering-linked Session takes its kind, groups and people from its Offering
 * and from solver output, so the route refuses an edit — and offering a control
 * the server will reject is worse than showing none.
 */
const editable = computed(() => props.canUpdate && props.session?.offeringId === null);

const personRelation: RelationDef = {
    key: 'people',
    label: 'People',
    help: 'Individuals attending in their own right, beyond whole groups.',
    resource: 'persons',
    valueKey: 'personId',
    // People are a flat list, not a hierarchy — the one difference from groups.
    optionLabel: (row) => String(row.name),
    emptyHint: 'No people in this institution yet.',
};

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

/** Each control sends the WHOLE set it owns, matching how rooms already save. */
function onGroupAdd(value: string) {
    const next = [...(props.session?.groups ?? []).map((g) => g.groupId), value];

    emit('set-details', { groupIds: [...new Set(next)] });
}

function onGroupRemove(value: string) {
    const next = (props.session?.groups ?? []).map((g) => g.groupId).filter((id) => id !== value);

    emit('set-details', { groupIds: next });
}

/** Same shape as groups: the whole set is sent, so removal needs no own path. */
function onPersonAdd(value: string) {
    const next = [...(props.session?.people ?? []).map((p) => p.personId), value];

    emit('set-details', { personIds: [...new Set(next)] });
}

function onPersonRemove(value: string) {
    const next = (props.session?.people ?? []).map((p) => p.personId).filter((id) => id !== value);

    emit('set-details', { personIds: next });
}

const confirmingDelete = ref(false);

watch(() => props.session?.id, () => {
    confirmingDelete.value = false;
});

const emit = defineEmits<{
    close: [];
    'toggle-place': [];
    'toggle-swap': [];
    'toggle-lock': [];
    delete: [];
    /** A partial edit of what this Event IS; one request per control. */
    'set-details': [patch: Record<string, unknown>];
    'set-rooms': [roomIds: string[]];
}>();

/**
 * The COMPLETE desired set: `/move` replaces `roomIds` wholesale, so emitting a
 * single id would delete every other room the session has.
 */
function onRoomsChange(event: Event) {
    const select = event.target as HTMLSelectElement;

    emit('set-rooms', [...select.selectedOptions].map((option) => option.value));
}

/** Last block the session occupies, so the end time reflects its duration. */
const endBlock = computed(() => (props.session
    ? props.session.blockIndex + props.session.durationBlocks - 1
    : 0));

const worst = computed(() => (props.violations.some((v) => v.severity === 'HARD') ? 'hard' : 'soft'));

// The split lives in `composables/schedule.ts` — see `LECTURER_ROLE_KEY` for
// why it is one definition and not a string literal per component.
const lecturers = computed(() => lecturersOf(props.session?.people ?? []));
const attendees = computed(() => attendeesOf(props.session?.people ?? []));

/*
 * The read-only renderings, resolved here rather than in the template.
 *
 * Each was a `.map().join()` inside an interpolation, so it rebuilt an array and
 * a string on every render of a panel that re-renders on every selection — and
 * the name resolution it does is a lookup per row. As computeds they resolve once
 * per change of the thing they describe.
 */
const roomNames = computed(() => (props.session?.rooms ?? [])
    .map((row) => props.lookup.room(row.roomId)).join(', '));
const lecturerNames = computed(() => lecturers.value
    .map((row) => props.lookup.person(row.personId)).join(', '));
const attendeeNames = computed(() => attendees.value
    .map((row) => props.lookup.person(row.personId)).join(', '));
</script>

<style scoped lang="scss">
.inspector {
    /*
     * SIZED, NOT RESERVED. A flat `width: 320px` was held whether or not anything
     * was selected — a third of a 1440px screen for a panel that is empty most of
     * the time, crushing the day columns to ~46px of text each. It now asks for a
     * comfortable measure and yields, and the empty state shrinks it further.
     */
    display: flex;
    flex-direction: column;

    /* One 18px interval across ~8 sections gave every section equal weight.
       `--space-6` between them, tighter intervals inside doing the grouping. */
    gap: var(--space-6);

    width: clamp(240px, 24vw, 300px);
    padding: var(--space-6);
    border-radius: var(--radius-xl);

    background: $surface1;

    @include mobile() {
        width: 100%;
    }

    /* Nothing selected: a prompt, not a panel. It keeps a presence — a column
       that vanishes and returns makes the grid jump on every selection — but
       stops claiming a reading width for one sentence. */
    &:has(.inspector_empty) {
        width: clamp(180px, 16vw, 220px);
        border: 1px dashed $surface5;
        background: none;
    }

    &_empty {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        align-items: center;
        justify-content: center;

        min-height: 160px;

        font-size: 13px;
        color: $content7;
        text-align: center;

        &-icon {
            width: 22px;
            height: 22px;
            opacity: 0.7;
        }

        p {
            max-width: 24ch;
            margin: 0;
        }
    }

    &_head {
        position: relative;
        padding-right: 28px;
    }

    &_title {
        margin: 0;

        font-size: 17px;
        font-weight: 650;
        line-height: 1.25;
        color: $content2;
    }

    &_sub {
        margin: 4px 0 0;
        font-size: 12px;
        color: $content7;
    }

    &_close {
        cursor: pointer;

        position: absolute;
        top: -4px;
        right: -4px;

        display: flex;

        padding: 4px;
        border: 0;
        border-radius: 6px;

        color: $content7;

        background: none;

        /*
         * The MARK stays 24px; the TARGET reaches 44px. A panel corner cannot
         * carry a 44px visible button without becoming the loudest thing in a
         * panel it only dismisses, so the hit area is grown past the box instead.
         */
        &::after {
            content: '';
            position: absolute;
            inset: -12px;
        }

        &:focus-visible { outline: 2px solid $primary400; }

        @include hover() {
            &:hover {
                color: $content5;
                background: $surface3;
            }
        }
    }

    &_facts {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 0;

        dt {
            margin-bottom: var(--space-1);

            font-size: var(--font-size-xs);
            font-weight: 600;
            color: $content7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        dd {
            /*
             * Every value here is user-supplied, inside a column that cannot grow
             * to fit it, so an unbroken string overflows the panel horizontally.
             * `overflow-wrap` breaks only where nothing else can; `min-width: 0`
             * lets the value shrink inside its flex parent.
             */
            min-width: 0;
            margin: 0;

            font-size: var(--font-size-md);
            line-height: 1.45;
            color: $content5;
            overflow-wrap: break-word;
        }
    }

    &_muted { color: $content7; }

    /* Editable fields on an Event. Read-only Sessions render text instead, so
       these never appear where nothing may change. */
    &_control {
        width: 100%;
        padding: 4px 6px;
        border: 1px solid $surface5;
        border-radius: 6px;

        font: inherit;
        color: inherit;

        background: $surface0;
    }

    /* The title edits in place: it looks like the heading it replaces until
       the pointer or focus lands on it. */
    &_title--edit {
        width: 100%;
        padding: 2px 4px;
        border: 1px solid transparent;
        border-radius: 6px;

        font: inherit;
        color: inherit;

        background: transparent;

        &:hover,
        &:focus {
            border-color: $surface5;
            background: $surface0;
        }
    }

    &_violations {
        padding: 12px;
        border-radius: 8px;
        background: rgb(169, 125, 45, 0.14);

        h3 {
            display: flex;
            gap: 6px;
            align-items: center;

            margin: 0 0 8px;

            font-size: 12px;
            font-weight: 650;
            color: $warning700;
            text-transform: uppercase;
            letter-spacing: 0.03em;

            svg {
                width: 15px;
                height: 15px;
            }
        }

        ul {
            display: flex;
            flex-direction: column;
            gap: 6px;

            margin: 0;
            padding-left: 16px;

            font-size: 12.5px;
            line-height: 1.45;
            color: $content5;
        }

        &--hard {
            background: rgb(169, 45, 70, 0.16);

            h3 { color: $error700; }
        }
    }

    &_note {
        margin: 8px 0 0;
        font-size: 11.5px;
        line-height: 1.4;
        color: $content7;
    }

    &_actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: auto;
    }

    &_hint {
        margin: 0;
        font-size: 11.5px;
        line-height: 1.4;
        color: $content7;
    }
}
</style>
