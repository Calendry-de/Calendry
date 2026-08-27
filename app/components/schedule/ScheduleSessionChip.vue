<template>
    <button
        type="button"
        class="chip"
        :aria-label="accessibleName"
        :class="[
            `chip--${severity}`,
            { 'chip--selected': selected, 'chip--dimmed': dimmed,
            'chip--targetable': targetable, 'chip--locked': session.isLocked },
            `chip--${delivery}`,
        ]"
        :style="{
            '--kind-color': resolvedColor ?? 'transparent',
            ...(delivery !== 'onsite' && onlineColor ? { '--online-color': onlineColor } : {}),
        }"
        :aria-pressed="selected"
        :disabled="dimmed"
        @click="$emit('select')"
    >
        <!--
            TIME AND ROOM, and they are not decoration.

            In the grid a chip's POSITION carried its time — but a crowded
            cluster stacks its members on one line each, and a stack has no
            position to read. Measured on the live tenant, 5 of 7 occupied slots
            render that way, so the stacked form is the norm, not the exception:
            without these two facts the common case answers neither "when" nor
            "where", and resolving a single clash costs one inspector open per
            session.

            Rendered for every chip and hidden by the container in the roomy
            case, so the two forms cannot say different things.
        -->
        <span
            v-if="startTime"
            class="chip_time"
        >{{ startTime }}</span>

        <span class="chip_title">{{ sessionLabel(session) }}</span>

        <span class="chip_meta">
            <Icon
                v-if="session.isLocked"
                name="material-symbols:lock"
                class="chip_icon"
                aria-hidden="true"
            />
            <span
                v-if="session.isLocked"
                class="chip_sr"
            >Locked. </span>

            <Icon
                v-if="severity !== 'none'"
                :name="severity === 'hard'
                    ? 'material-symbols:error'
                    : 'material-symbols:warning-outline'"
                class="chip_icon chip_icon--violation"
                aria-hidden="true"
            />
            <span
                v-if="severity !== 'none'"
                class="chip_sr"
            >{{ violations.length }} {{ severity }} violation{{ violations.length === 1 ? '' : 's' }}. </span>

            <span
                class="chip_dot"
                aria-hidden="true"
            />
            <span class="chip_kind">{{ session.kind?.name }}</span>
            <span
                v-if="roomCode"
                class="chip_room"
            >{{ roomCode }}</span>
        </span>

        <!--
            WHO AND WHICH — shown only when the filters are not already saying it.
            With a Group or Person filter set, every chip on screen belongs to
            that group or that person, and repeating it on all of them spends the
            chip's scarcest resource to say something the toolbar already said.
            Unfiltered, it is the one thing the chip could not otherwise answer:
            two sessions of the same offering at the same hour differ by cohort.
        -->
        <span
            v-if="whoLabel || whichLabel"
            class="chip_who"
        >
            <span
                v-if="whichLabel"
                class="chip_group"
            >{{ whichLabel }}</span>
            <span
                v-if="whoLabel"
                class="chip_person"
            >{{ whoLabel }}</span>
        </span>
    </button>
</template>

<script setup lang="ts">
import type { ScheduleSession, TimeGrid, Violation } from '~/composables/schedule';
import { attendeesOf, blockTime, lecturersOf, sessionLabel, weekdayName } from '~/composables/schedule';
import { DISPLAY_DEFAULTS, deliveryMode, resolveSessionColor } from '#shared/sessionColor';
import type { DisplaySettings } from '#shared/sessionColor';

const props = defineProps<{
    session: ScheduleSession;
    violations: Violation[];
    selected: boolean;
    dimmed: boolean;
    /** In swap mode every OTHER chip is a pick target. */
    targetable?: boolean;
    /**
     * The grid it sits in, so the chip can state its own start time. Optional
     * because the agenda already prints the time in its own gutter column and
     * would otherwise say it twice.
     */
    grid?: TimeGrid | null;
    /** Resolves a room id to a name; without it the room is omitted, not guessed. */
    roomName?: (id: string) => string;
    /** Virtual room ids, for the online treatment. Absent means "do not mark". */
    virtualRoomIds?: Set<string>;
    /** The tenant's display standards; defaults when the fetch degraded. */
    display?: DisplaySettings;
    /** Resolvers for the who/which line. Absent means the fact is omitted, not guessed. */
    groupName?: (id: string) => string;
    personName?: (id: string) => string;
    /**
     * Whether the Group / Person filters are OFF. The chip says which cohort and
     * whose session only when the toolbar is not already saying it for every
     * chip on screen.
     */
    showGroup?: boolean;
    showPerson?: boolean;
}>();

defineEmits<{ select: [] }>();

/**
 * COLOUR IS RESOLVED, NOT READ OFF ONE FIELD.
 *
 * It used to be `session.kind?.color ?? primary500` — which meant every session
 * without a kind colour claimed the brand accent, the one colour DESIGN.md
 * reserves for "where a session may land". Measured on real data, every chip on
 * the screen carried it. Now the order is the tenant's (`colorSourceOrder`) and
 * the fallback is null, so an unset colour renders as the neutral surface the
 * stylesheet already owns rather than as an accent nobody chose.
 */
