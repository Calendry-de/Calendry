<!--
    The room plan: rooms across, today down, one Session per block.

    THE WHOLE DAY AT ONCE, which is the difference between this and the room
    cards it replaced. "Room 1.4: busy until 14:30" answers one question;
    somebody standing in a corridor is usually asking a harder one ("where is my
    lecture", "which room is free at four", "who has the lab after us"), and
    every one of those is read off a picture of the day rather than a sentence
    about this minute. The now line and the greyed-out past are what keep the
    single-minute question answerable at a glance.

    A SEPARATE COMPONENT from the page for the reason `ScheduleNowIndicator` is
    separate from `ScheduleGrid`: the page owns the fetch, the key and the clock,
    this owns measurement, paging and placement, and each is one job. All of the
    arithmetic lives in `app/utils/roomPlan.ts`, where it is unit-tested, because
    this suite has no component-mounting harness (tests/room-plan.test.ts).

    IT PAGES, AND SAYS SO. Rooms that do not fit at the configured column width
    are the one thing on this display that is genuinely hidden, so the dots
    underneath say how many pages there are and which one this is, and the
    rotation brings each back on a timer. Twenty rooms silently drawn as eight
    would look exactly like an institution with eight rooms, which is the
    invisible failure CLAUDE.md names.
-->
<template>
    <div
        class="plan"
        :style="{ '--plan-gutter': `${GUTTER}px`, '--plan-hour': `${hourHeight}px` }"
    >
        <div class="plan_head">
            <p class="plan_axis_title">{{ t('screen.board.timeColumn') }}</p>

            <div
                class="plan_names"
                :style="{ gridTemplateColumns: trackColumns }"
            >
                <p
                    v-for="room in pageRooms"
                    :key="room.id"
                    class="plan_name"
                    :class="{ 'plan_name--busy': busyNow(room) }"
                >
                    <span class="plan_name_text">{{ room.name }}</span>
                    <span class="plan_name_state">{{ busyNow(room) ? t('screen.room.nowLabel') : t('screen.room.freeLabel') }}</span>
                </p>
            </div>
        </div>

        <div
            ref="body"
            class="plan_body"
        >
            <div
                class="plan_scroll"
                :style="{ height: `${trackHeight}px` }"
            >
                <div class="plan_axis">
                    <!--
                        The FIRST label is anchored below its line instead of
                        centred on it: the plan's top edge is that line, so a
                        centred label loses its upper half to the clip and the
                        opening hour of the day reads as a half-height smudge.
                        Every other label is centred, which is what keeps it
                        level with the gridline it names.
                    -->
                    <span
                        v-for="(mark, index) in hourMarks"
                        :key="mark"
                        class="plan_hour"
                        :class="{ 'plan_hour--first': index === 0 }"
                        :style="{ top: `${offsetOf(mark)}px` }"
                    >{{ hhmm(mark) }}</span>
                </div>

                <div
                    ref="track"
                    class="plan_track"
                    :style="{ gridTemplateColumns: trackColumns }"
                >
                    <div
                        v-for="room in pageRooms"
                        :key="room.id"
                        class="plan_column"
                    >
                        <!--
                            NAMED, not left blank. An empty column and a column
                            that failed to draw look identical, and this is the
                            commonest state in the building: most rooms are
                            free most of the day.
                        -->
                        <p
                            v-if="!room.entries.length"
                            class="plan_free"
                        >{{ t('screen.room.nothingElse') }}</p>

                        <article
                            v-for="placed in lanesOf(room)"
                            :key="placed.entry.id"
                            class="entry"
                            :class="`entry--${phaseOf(placed.entry)}`"
                            :style="styleOf(placed)"
                        >
                            <p
                                v-if="placed.entry.groups.length"
                                class="entry_groups"
                            >{{ placed.entry.groups.join(', ') }}</p>
                            <p class="entry_title">{{ placed.entry.title }}</p>
                            <p
                                v-if="peopleOf(placed.entry)"
                                class="entry_people"
                            >{{ peopleOf(placed.entry) }}</p>
                            <!--
                                PUNCTUATION, NOT GRAMMAR (i18n/CONVENTIONS.md
                                § "Assembled sentences"): two clock values and
                                the dash between them, neither translated.
                            -->
                            <p class="entry_time">{{ hhmm(placed.entry.startMinute) }}–{{ hhmm(placed.entry.endMinute) }}</p>
                        </article>
                    </div>

                    <div
                        v-if="nowOffset !== null"
                        class="plan_now"
                        :style="{ top: `${nowOffset}px` }"
                        aria-hidden="true"
                    />
                </div>
            </div>
        </div>

        <!--
            WHAT THE CONFIGURED WINDOW CROPS, said out loud. A stated window is
            allowed to leave the evening off the wall; leaving it off SILENTLY
            would make an 18:00 lab indistinguishable from one that was never
            scheduled, and the person walking past has no other way to find out.
        -->
        <p
            v-if="outsideCount"
            class="plan_outside"
            role="status"
        >{{ t('screen.board.outsideWindow', { count: outsideCount, from: hhmm(dayWindow.startMinute), to: hhmm(dayWindow.endMinute) }, outsideCount) }}</p>

        <ul
            v-if="pageCount > 1"
            class="plan_pager"
            :aria-label="t('screen.board.pagerLabel')"
        >
            <li
                v-for="index in pageCount"
                :key="index"
                class="plan_dot"
                :class="{ 'plan_dot--active': index - 1 === page }"
                :aria-current="index - 1 === page ? 'true' : undefined"
                :aria-label="dotLabel(index - 1)"
                role="img"
            />
        </ul>
    </div>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';
import type { RoomPlanLane, RoomPlanRoom, RoomPlanSession } from '~/utils/roomPlan';
import {
    roomPlanColumnsPerPage,
    roomPlanEntryPhase,
    roomPlanHourHeight,
    roomPlanHourMarks,
    roomPlanLanes,
    roomPlanNowOffset,
    roomPlanOutsideWindow,
    roomPlanPage,
    roomPlanPageCount,
    roomPlanPageRange,
    roomPlanPlacement,
    roomPlanWindow,
} from '~/utils/roomPlan';

/**
 * The time column, in px, declared HERE and handed to CSS as a custom property
 * so the value exists once. The room columns are measured directly off the
 * track element rather than derived from this, so the two cannot disagree about
 * how many fit.
 */
const GUTTER = 68;

const props = defineProps<{
    rooms: RoomPlanRoom[];
    /** The TimeGrid's day, or nulls where no term is running. Widened by an
     * entry outside it; see `roomPlanWindow`. */
    day: { startMinute: number | null; endMinute: number | null };
    /**
     * The screen's OWN configured hours (`planStartMinute`/`planEndMinute`), or
     * nulls. Authoritative for the end it sets: the plan crops to it and names
     * what falls outside, rather than widening the way `day` does.
     */
    configured: { startMinute: number | null; endMinute: number | null };
    /**
     * Minutes since TENANT-local midnight, interpolated by the page from the
     * board's own `nowMinute`. Never this device's clock: a wall machine whose
     * time nobody checks would grey out a lecture that is still running.
     */
    minuteNow: number;
    /** Already clamped by `clampRoomPlanColumnWidth`. */
    columnWidth: number;
    /** Already clamped by `clampRoomPlanRotateSeconds`; `0` is "do not rotate". */
    rotateSeconds: number;
}>();

const { t } = useT();

const body = useTemplateRef<HTMLElement | null>('body');
const track = useTemplateRef<HTMLElement | null>('track');
/**
 * `0` until measured, which is the state SSR and the first frame render in.
 * `roomPlanColumnsPerPage` reads that as "every room" rather than guessing a
 * page size, so the server-rendered plan holds the whole institution and paging
 * takes over once the ResizeObserver has fired.
 */
const viewWidth = ref(0);
const viewHeight = ref(0);
const page = ref(0);

const allEntries = computed(() => props.rooms.flatMap((room) => room.entries));
const dayWindow = computed(() => roomPlanWindow(allEntries.value, props.day, props.configured));

/**
 * What a CONFIGURED window is cropping. Zero unless somebody set one, since a
 * derived window widens to fit everything; the note it drives is the same
 * promise the paging dots make, that the plan may hide something but never
 * quietly.
 */
const outsideCount = computed(() => roomPlanOutsideWindow(allEntries.value, dayWindow.value));
const hourMarks = computed(() => roomPlanHourMarks(dayWindow.value));
const hourHeight = computed(() => roomPlanHourHeight(viewHeight.value, dayWindow.value));
const trackHeight = computed(() => (
    (dayWindow.value.endMinute - dayWindow.value.startMinute) / 60 * hourHeight.value
));

const columnsPerPage = computed(() => roomPlanColumnsPerPage(viewWidth.value, props.columnWidth, props.rooms.length));
const pageCount = computed(() => roomPlanPageCount(props.rooms.length, columnsPerPage.value));
const pageRooms = computed(() => roomPlanPage(props.rooms, page.value, columnsPerPage.value));
/**
 * The page's columns share the width EQUALLY rather than each taking exactly
 * `columnWidth`: the configured width decides how many fit, and then the last
 * few pixels go to the columns instead of to a dead strip on the right. A
 * partly-filled last page keeps the same column width as every other page, so
 * the plan does not lurch when the rotation reaches it.
 */
const trackColumns = computed(() => `repeat(${columnsPerPage.value}, minmax(0, 1fr))`);

const nowOffset = computed(() => roomPlanNowOffset(props.minuteNow, dayWindow.value, hourHeight.value));

function offsetOf(minute: number): number {
    return (minute - dayWindow.value.startMinute) * (hourHeight.value / 60);
}

function hhmm(minutes: number): string {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function phaseOf(entry: RoomPlanSession): 'past' | 'now' | 'future' {
    return roomPlanEntryPhase(entry, props.minuteNow);
}

function busyNow(room: RoomPlanRoom): boolean {
    return room.entries.some((entry) => phaseOf(entry) === 'now');
}

function lanesOf(room: RoomPlanRoom): RoomPlanLane<RoomPlanSession>[] {
    return roomPlanLanes(room.entries);
}

/**
 * WHO IS ACTUALLY THERE. A covering lecturer REPLACES the named one on the
 * plan (issue #30): the original assignment survives in the database, but a
 * wall that named the absent lecturer would send people to the wrong room to
 * find the wrong person.
 */
function peopleOf(entry: RoomPlanSession): string {
    if (entry.coveringLecturer) {
        return t('screen.room.covering', { name: entry.coveringLecturer });
    }

    return entry.lecturers.join(', ');
}

function styleOf(placed: RoomPlanLane<RoomPlanSession>): Record<string, string> {
    const placement = roomPlanPlacement(placed.entry, dayWindow.value, hourHeight.value);
    const width = 100 / placed.lanes;

    return {
        top: `${placement.top}px`,
        height: `${placement.height}px`,
        left: `${placed.lane * width}%`,
        width: `${width}%`,
    };
}

function dotLabel(index: number): string {
    const range = roomPlanPageRange(index, columnsPerPage.value, props.rooms.length);

    return t('screen.board.pageLabel', { from: range.from, to: range.to, total: props.rooms.length });
}

/*
 * CLAMPED, never left out of range. The page count shrinks when somebody
 * widens the columns or a room is deactivated, and a `page` left past the end
 * would slice an empty array: a blank plan, with the dots still claiming
 * there was something on it.
 */
watch(pageCount, (count) => {
    if (page.value >= count) {
        page.value = 0;
    }
});

/**
 * The rotation, re-armed whenever the interval or the page count changes, and
 * NOT armed at all for a single page: a plan whose rooms all fit is not a
 * carousel, and a display that swapped its content every twelve seconds for no
 * reason is one nobody trusts to be showing NOW.
 *
 * Client-only, and it moves `page` and nothing else, so a rotation that stops
 * (a term ending, every room fitting after somebody widens the columns) leaves
 * a correct plan on the wall rather than a frozen one.
 */
let rotation: ReturnType<typeof setInterval> | null = null;

function armRotation(): void {
    if (rotation !== null) {
        clearInterval(rotation);
        rotation = null;
    }

    if (!import.meta.client || props.rotateSeconds <= 0 || pageCount.value <= 1) {
        return;
    }

    rotation = setInterval(() => {
        page.value = (page.value + 1) % Math.max(1, pageCount.value);
    }, props.rotateSeconds * 1000);
}

watch([pageCount, () => props.rotateSeconds], armRotation, { immediate: true });

/*
 * TWO MEASUREMENTS, of two different elements, because they answer two
 * different questions: the plan's available HEIGHT decides how tall an hour is
 * drawn (`plan_body`, whose own height is the space the page gave it), and the
 * track's WIDTH decides how many room columns fit on a page.
 *
 * The track is measured rather than computed from the body minus the gutter:
 * the grid also has a gap in it, and an arithmetic width that was a few pixels
 * out would page one column early or one column late for the life of the
 * display. Neither measurement feeds the other's element, so the observer
 * cannot chase itself: the track's width does not depend on the column count,
 * and the body's height does not depend on the track's.
 */
function measure(): void {
    if (body.value) {
        viewHeight.value = body.value.clientHeight;
    }

    if (track.value) {
        // `clientWidth` excludes the scrollbar the plan grows when a very long
        // day cannot fit at `hourHeight.min`, so this is the width the columns
        // actually get.
        viewWidth.value = track.value.clientWidth;
    }
}

onMounted(() => {
    measure();

    const observer = new ResizeObserver(measure);

    for (const element of [body.value, track.value]) {
        if (element) {
            observer.observe(element);
        }
    }

    onBeforeUnmount(() => observer.disconnect());
});

onBeforeUnmount(() => {
    if (rotation !== null) {
        clearInterval(rotation);
    }
});
</script>

<style scoped lang="scss">
/*
 * SIZED FOR DISTANCE, like the rest of this page: `clamp()` against the
 * viewport rather than the shared font-size tokens, which are calibrated for
 * somebody at a keyboard (see the page's own note). Spacing and radii still
 * come from the tokens; only the type scale is the display's own.
 */
.plan {
    display: flex;

    // Takes whatever height the page has left, and no more: the hour height is
    // computed from the space the body actually gets, so a plan that could grow
    // past the viewport would push the end of the day off an unscrollable wall.
    flex: 1;
    flex-direction: column;
    gap: var(--space-3);

    min-height: 0;

    &_head {
        display: grid;
        grid-template-columns: var(--plan-gutter) 1fr;
        gap: var(--space-2);
    }

    &_axis_title {
        margin: 0;

        font-size: clamp(11px, 0.9vw, 16px);
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }

    &_names {
        display: grid;
        gap: var(--space-2);
    }

    &_name {
        display: flex;
        flex-direction: column;
        gap: 2px;

        min-width: 0;
        margin: 0;
        padding-bottom: var(--space-2);

        // The content ramp, not the surface ramp: no step of the surface ramp
        // reaches 3:1 against this ground in either theme, and at distance an
        // edge that is merely almost visible is not visible.
        border-bottom: 2px solid varToRgba('content7', 0.4);

        &--busy {
            border-bottom-color: $primary500;
        }

        &_text {
            overflow: hidden;

            font-size: clamp(13px, 1.2vw, 24px);
            font-weight: 700;
            color: $content1;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        &_state {
            font-size: clamp(10px, 0.8vw, 15px);
            font-weight: 700;
            color: $content7;
            text-transform: uppercase;
            letter-spacing: 0.06em;
        }

        &--busy &_state {
            color: $primary500;
        }
    }

    /*
     * THE MEASURED ELEMENT, and the scroll container. It scrolls only when the
     * day cannot fit at `hourHeight.min` (a very long teaching day on a short
     * screen); a wall display normally has no scrollbar at all, because the
     * hour height is computed from this element's own height.
     */
    &_body {

        // Reserves the scrollbar's width whether or not it is showing, so the
        // room names above cannot shift out of line with their columns.
        scrollbar-gutter: stable;
        overflow: hidden auto;
        flex: 1;
        min-height: 0;
    }

    &_scroll {
        display: grid;
        grid-template-columns: var(--plan-gutter) 1fr;
        gap: var(--space-2);
    }

    &_axis {
        position: relative;
    }

    &_hour {
        position: absolute;
        left: 0;
        translate: 0 -50%;

        font-size: clamp(11px, 0.9vw, 18px);
        font-variant-numeric: tabular-nums;
        color: $content7;

        // The day's opening hour sits ON the top edge, so it hangs below its
        // line rather than across it.
        &--first {
            translate: 0 0;
        }
    }

    /*
     * The hour lines are the track's own background at a CONSTANT scale
     * (`--plan-hour`), so they cannot drift from the entries placed on top of
     * them: both are the same arithmetic, one in CSS and one in px from
     * `roomPlanPlacement`.
     */
    &_track {
        position: relative;
        display: grid;
        gap: var(--space-2);
        background-image: repeating-linear-gradient(
            to bottom,
            varToRgba('content7', 0.35) 0,
            varToRgba('content7', 0.35) 1px,
            transparent 1px,
            transparent var(--plan-hour)
        );
    }

    &_column {
        position: relative;
        // Clips an entry a CONFIGURED window crops (`plan_outside` says how
        // many): without it a 20:00 lab in a plan told to end at 16:00 draws
        // straight over the room names or the dots.
        overflow: hidden;
        min-width: 0;
        border-left: 1px solid varToRgba('content7', 0.25);
    }

    &_free {
        position: absolute;
        top: var(--space-4);
        left: 50%;
        translate: -50% 0;

        margin: 0;

        font-size: clamp(10px, 0.8vw, 15px);
        color: varToRgba('content7', 0.8);
        text-align: center;
    }

    &_now {
        pointer-events: none;

        position: absolute;
        right: 0;
        left: 0;

        height: 2px;

        background: $error600;
    }

    &_outside {
        margin: 0;
        font-size: clamp(10px, 0.85vw, 16px);
        color: $warning600;
        text-align: center;
    }

    &_pager {
        display: flex;
        gap: var(--space-3);
        justify-content: center;

        margin: 0;
        padding: 0;

        list-style: none;
    }

    &_dot {
        width: clamp(8px, 0.7vw, 14px);
        height: clamp(8px, 0.7vw, 14px);
        border-radius: 50%;

        background: varToRgba('content7', 0.45);

        transition: background 200ms ease, scale 200ms ease;

        &--active {
            scale: 1.25;
            background: $primary500;
        }
    }
}

/*
 * PAST IS DIMMED, NOT DROPPED. The morning stays on the plan all day: "the lab
 * was at nine" is a question somebody asks at four, and a plan that deleted the
 * answer would also be a plan that empties out as the day goes on, which reads
 * as a display losing its data.
 */
.entry {
    position: absolute;

    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 1px;

    padding: 4px 6px;
    border-radius: var(--radius-sm);

    background: $primary500;

    &--past {
        background: varToRgba('primary700', 0.45);
    }

    &--now {
        outline: 2px solid $content1;
        outline-offset: -2px;
    }

    p {
        overflow: hidden;

        margin: 0;

        font-size: clamp(9px, 0.8vw, 16px);
        line-height: 1.2;
        color: $white;
    }

    &--past p {
        color: varToRgba('white', 0.75);
    }

    &_groups {
        font-weight: 700;
    }

    &_title {
        font-weight: 600;
    }

    &_time {
        font-variant-numeric: tabular-nums;
    }
}
</style>
