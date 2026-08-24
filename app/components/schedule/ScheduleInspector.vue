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
            <p>Select a session to see its details and edit it.</p>
        </div>

        <template v-else>
            <header class="inspector_head">
                <!--
                    An EVENT's name is editable in place; an Offering-linked
                    Session's comes from its Offering and stays a heading. Same
                    rule the whole panel follows: no control exists where there
                    is nothing the user may change.
                -->
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
                        <!--
                            The full date, not just the weekday. "Tuesday,
                            09:00–12:15" leaves the reader to work out WHICH
                            Tuesday from the week number beside it; the date is
                            the thing they were looking for.
                        -->
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
                    <dd v-if="!canMove">{{ session.rooms.map(r => lookup.room(r.roomId)).join(', ') }}</dd>
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
                        <!--
                            The limit stated where the choice is made. The schema
                            is many-to-many, but the solver wire carries ONE
                            room_id per session, so a second room is kept here
                            and silently narrowed on the next run. Saying so is
                            the same discipline as reporting dropped equipment
                            quantities instead of quietly sending less.
                        -->
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

                <div v-if="lecturers.length">
                    <dt>{{ lecturers.length === 1 ? 'Lecturer' : 'Lecturers' }}</dt>
                    <dd>{{ lecturers.map(p => lookup.person(p.personId)).join(', ') }}</dd>
                </div>
                <div v-if="editable || attendees.length">
                    <dt>{{ attendees.length === 1 ? 'Person' : 'People' }}</dt>
                    <dd v-if="!editable">{{ attendees.map(p => lookup.person(p.personId)).join(', ') }}</dd>
                    <dd v-else>
                        <!--
                            A plain multi-select over every person in the tenant.
                            It does not scale — a real institution has thousands
                            — and the proper control is a search field, tracked
                            as its own follow-up. Shipped this way because an
                            Event nobody can be added to is a worse gap than a
                            long list.
                        -->
                        <select
                            class="inspector_rooms"
                            multiple
                            :size="Math.min(5, Math.max(3, people.length))"
                            :disabled="busy"
                            @change="onPeopleChange"
                        >
                            <option
                                v-for="person in people"
                                :key="person.id"
                                :selected="session.people.some(link => link.personId === person.id)"
                                :value="person.id"
                            >{{ person.name }}</option>
                        </select>
                        <p
                            v-if="people.length > 40"
                            class="inspector_hint"
                        >{{ people.length }} people — a searchable picker is coming.</p>
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

                <div v-else-if="session.groups.length">
                    <dt>{{ session.groups.length === 1 ? 'Group' : 'Groups' }}</dt>
                    <dd>
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
                <common-button
                    v-if="canMove"
                    :type="placing ? 'secondary-black' : 'primary'"
                    width="100%"
                    :disabled="busy || session.isLocked"
                    @click="$emit('toggle-place')"
                >{{ placing ? 'Cancel move' : 'Move…' }}</common-button>

                <p
                    v-if="canMove && session.isLocked"
                    class="inspector_hint"
                >Unlock this session before moving it.</p>

                <common-button
                    v-if="canSwap"
                    :type="swapping ? 'secondary-black' : 'secondary'"
                    width="100%"
                    :disabled="busy || session.isLocked"
                    @click="$emit('toggle-swap')"
                >{{ swapping ? 'Cancel swap' : 'Swap with…' }}</common-button>

                <p
                    v-if="swapping"
                    class="inspector_hint"
                >Now choose the session to swap places with.</p>

                <common-button
                    v-if="canLock"
                    type="secondary"
                    width="100%"
                    :disabled="busy"
                    @click="$emit('toggle-lock')"
                >{{ session.isLocked ? 'Unlock' : 'Lock in place' }}</common-button>

                <!--
                    EVENTS ONLY. An Offering-linked Session cannot be deleted —
                    its Offering's frequency would go unmet and the next solve
                    would place it again — so the action is absent rather than
                    disabled: there is no state in which pressing it would work.
                -->
                <template v-if="canDelete && session.offeringId === null">
                    <common-button
                        v-if="!confirmingDelete"
                        type="destructive"
                        width="100%"
                        :disabled="busy"
                        @click="confirmingDelete = true"
                    >Delete event</common-button>

                    <template v-else>
                        <p class="inspector_hint">
                            Delete this event? It is not backed by an offering, so nothing
                            will re-create it.
                        </p>

                        <common-button
                            type="destructive"
                            width="100%"
                            :disabled="busy"
                            @click="$emit('delete')"
                        >{{ busy ? 'Deleting…' : 'Yes, delete it' }}</common-button>

                        <common-button
                            type="secondary"
                            width="100%"
                            :disabled="busy"
                            @click="confirmingDelete = false"
                        >Keep it</common-button>
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
import { blockTime, describeViolation, formatSlotDate, sessionLabel, weekdayName } from '~/composables/schedule';
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
 * Reset whenever the SUBJECT changes, so a confirm armed on one Event cannot
 * be fired at the next one selected. Watching the id rather than the object
 * because the row is refetched after every edit and would otherwise re-arm.
 */
