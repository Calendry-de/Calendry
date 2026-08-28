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
            THE BREAK INSIDE THE SPAN, drawn where it actually falls.

            PX AT THE GRID'S CONSTANT SCALE, never a percentage of the chip: a
            row grows when its column is crowded, so a percentage would make a
            minute worth more pixels in a busy row and slide the band off the
            break it is marking. Same rule as `bandWithin`.

            The `- 1px` is the chip's border: an absolutely positioned child is
            placed against the PADDING box, while the minute scale is measured
            from the border box.

            `aria-hidden` because `interruptionLabel` is already in the
            accessible name — this is the same decorative-icon-plus-real-text
            split the meta row below uses.
        -->
        <span
            v-for="gap in (perMinute ? interruptions : [])"
            :key="gap.afterBlockIndex"
            class="chip_gap"
            :style="{
                top: `calc(${(gap.fromMinute * perMinute!).toFixed(2)}px - 1px)`,
                height: `${(gap.minutes * perMinute!).toFixed(2)}px`,
            }"
            aria-hidden="true"
        />

        <!--
            TIME AND ROOM. In the grid a chip's POSITION carries its time, but a
            crowded cluster stacks its members one line each and a stack has no
            position to read — 5 of 7 occupied slots on the live tenant. Rendered
            for every chip and hidden by the container in the roomy case, so the
            two forms cannot say different things.
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
                v-if="interruptions.length"
                name="material-symbols:coffee-outline"
                class="chip_icon"
                aria-hidden="true"
            />
            <span
                v-if="interruptions.length"
                class="chip_sr"
            >{{ interruptionLabel }}. </span>

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
            WHO AND WHICH — only when the filters are not already saying it. With
            a Group or Person filter set every chip belongs to it, and repeating
            it spends the chip's scarcest resource on what the toolbar just said.
        -->
        <!--
            ALWAYS RENDERED, even when empty: conditional, this line made the
            chip's HEIGHT depend on whether a session had a resolvable cohort, so
            a row grew from data rather than crowding — and the three-line
            intrinsic height (~62px) exceeded both Compact and Comfortable,
            collapsing two density settings into one.
        -->
        <span
            v-if="!dense"
            class="chip_who"
            :class="{ 'chip_who--empty': !whoLabel && !whichLabel }"
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
import { gapsWithinSpan } from '#shared/timeGrid';
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
     * Optional: the agenda prints the time in its own gutter and would otherwise
     * say it twice.
     */
    grid?: TimeGrid | null;
    /** Resolves a room id to a name; without it the room is omitted, not guessed. */
    roomName?: (id: string) => string;
    /** Virtual room ids, for the online treatment. Absent means "do not mark". */
    virtualRoomIds?: Set<string>;
    /**
     * Pixels per minute, from `useGridGeometry`. Present only where the chip is
     * MINUTE-TRUE — the week grid — and absent in the agenda, which is a list
     * with no vertical time axis and would have to invent a number.
     *
     * Its absence removes the break OVERLAY, never the FACT: the interruption is
     * still named in the meta row and the accessible name, because a chip that
     * silently claims two contiguous blocks is wrong in a list too.
     */
    perMinute?: number;
    /** The tenant's display standards; defaults when the fetch degraded. */
    display?: DisplaySettings;
    /** Resolvers for the who/which line. Absent means the fact is omitted, not guessed. */
    groupName?: (id: string) => string;
    personName?: (id: string) => string;
    /** Group/Person filters OFF — the chip only says what the toolbar does not. */
    showGroup?: boolean;
    showPerson?: boolean;
    /**
     * Compact drops the third line: three lines are ~62px intrinsic, which
     * exceeded both Compact (44px) and Comfortable (60px) and made the density
     * control inert. The accessible name is assembled separately and unaffected.
     */
    dense?: boolean;
}>();

defineEmits<{ select: [] }>();

/**
 * COLOUR IS RESOLVED, NOT READ OFF ONE FIELD. It was `kind?.color ?? primary500`,
 * so every session without a kind colour claimed the accent DESIGN.md reserves
 * for "where a session may land". The order is the tenant's and the fallback is
 * null, so an unset colour renders as the neutral surface.
 */
const settings = computed(() => props.display ?? DISPLAY_DEFAULTS);

const resolvedColor = computed(() => resolveSessionColor(props.session, settings.value));

/**
 * Delivery is a property of the ROOMS, so this asks them. Three states, because
 * a session in a hall and a virtual room is streamed rather than either.
 */