const settings = computed(() => props.display ?? DISPLAY_DEFAULTS);

const resolvedColor = computed(() => resolveSessionColor(props.session, settings.value));

/**
 * Delivery is a property of the ROOMS, so this asks them. Three states, because
 * a session in a hall and a virtual room is streamed rather than either.
 */
/**
 * The tenant's online colour, emitted as a custom property ONLY when set.
 *
 * Omitted rather than passed as null, so the stylesheet's `var(--online-color,
 * <neutral>)` fallback is what decides the unset case — and omitted entirely on
 * an on-site chip, which is every chip that never reads it. Setting the property to
 * an empty string would suppress that fallback and paint nothing — and the
 * property was referenced by the CSS from the start while nothing ever set it,
 * so the marking was always the neutral grey no matter what the tenant chose.
 */
const onlineColor = computed(() => settings.value.onlineColor ?? '');

const delivery = computed(() => deliveryMode(
    props.session.rooms.map((room) => ({ isVirtual: props.virtualRoomIds?.has(room.roomId) })),
    settings.value,
));

/**
 * Severity drives shape and icon as well as colour — a violation must not be
 * signalled by hue alone.
 */
/**
 * This day's clock time, not the shared timeline's — `blockTime` defaults
 * `dayOfWeek` to null, which resolves the universal boundaries and is wrong by
 * that day's break minutes on a grid carrying day-specific overrides.
 */
const startTime = computed(() => (props.grid
    ? blockTime(props.grid, props.session.blockIndex, props.session.dayOfWeek).start
    : ''));

const roomLabel = computed(() => {
    const id = props.session.rooms[0]?.roomId;

    return id && props.roomName ? props.roomName(id) : '';
});

/**
 * The room's CODE for the visible chip, its full name for the accessible one.
 *
 * `lookup.room` returns "code · name", which on real data reads "A102 · A102"
 * when a room has no name distinct from its code — a stutter that costs a third
 * of a compact chip's width to say one thing twice. The screen reader keeps the
 * unabbreviated form, where width is not the constraint.
 */
const roomCode = computed(() => roomLabel.value.split(' · ')[0] ?? '');

/**
 * The accessible name, assembled rather than inherited.
 *
 * Read from the rendered document, the name was the title glued straight to the
 * kind — "ProjectLecture", "KryptoLecture" — with no separator and no day, time
 * or room, so 31 chips announced as run-together words with nothing to tell
 * them apart. Everything the sighted reader gets from position now reaches the
 * accessible name as words.
 */
/**
 * The cohort, and "+N" rather than a list.
 *
 * A Session can carry many Groups — the elective/track merging case — and a
 * chip that lists four cohort names is a chip with no room for anything else.
 * The first plus a count is the honest summary; the inspector has the full list
 * and is one click away.
 */
const whichLabel = computed(() => {
    if (!props.showGroup || !props.groupName) {
        return '';
    }

    const groups = props.session.groups;

    if (!groups.length) {
        return '';
    }

    const first = props.groupName(groups[0]!.groupId);

    return groups.length > 1 ? `${first} +${groups.length - 1}` : first;
});

/**
 * Who is leading it, falling back to who is attending.
 *
 * Lecturer first because that is the fixed Role key and the question a
 * timetabler is usually asking; a Session with no lecturer but named attendees
 * still has someone worth naming, and saying nothing there would read as "no
 * one is involved".
 */
const whoLabel = computed(() => {
    if (!props.showPerson || !props.personName) {
        return '';
    }

    const people = lecturersOf(props.session.people);
    const fallback = people.length ? people : attendeesOf(props.session.people);

    if (!fallback.length) {
        return '';
    }

    const first = props.personName(fallback[0]!.personId);

    return fallback.length > 1 ? `${first} +${fallback.length - 1}` : first;
});

const accessibleName = computed(() => {
    const parts = [sessionLabel(props.session)];

    if (props.grid) {
        parts.push(`${weekdayName(props.session.dayOfWeek)} `
            + `${blockTime(props.grid, props.session.blockIndex, props.session.dayOfWeek).start}`);
    }

    if (roomLabel.value) {
        parts.push(roomLabel.value);
    }

    if (whichLabel.value) {
        parts.push(whichLabel.value);
    }

    if (whoLabel.value) {
        parts.push(whoLabel.value);
    }

    if (props.session.kind?.name) {
        parts.push(props.session.kind.name);
    }

    if (props.session.isLocked) {
        parts.push('Locked');
    }

    if (props.violations.length) {
        parts.push(`${props.violations.length} ${severity.value} violation`
            + `${props.violations.length === 1 ? '' : 's'}`);
    }

    return parts.join(', ');
});

const severity = computed<'none' | 'soft' | 'hard'>(() => {
    if (props.violations.some((v) => v.severity === 'HARD')) return 'hard';
    if (props.violations.length > 0) return 'soft';

    return 'none';
});
</script>