const locale = useViewerLocale();

/**
 * Whether THIS Session's identity may be edited here.
 *
 * Two conditions, both required. An Offering-linked Session takes its kind,
 * groups and people from its Offering and from solver output, so an edit would
 * be overwritten by the next apply — the route refuses one, and offering a
 * control the server will reject is worse than showing none.
 */
const editable = computed(() => props.canUpdate && props.session?.offeringId === null);

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

function onPeopleChange(event: Event) {
    const select = event.target as HTMLSelectElement;

    emit('set-details', { personIds: [...select.selectedOptions].map((option) => option.value) });
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
 * Sends the COMPLETE desired set every time.
 *
 * `/move` replaces `roomIds` wholesale, so emitting a single id would delete
 * every other room the session has — which is exactly how a single-select
 * control would have destroyed multi-room sessions without saying anything.
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

/**
 * `lecturer` is the ONE fixed Role key (TAXONOMY.md §2) — every other role name
 * is tenant vocabulary and must never be assumed. Matching on the key is the
 * same test `solverInput.ts` uses to build `lecturerIds`, so the panel and the
 * solver agree about who is leading a Session.
 */
const lecturers = computed(() => (props.session?.people ?? [])
    .filter((p) => p.role?.key === 'lecturer'));

/** Everyone else directly assigned — students, auditors, whatever the tenant calls them. */
const attendees = computed(() => (props.session?.people ?? [])
    .filter((p) => p.role?.key !== 'lecturer'));
</script>

<style scoped lang="scss">
.inspector {
    display: flex;
    flex-direction: column;
    gap: 18px;

    width: 320px;
    padding: 20px;
    border-radius: 10px;

    background: $surface1;

    @include mobile() {
        width: 100%;
    }

    &_empty {
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-items: center;
        justify-content: center;

        min-height: 160px;

        font-size: 13px;
        color: $surface7;
        text-align: center;

        &-icon {
            width: 22px;
            height: 22px;
            opacity: 0.7;
        }

        p { max-width: 24ch; margin: 0; }
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
        color: $surface7;
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

        color: $surface7;

        background: none;

        @include hover() {
            &:hover { color: $content5; background: $surface3; }
        }

        &:focus-visible { outline: 2px solid $primary400; }
    }

    &_facts {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 0;

        dt {
            margin-bottom: 3px;

            font-size: 11px;
            font-weight: 600;
            color: $surface7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        dd {
            margin: 0;
            font-size: 13px;
            line-height: 1.45;
            color: $content5;
        }
    }

    &_muted { color: $surface7; }

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
            color: $warning300;
            text-transform: uppercase;
            letter-spacing: 0.03em;

            svg { width: 15px; height: 15px; }
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

            h3 { color: $error300; }
        }
    }

    &_note {
        margin: 8px 0 0;
        font-size: 11.5px;
        line-height: 1.4;
        color: $surface7;
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
        color: $surface7;
    }
}
</style>