/**
 * Emitted ONLY when set, so the stylesheet's `var(--online-color, <neutral>)`
 * fallback decides the unset case — an empty string would suppress it and paint
 * nothing. The CSS referenced this property from the start while nothing set it.
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
 * CODE on the chip, full name in the accessible label: `lookup.room` returns
 * "code · name", which reads "A102 · A102" when a room has no distinct name.
 */
const roomCode = computed(() => roomLabel.value.split(' · ')[0] ?? '');

/**
 * Assembled rather than inherited: the name was the title glued to the kind —
 * "ProjectLecture" — with no day, time or room, so 31 chips announced as
 * run-together words. Everything position gives the sighted reader is words here.
 */
/**
 * "+N" rather than a list: a Session can carry many Groups, and a chip listing
 * four cohort names has room for nothing else. The inspector has the full list.
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
 * Lecturer first — the fixed Role key and the question usually being asked — but
 * a Session with no lecturer and named attendees still has someone worth naming.
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

/**
 * The gaps inside this session's span — the time it occupies but does not teach.
 *
 * The WALK lives in `gapsWithinSpan` (shared/timeGrid.ts) so the renderer, the
 * accessible name and anything that later reports this all ask one function. The
 * chip's only job is to decide how to show the answer.
 *
 * Why it matters here: the grid draws a `durationBlocks: 2` Session as one
 * contiguous band, which is a claim about the CLOCK that a gap between those
 * blocks falsifies. One live Session on the dev tenant was already in that state,
 * rendered identically to a genuine single-stretch one.
 */
const interruptions = computed(() => (props.grid
    ? gapsWithinSpan(props.grid, props.session.blockIndex, props.session.durationBlocks, props.session.dayOfWeek)
    : []));

/** Stated in minutes, because "spans a break" does not say how much is lost. */
const interruptionLabel = computed(() => {
    if (!interruptions.value.length) {
        return '';
    }

    const total = interruptions.value.reduce((sum, gap) => sum + gap.minutes, 0);
    const named = interruptions.value.map((gap) => gap.label).filter(Boolean);

    return named.length
        ? `Interrupted by ${named.join(' and ')} — ${total} minutes not taught`
        : `Interrupted by ${total} minutes of break`;
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

    if (interruptionLabel.value) {
        parts.push(interruptionLabel.value);
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

    /*
     * The containing block for `chip_gap`, which is placed in px against this
     * chip's own top. No offsets, so nothing moves.
     */
    position: relative;

    overflow: hidden;
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    gap: var(--space-1);
    justify-content: space-between;

    min-width: 0;
    padding: var(--space-3) var(--space-4);

    /*
     * Measured at 1.16:1 against `$surface0`, the pair that answers "is this slot
     * occupied". The fill cannot be raised without flattening the surface ramp,
     * so occupancy gets an EDGE instead.
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
     * INSET outlines: at `outline-offset: 1px` the ring is drawn into the grid's
     * 1px gap and overpainted along the bottom edge — it looked complete only
     * while hovered, because the hover `translateY` lifts it into its own
     * stacking context.
     */
    &:focus-visible {
        z-index: 3;
        outline: 2px solid $primary600;
        outline-offset: -2px;
    }

    /* Hidden in the roomy form, where position already says when it is; revealed
       by the container in the stacked form. Rendered either way so the accessible
       name never diverges from the two presentations. */
    &_time {
        display: none;
        flex: none;

        font-size: 11px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: $content6;
    }

    /* Ellipsised per part rather than as a whole, so a long cohort name cannot
       eat the lecturer's. */
    &_who {
        display: flex;
        gap: var(--space-3);
        align-items: baseline;

        min-width: 0;

        /* Holds its line whether or not it has content, so every chip is the
           same height. `1lh`, not a magic pixel value: one line of THIS font at
           THIS size. */
        min-height: 1lh;

        font-size: var(--font-size-xs);
        color: $content7;

        &--empty { visibility: hidden; }
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
     * ONLINE: a dashed edge, never colour alone — it has to survive greyscale and
     * the tenant leaving `onlineColor` empty. Same rule as violations.
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

    /*
     * NOT-TEACHING TIME, inside a chip that would otherwise claim it.
     *
     * Opaque over the chip's own fill rather than translucent: the point is that
     * this stretch is NOT the session, and a tint would read as a variation of
     * it. The hatch carries the meaning where colour cannot — greyscale, an
     * unset kind colour, or a violation tint already occupying the background.
     */
    &_gap {
        pointer-events: none;

        position: absolute;
        z-index: 2;
        right: 0;
        left: 0;

        border-block: 1px solid varToRgba('content7', 0.45);

        background:
            repeating-linear-gradient(
                135deg,
                transparent 0 4px,
                varToRgba('content7', 0.3) 4px 8px
            ),
            $surface0;
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