<style scoped lang="scss">
.chip {
    cursor: pointer;

    overflow: hidden;
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    gap: 2px;
    justify-content: space-between;

    min-width: 0;
    padding: 5px 7px;

    /*
     * THE CHIP MUST SEPARATE FROM THE CELL IT SITS IN.
     *
     * Measured at 1.16:1 against `$surface0` — the primary figure/ground pair
     * on the whole screen, and the one that answers "is this slot occupied".
     * Raising the fill alone cannot fix it without flattening the surface ramp,
     * so occupancy gets an EDGE: a hairline at 1px is a non-text UI boundary and
     * carries the separation the fill could not.
     */
    border: 1px solid $surface5;
    border-radius: 6px;

    text-align: left;

    background: $surface3;

    transition:
        background 140ms cubic-bezier(0.16, 1, 0.3, 1),
        transform 140ms cubic-bezier(0.16, 1, 0.3, 1),
        opacity 140ms ease-out;

    @include hover() {
        &:hover {
            transform: translateY(-1px);
            background: $surface4;
        }
    }

    /*
     * INSET outlines, and a raised stacking order.
     *
     * With `outline-offset: 1px` the ring is drawn OUTSIDE the border box —
     * into the grid's 1px gap, where it was overpainted along the bottom edge.
     * It looked complete only while hovered, because the hover `translateY`
     * promotes the chip to its own stacking context and lifts the ring clear.
     * Drawn inside its own box it cannot be clipped or overpainted by anything.
     */
    &:focus-visible {
        z-index: 3;
        outline: 2px solid $primary600;
        outline-offset: -2px;
    }

    /*
     * Hidden in the roomy form, where the chip's POSITION already says when it
     * is; revealed by the container in the stacked form, where it does not.
     * Rendered either way so the accessible name never diverges from the two
     * presentations.
     */
    &_time {
        display: none;
        flex: none;

        font-size: 11px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: $content6;
    }

    /*
     * The who/which line. Ellipsised per part rather than as a whole, so a long
     * cohort name cannot eat the lecturer's — each says as much as it can and
     * then stops, which is the readable failure.
     */
    &_who {
        display: flex;
        gap: 6px;
        align-items: baseline;

        min-width: 0;

        font-size: 11px;
        color: $content7;
    }

    &_group,
    &_person {
        overflow: hidden;
        flex: 0 1 auto;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    // A cohort is a thing; a person is a name. The weight difference is the
    // cheapest way to tell them apart at 11px without a second colour.
    &_group { font-weight: 600; }

    &_room {
        overflow: hidden;
        flex: 0 1 auto;

        font-variant-numeric: tabular-nums;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    &_title {
        overflow: hidden;

        font-size: 12.5px;
        font-weight: 600;
        line-height: 1.25;
        color: $content4;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    &_meta {
        display: flex;
        gap: 4px;
        align-items: center;

        font-size: 11px;
        color: $content7;
    }

    // Kind reads as a dot beside its name rather than a colored edge stripe:
    // the stripe is the category's most recognizable tell, and at grid density
    // a dot survives a 44px row where a 3px edge just adds noise.

    /*
     * ONLINE: a dashed edge and an inset rule, never colour alone.
     *
     * It has to survive greyscale and it has to survive the tenant leaving
     * `onlineColor` empty — so the SHAPE carries the meaning and any colour is
     * an amplifier. Same rule as violations: no fact on this screen is signalled
     * by hue alone.
     */
    &--online {
        border-color: var(--online-color, #{$content6});
        border-style: dashed;
    }

    &_dot {
        flex: none;

        width: 7px;
        height: 7px;
        border-radius: 50%;

        background: var(--kind-color);
    }

    &_kind {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    &_icon {
        flex: none;
        width: 13px;
        height: 13px;

        &--violation { color: $warning700; }
    }

    // Screen-reader-only: the icons above are decorative, so state is also
    // announced as text.
    &_sr {
        position: absolute;

        overflow: hidden;

        width: 1px;
        height: 1px;

        clip-path: inset(50%);
    }

    // Tint layered OVER an opaque base rather than replacing it: a translucent
    // background let the grid cell — and any chip behind it — show through.
    &--hard {
        background: linear-gradient(rgb(169, 45, 70, 0.22), rgb(169, 45, 70, 0.22)), $surface3;

        .chip_icon--violation { color: $error700; }

        @include hover() {
            &:hover { background: linear-gradient(rgb(169, 45, 70, 0.3), rgb(169, 45, 70, 0.3)), $surface4; }
        }
    }

    &--soft {
        background: linear-gradient(rgb(169, 125, 45, 0.18), rgb(169, 125, 45, 0.18)), $surface3;

        @include hover() {
            &:hover { background: linear-gradient(rgb(169, 125, 45, 0.26), rgb(169, 125, 45, 0.26)), $surface4; }
        }
    }

    &--selected {
        z-index: 2;
        background: $surface5;
        outline: 2px solid $primary600;
        outline-offset: -2px;
    }

    &--targetable {
        outline: 2px dashed $content5;
        outline-offset: -2px;
    }

    &--dimmed {
        pointer-events: none;
        opacity: 0.35;
    }
}
</style>
