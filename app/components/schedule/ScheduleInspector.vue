<template>
    <!--
        `tabindex="-1"` and the data attribute exist for ONE caller: the page
        restores focus here after an edit whose subject left the view, so a
        keyboard user lands on the panel that still describes what they changed
        rather than on `<body>`. Not in the tab order (-1 is programmatic focus
        only), and already named, so it announces as a region on arrival.
    -->
    <aside
        class="inspector"
        :class="{ 'inspector--open': !!session }"
        aria-label="Session details"
        tabindex="-1"
        data-inspector-root
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
                    <!-- BANKED (issue #22): cancelled, still owed, nowhere to
                         sit. `placedSession` is null exactly then, so nothing
                         below reads the placement fields without it. -->
                    <dd v-if="!placedSession">
                        In the spare bank, not currently placed.
                    </dd>
                    <dd v-else>
                        <!-- The full date: "Tuesday, 09:00–12:15" leaves the
                             reader to work out WHICH Tuesday. -->
                        <template v-if="sessionDate">
                            {{ formatSlotDate(sessionDate, locale, 'full') }},
                        </template>
                        <template v-else>
                            {{ weekdayName(placedSession.dayOfWeek, locale) }},
                        </template>
                        {{ blockTime(grid, placedSession.blockIndex, placedSession.dayOfWeek).start }}–{{
                            blockTime(grid, endBlock, placedSession.dayOfWeek).end }}
                        <span class="inspector_muted">· week {{ placedSession.termWeek }}</span>
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
                        >The solver places a session in one room; the extras are kept here but not sent to it.</p>
                    </dd>
                </div>
                <div v-if="editable || session.kind">
                    <dt>Kind</dt>
                    <dd v-if="!editable">{{ session.kind?.name ?? 'None' }}</dd>
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
                    <dd v-if="!lecturerEditable && lecturers.length">{{ lecturerNames }}</dd>
                    <dd
                        v-else-if="!lecturerEditable"
                        class="inspector_muted"
                    >Nobody assigned</dd>
                    <dd v-else>
                        <ManageRelationPicker
                            :def="lecturerRelation"
                            :rows="lecturers"
                            :options="people"
                            :extra-options="[]"
                            :readonly="busy"
                            @add="onLecturerAdd"
                            @remove="onLecturerRemove"
                        />
                    </dd>
                    <!--
                        THE PRECONDITION, STATED RATHER THAN LEFT TO A FAILED
                        REQUEST. A control that is simply absent reads as "this
                        cannot be edited"; this session's lecturer CAN be, one
                        click away, and the hint is what makes that click
                        findable instead of a guess.
                    -->
                    <p
                        v-if="canAssignLecturer && !lecturerEditable && session?.offeringId !== null"
                        class="inspector_hint"
                    >Lock this session to override who teaches it, otherwise the next solve
                        would silently replace your choice.</p>
                </div>

                <!--
                    Substitutions / Vertretungen (issue #30). Rendered whenever
                    THERE IS SOMETHING TO SHOW (an active substitute) OR the
                    caller may create one, so a substitute reading their own
                    timetable sees who is covering it even without
                    `session.substitute`, and a viewer with neither sees nothing
                    rather than an inert "None assigned" row for a feature they
                    cannot use.

                    A SEPARATE FACT FROM "Lecturer" ABOVE ON PURPOSE: the
                    original assignment is untouched by a substitution, so the
                    two rows can, and often will, disagree, and that
                    disagreement IS the information this row exists to show.
                -->
                <div v-if="session.substitution || canSubstitute">
                    <dt>Substituted</dt>
                    <dd v-if="!canSubstitute">{{ lookup.person(session.substitution!.coveringPersonId) }}</dd>

                    <!--
                        NO SUBSTITUTE IS THE NORMAL STATE, so the resting view is
                        a sentence and a button, not an open form. This used to
                        render the picker unconditionally, which put a "Nobody is
                        covering this session." advisory and an empty search box
                        under every session on the board: on a panel that also
                        says "Lecturer: Dozent S" two rows above, that read as a
                        contradiction (as though the class had nobody teaching
                        it) rather than as "there is no Vertretung today", which
                        is true of almost every session almost every week.

                        The button is the declaration. A person is only asked for
                        once somebody has said there IS a substitution, which is
                        also the order the decision is actually made in.
                    -->
                    <dd
                        v-else-if="!session.substitution && !addingSubstitute"
                        class="inspector_cover"
                    >
                        <span class="inspector_muted">{{ coverRestingLabel }}</span>
                        <CommonButton
                            type="secondary"
                            size="S"
                            :disabled="busy"
                            @click="addingSubstitute = true"
                        >Add a substitute</CommonButton>
                    </dd>

                    <dd v-else>
                        <ManageRelationPicker
                            :def="substituteRelation"
                            :rows="substituteRows"
                            :options="people"
                            :extra-options="[]"
                            :readonly="busy"
                            @add="onSubstituteAdd"
                            @remove="onSubstituteRemove"
                        />

                        <!--
                            Only while the form is open with nothing chosen yet.
                            Once a substitution exists the picker carries its own
                            remove, and a second control that also means "undo
                            this" would be two ways to say one thing.
                        -->
                        <CommonButton
                            v-if="!session.substitution"
                            type="secondary"
                            size="S"
                            :disabled="busy"
                            @click="addingSubstitute = false"
                        >Cancel</CommonButton>
                    </dd>
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
                            plain click silently cleared every other person.

                            Searchable, so a name is typed rather than hunted
                            for. `options` stays the page's whole directory:
                            not because this picker needs it, but because the
                            grid does, to label the attendees of every drawn
                            Session. Search here removes the scrolling, not that
                            fetch.
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
                        <span class="inspector_muted">· {{ violation.constraint.name }}</span>
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
                >{{ placing ? 'Cancel' : (placedSession ? 'Move…' : 'Place…') }}</CommonButton>

                <p
                    v-if="canMove && session.isLocked"
                    class="inspector_hint"
                >Unlock this session before moving it.</p>

                <!-- SWAP AND LOCK BOTH NEED A PLACEMENT TO ACT ON: a banked
                     Session (issue #22) has none, and the server refuses
                     either against one. Hidden here rather than merely
                     disabled, matching how Delete is absent for an
                     Offering-linked Session rather than greyed out. -->
                <CommonButton
                    v-if="canSwap && placedSession"
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
                    v-if="canLock && placedSession"
                    type="secondary"
                    width="100%"
                    :disabled="busy"
                    @click="$emit('toggle-lock')"
                >{{ session.isLocked ? 'Unlock' : 'Lock in place' }}</CommonButton>

                <!--
                    THE SPARE BANK (issue #22). Only an Offering-linked Session
                    carries demand worth preserving; an Event has none, and
                    Delete below is its equivalent. Not a two-step confirm like
                    Delete: banking is reversible (place it again), unlike
                    removing an Event entirely.
                -->
                <CommonButton
                    v-if="canBank && placedSession && session.offeringId !== null"
                    type="secondary"
                    width="100%"
                    :disabled="busy || session.isLocked"
                    @click="$emit('bank')"
                >{{ busy ? 'Moving…' : 'Move to spare bank' }}</CommonButton>

                <p
                    v-if="canBank && placedSession && session.offeringId !== null && session.isLocked"
                    class="inspector_hint"
                >Unlock this session before moving it to the spare bank.</p>

                <!--
                    EVENTS ONLY. An Offering-linked Session cannot be deleted:
                    its Offering's frequency would go unmet and the next solve
                    would place it again. So the action is absent rather than
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
                    v-if="!canMove && !canLock && !canDelete && !canBank"
                    class="inspector_hint"
                >You have view-only access to this schedule.</p>
            </div>
        </template>
    </aside>
</template>

<script setup lang="ts">
import type { PlacedScheduleSession, ScheduleSession, TimeGrid, Violation } from '~/composables/schedule';
import {
    attendeesOf, blockTime, describeViolation, formatSlotDate,
    lecturersOf, sessionLabel, weekdayName,
} from '~/composables/schedule';
import { isPlacedSession } from '#shared/sessionPlacement';
import { useViewerLocale } from '~/composables/locale';
import ManageRelationPicker from '~/components/manage/ManageRelationPicker.vue';
import type { RelationDef } from '~/utils/manageRegistry';
import { personOptionLabel } from '~/utils/manageRegistry';

const props = defineProps<{
    session: ScheduleSession | null;
    grid: TimeGrid;
    violations: Violation[];
    canMove: boolean;
    canLock: boolean;
    canSwap: boolean;
    canDelete: boolean;
    /** Cancel to, or place from, the spare bank (issue #22). */
    canBank: boolean;
    canUpdate: boolean;
    /** Separate from `canUpdate`: this also reaches a LOCKED Offering-linked
     * Session, which `session.update` explicitly does not. */
    canAssignLecturer: boolean;
    /**
     * Covering a Session someone cannot teach (issue #30) is its own permission,
     * separate from `canAssignLecturer`: covering is an operational act, not an
     * editing authority over the Offering, and needs no lock.
     */
    canSubstitute: boolean;
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
 * and from solver output, so the route refuses an edit; offering a control
 * the server will reject is worse than showing none.
 */
const editable = computed(() => props.canUpdate && props.session?.offeringId === null);

/**
 * Safe from the next solve, and therefore safe to override here: an Event
 * (structurally out of scope regardless of `isLocked`) or a Session already
 * locked: `planMaterialization` skips a locked Session entirely, on a rebuild
 * as much as a repair. Anything else would be silently discarded by the next
 * apply, which `lecturers.post.ts` refuses.
 */
const lecturerEditable = computed(() => props.canAssignLecturer
    && (props.session?.offeringId === null || props.session?.isLocked === true));

const lecturerRelation: RelationDef = {
    key: 'lecturers',
    label: 'Lecturer',
    help: 'Who leads this session. Changing it here overrides what the Offering or the '
        + 'solver assigned, permanently. That is the whole reason a lock is required first.',
    resource: 'persons',
    valueKey: 'personId',
    searchable: true,
    optionLabel: personOptionLabel,
    emptyHint: 'No people in this institution yet.',
};

const personRelation: RelationDef = {
    key: 'people',
    label: 'People',
    help: 'Individuals attending in their own right, beyond whole groups.',
    resource: 'persons',
    valueKey: 'personId',
    // People are a flat list, not a hierarchy: the one difference from groups.
    searchable: true,
    // Handles BOTH shapes on purpose: `options` below is the page's directory,
    // where the name is already composed, while a search result comes straight
    // from `/api/persons` with the parts separate.
    optionLabel: personOptionLabel,
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

/**
 * A COMPUTED, unlike the three above: its `resource` names THIS Session, so it
 * has to stay in sync as the panel is reused for a different one. Candidates
 * come from `substitute-candidates.get.ts` rather than `/api/persons`, because
 * that route already filters to people free at this Session's own slot (issue #30:
 * "filter to people who are free, not let a clash be created and warned about
 * after"), which `/api/persons` has no way to do.
 *
 * `valueKey: 'id'` rather than `'personId'`: this relation has no join row of
 * its own shape to key by: `rows` below is a single synthetic entry standing
 * in for "the current substitute", built directly from the candidate's `id`.
 */
const substituteRelation = computed<RelationDef>(() => ({
    key: 'substitute',
    label: 'Covered by',
    help: 'Somebody else teaches this one occurrence. The original lecturer keeps the '
        + 'Offering and this reverts on its own next week; nothing here is permanent.',
    resource: `sessions/${props.session?.id ?? ''}/substitute-candidates`,
    valueKey: 'id',
    searchable: true,
    optionLabel: personOptionLabel,
    emptyHint: 'Nobody is free to cover this slot right now.',

    /*
     * NO `emptyWarning`, deliberately. That field exists for a relation whose
     * emptiness is a PROBLEM, like `access-roles`, where it means a person can sign
     * in and be shown nothing. A session with no substitute is not a problem; it
     * is what almost every session looks like almost every week, and flagging it
     * in the warning style said the class had nobody teaching it while the
     * Lecturer row two lines above named the person who does.
     *
     * The empty case is not stated here at all any more: the panel answers it
     * before the picker is ever opened. See the `Covered by` block above.
     */
}));

/** At most one: the picker's "assigned" row is just today's substitute, if any. */
const substituteRows = computed(() => (props.session?.substitution
    ? [{ id: props.session.substitution.coveringPersonId }]
    : []));

/**
 * Whether the substitute picker is open on a session that has no substitute yet.
 *
 * PURELY LOCAL, and it has to be: it records that somebody clicked "Add a
 * substitute", which is a statement about this panel and not about the Session.
 * Once a substitution exists the flag stops mattering, because the picker
 * renders off `session.substitution`, so this only ever gates the empty case.
 */
const addingSubstitute = ref(false);

/**
 * What the resting "Covered by" row says when there is no substitute.
 *
 * TWO WORDINGS, because one of them is false half the time. "Taught by the
 * assigned lecturer" is the reassurance this row exists to give: it is what
 * makes "no substitute" read as normal rather than as nobody teaching the class.
 * But a Session with no lecturer assigned yet would then be told it has one.
 * That is the same class of untruth this whole change was fixing, one row lower.
 */
const coverRestingLabel = computed(() => (lecturers.value.length > 0
    ? 'Taught by the assigned lecturer.'
    : 'No substitute for this occurrence.'));

/*
 * THE PANEL IS REUSED, NOT REMOUNTED. Selecting a different session swaps the
 * prop while the component stays alive, so without this an operator who opened
 * the form on one session and clicked away would find the next one already
 * asking for a substitute it has no reason to want.
 */
watch(() => props.session?.id, () => {
    addingSubstitute.value = false;
});

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
function onLecturerAdd(value: string) {
    const next = [...new Set([...lecturers.value.map((l) => l.personId), value])];

    emit('set-lecturers', next);
}

function onLecturerRemove(value: string) {
    emit('set-lecturers', lecturers.value.map((l) => l.personId).filter((id) => id !== value));
}

/**
 * Unlike lecturers/rooms/groups, this is not "send the whole set": a
 * substitution has at most one covering Person, so picking a new one simply
 * REPLACES it server-side (`substitute.post.ts` upserts on `session_id`).
 */
function onSubstituteAdd(value: string) {
    emit('substitute', value);
}

/**
 * Removes the overlay entirely: "wrong person picked" or "no longer needed".
 *
 * Closes the form with it. Leaving it open would drop the panel straight back to
 * an empty picker, which is the state this change exists to stop it resting in;
 * reopening is one click away for the operator who removed the wrong person.
 */
function onSubstituteRemove() {
    addingSubstitute.value = false;
    emit('uncover');
}

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
    /** Cancel the selected Session to the spare bank (issue #22). */
    bank: [];
    /** A partial edit of what this Event IS; one request per control. */
    'set-details': [patch: Record<string, unknown>];
    'set-lecturers': [personIds: string[]];
    'set-rooms': [roomIds: string[]];
    substitute: [personId: string];
    uncover: [];
}>();

/**
 * The COMPLETE desired set: `/move` replaces `roomIds` wholesale, so emitting a
 * single id would delete every other room the session has.
 */
function onRoomsChange(event: Event) {
    const select = event.target as HTMLSelectElement;

    emit('set-rooms', [...select.selectedOptions].map((option) => option.value));
}

/**
 * The selected Session, narrowed to its placed shape, or null when there is
 * none selected OR it is banked (issue #22). It is the one place the template
 * checks before reading `dayOfWeek`/`blockIndex`/`termWeek`.
 */
const placedSession = computed<PlacedScheduleSession | null>(() => (
    props.session && isPlacedSession(props.session) ? props.session : null
));

/** Last block the session occupies, so the end time reflects its duration. */
const endBlock = computed(() => (placedSession.value
    ? placedSession.value.blockIndex + placedSession.value.durationBlocks - 1
    : 0));

const worst = computed(() => (props.violations.some((v) => v.severity === 'HARD') ? 'hard' : 'soft'));

// The split lives in `composables/schedule.ts`; see `LECTURER_ROLE_KEY` for
// why it is one definition and not a string literal per component.
const lecturers = computed(() => lecturersOf(props.session?.people ?? []));
const attendees = computed(() => attendeesOf(props.session?.people ?? []));

/*
 * The read-only renderings, resolved here rather than in the template.
 *
 * Each was a `.map().join()` inside an interpolation, so it rebuilt an array and
 * a string on every render of a panel that re-renders on every selection, and
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
     * was selected: a third of a 1440px screen for a panel that is empty most of
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

    /* Nothing selected: a prompt, not a panel. It keeps a presence (a column
       that vanishes and returns makes the grid jump on every selection) but
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

        font-size: var(--font-size-md);
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

        font-size: var(--font-size-lg);
        font-weight: 650;
        line-height: 1.25;
        color: $content2;
    }

    &_sub {
        margin: var(--space-2) 0 0;
        font-size: var(--font-size-sm);
        color: $content7;
    }

    &_close {
        cursor: pointer;

        position: absolute;
        top: -4px;
        right: -4px;

        display: flex;

        padding: var(--space-2);
        border: 0;
        border-radius: var(--radius-md);

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
        gap: var(--space-5);
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

    /*
     * The resting "Covered by" row: a statement of fact and the control that
     * changes it, stacked and left-aligned. The button sits on its own line
     * rather than beside the sentence, because at this panel width a label and a
     * button on one row leaves the button hard against the edge, and the two are
     * read in sequence anyway.
     */
    &_cover {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        align-items: start;
    }

    /* Editable fields on an Event. Read-only Sessions render text instead, so
       these never appear where nothing may change. */
    &_control {
        width: 100%;
        padding: var(--space-2) var(--space-3);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        font: inherit;
        color: inherit;

        background: $surface0;
    }

    /* The title edits in place: it looks like the heading it replaces until
       the pointer or focus lands on it. */
    &_title--edit {
        width: 100%;
        padding: var(--space-1) var(--space-2);
        border: 1px solid transparent;
        border-radius: var(--radius-md);

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
        padding: var(--space-5);
        border-radius: var(--radius-lg);
        background: rgb(169, 125, 45, 0.14);

        h3 {
            display: flex;
            gap: var(--space-3);
            align-items: center;

            margin: 0 0 8px;

            font-size: var(--font-size-sm);
            font-weight: 650;

            /* One step darker than $warning700, which measured 3.23:1 on this
               panel's own soft tint, under the 4.5:1 text minimum, on the
               heading that names the product's signature state. */
            color: $warning800;
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
            gap: var(--space-3);

            margin: 0;
            padding-left: 16px;

            font-size: var(--font-size-sm);
            line-height: 1.45;
            color: $content5;
        }

        &--hard {
            background: rgb(169, 45, 70, 0.16);

            h3 { color: $error700; }
        }
    }

    &_note {
        margin: var(--space-4) 0 0;
        font-size: var(--font-size-xs);
        line-height: 1.4;
        color: $content7;
    }

    &_actions {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        margin-top: auto;
    }

    &_hint {
        margin: 0;
        font-size: var(--font-size-xs);
        line-height: 1.4;
        color: $content7;
    }
}
</style>
