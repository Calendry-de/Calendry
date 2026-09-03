<template>
    <div class="board">
        <p
            v-if="error"
            class="board_message"
            role="alert"
        >{{ error }}</p>

        <template v-else-if="board">
            <!--
                THE PRODUCT, NOT THE DEVICE, is the title. A screen's name
                ("B-block corridor", "Main entrance") is an operator's label
                for the thing hanging on the wall: it tells the person walking
                past where they already know they are, and it is the one string
                here that is worth nothing at reading distance. It stays in the
                management area, where it identifies which display somebody is
                editing, and appears on the wall only as the small stamp below.
            -->
            <header class="board_head">
                <h1 class="board_title">
                    <CommonLogo
                        :size="LOGO_SIZE"
                        wordmark
                    />
                </h1>
                <p class="board_clock">
                    <span class="board_time">{{ clock }}</span>
                    <span class="board_date">{{ today }}</span>
                </p>
            </header>

            <!--
                NAMED, not drawn as emptiness. Between terms the rooms below are
                genuinely all free, which is true and worth showing, but a
                display that showed only free rooms with no explanation would be
                indistinguishable from one whose timetable had been wiped.
            -->
            <p
                v-if="board.state === 'no-term'"
                class="board_note"
                role="status"
            >{{ t('screen.board.noTerm') }}</p>

            <ScreenRoomPlan
                v-if="board.rooms.length"
                :rooms="board.rooms"
                :day="{ startMinute: board.dayStartMinute, endMinute: board.dayEndMinute }"
                :configured="{ startMinute: board.planStartMinute, endMinute: board.planEndMinute }"
                :minute-now="minuteNow"
                :column-width="columnWidth"
                :rotate-seconds="rotateSeconds"
            />

            <p
                v-else
                class="board_message"
            >{{ t('screen.board.noRooms') }}</p>

            <!--
                WHICH DISPLAY THIS IS, for the one person who ever needs to
                know: somebody standing in front of a wall that is showing the
                wrong rooms, trying to say which screen to fix. Deliberately
                tiny and in the corner — it is a reference mark, not content,
                and at this size it costs the plan nothing.
            -->
            <p
                v-if="board.screenName"
                class="board_stamp"
            >{{ board.screenName }}</p>
        </template>
    </div>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';
import type { RoomPlanRoom } from '~/utils/roomPlan';
import { clampRoomPlanColumnWidth, clampRoomPlanRotateSeconds } from '~/utils/roomPlan';

/**
 * The lobby display: today's ROOM PLAN, rooms across and the day down.
 *
 * NO CHROME AT ALL: no nav, no header, no account menu. This page is not
 * browsed, it is mounted on a wall and left running for a term, and every
 * affordance on it is a thing nobody can click. It reads at a distance and does
 * one job: what is happening in these rooms today.
 *
 * IT COMPOSES, IT DOES NOT DRAW (CLAUDE.md, "Pages compose, they do not
 * implement"). This file owns the key, the fetch, the failure states and the
 * clock; `ScreenRoomPlan` owns measurement, paging and placement, and
 * `app/utils/roomPlan.ts` owns the arithmetic, where it is unit-tested.
 *
 * AUTHENTICATES WITH A DEVICE KEY in its own URL, never a session cookie, which
 * is why it sits in `ANONYMOUS_ROUTES`: a session check would bounce a display
 * to a login form nobody is standing at. The key holds no permissions and is
 * scoped to rooms; `GET /api/screens/board` is what enforces it.
 *
 * TWO KINDS OF SETTING, in two places, and the split is deliberate.
 *
 * `?columnWidth=` (how wide a room column is drawn, and therefore how many
 * rooms fit on a page) and `?rotate=` (seconds between pages, `0` to hold on
 * one) are properties of THIS PIECE OF GLASS: a 4K wall and a spare 22" monitor
 * want different answers from the same timetable. Nothing on the page can be
 * clicked, so they travel in the address whoever mounts the display pastes in,
 * clamped so a typo narrows the plan rather than breaking it.
 *
 * The plan's HOURS are not that. "This institution's evenings are empty" is a
 * fact about the institution, the same for every display in the building and an
 * operator's decision to make in the management area, so `planStartMinute` /
 * `planEndMinute` are columns on `screen` (issue #131) and arrive in the board
 * payload.
 */
interface Board {
    screenName: string | null;
    generatedAt: string;
    /** Minutes since TENANT-local midnight when the response was assembled. */
    nowMinute: number;
    state: 'ok' | 'no-term';
    termName?: string;
    /** The TimeGrid's day; null with no term running. */
    dayStartMinute: number | null;
    dayEndMinute: number | null;
    /** This screen's own configured hours; null for "the timetable's own day". */
    planStartMinute: number | null;
    planEndMinute: number | null;
    rooms: RoomPlanRoom[];
}

/**
 * The lockup's type size, in px. A fixed value, not a `clamp()`: `CommonLogo`
 * picks its stroke weights from this number (optical compensation, see its own
 * comment), so a size the stylesheet changed behind its back would draw the
 * wrong weight. It is a mark, not the content, and does not need to scale with
 * the wall.
 */
const LOGO_SIZE = 40;

definePageMeta({ layout: false });

const { t } = useT();
const route = useRoute();
const request = useRequestFetch();
const key = computed(() => String(route.query.key ?? ''));
const board = ref<Board | null>(null);
const error = ref('');

const columnWidth = computed(() => clampRoomPlanColumnWidth(route.query.columnWidth));
const rotateSeconds = computed(() => clampRoomPlanRotateSeconds(route.query.rotate));

/*
 * A LOCAL CLOCK, ticking every second, purely so the display looks alive.
 *
 * WHAT TIME THE INSTITUTION THINKS IT IS comes from the response
 * (`nowMinute`, tenant-local, from the same clock that chose the term week);
 * this device only interpolates the seconds since that fetch, which is why
 * `fetchedAt` is stamped beside it. A display deciding "now" from the machine
 * behind the screen would drift against the schedule it draws for a whole term
 * with nothing on screen to say so.
 */
const now = ref(new Date());
const fetchedAt = ref(now.value.getTime());
const clock = computed(() => now.value.toTimeString().slice(0, 5));
const today = computed(() => now.value.toDateString());

const minuteNow = computed(() => {
    if (!board.value) {
        return 0;
    }

    return board.value.nowMinute + (now.value.getTime() - fetchedAt.value) / 60_000;
});

async function load(): Promise<void> {
    if (!key.value) {
        error.value = t('screen.board.missingKey');

        return;
    }

    try {
        board.value = await request<Board>(`/api/screens/board?key=${encodeURIComponent(key.value)}`);
        fetchedAt.value = Date.now();
        error.value = '';
    } catch (cause) {
        const message = (cause as { data?: { message?: string } }).data?.message;

        /*
         * The message is SHOWN, not swallowed. A revoked screen and a mistyped
         * URL are different problems with different fixes, and the person who
         * can act on either is the one walking past, so the wall has to say
         * which it is rather than going blank.
         */
        error.value = message ?? t('screen.board.unreachable');
    }
}

await load();

onMounted(() => {
    const tick = setInterval(() => { now.value = new Date(); }, 1000);
    /*
     * A minute is the resolution that matters (a block boundary), and it keeps
     * a year of unattended running to ~525k requests, which is nothing. Faster
     * would buy no accuracy, since the underlying data changes when somebody
     * edits a timetable, not continuously.
     */
    const refresh = setInterval(() => { void load(); }, 60_000);

    onBeforeUnmount(() => {
        clearInterval(tick);
        clearInterval(refresh);
    });
});

/*
 * THE PRODUCT, for the same reason the heading is: the screen name is not this
 * page's to publish. Nothing on a wall reads a browser tab, and the operator
 * previewing one already knows which key they opened.
 */
useHead({ title: 'Calendry' });
</script>

<style scoped lang="scss">
/*
 * SIZED FOR DISTANCE, not for a desk. Everything here is deliberately larger
 * than the app's scale: the reader is several metres away and walking. That is
 * why this page uses `clamp()` against the viewport rather than the shared
 * font-size tokens: the tokens are calibrated for someone at a keyboard, and
 * borrowing them here would produce a technically consistent board nobody can
 * read from the far side of a corridor.
 *
 * IT IS EXACTLY THE VIEWPORT TALL, never taller: the plan inside it computes
 * its hour height from the space it is given, so a `min-height` that let the
 * page grow would push the end of the day off the bottom of a wall-mounted
 * screen that nobody can scroll.
 */
.board {
    position: relative;

    display: flex;
    flex-direction: column;
    gap: clamp(var(--space-4), 1.5vh, var(--space-6));

    height: 100vh;
    padding: clamp(var(--space-4), 2vh, var(--space-6));

    background: $surface0;

    &_head {
        display: flex;
        gap: var(--space-5);
        align-items: baseline;
        justify-content: space-between;
    }

    &_title {
        display: flex;
        margin: 0;
        color: $content1;
    }

    &_clock {
        display: flex;
        gap: var(--space-4);
        align-items: baseline;
        margin: 0;
    }

    &_time {
        font-size: clamp(20px, 2.4vw, 44px);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: $content1;
    }

    &_date {
        font-size: clamp(13px, 1.2vw, 22px);
        color: $content7;
    }

    &_message {
        margin: auto;
        font-size: clamp(17px, 2vw, 34px);
        color: $content7;
        text-align: center;
    }

    &_note {
        margin: 0;
        font-size: clamp(13px, 1.4vw, 24px);
        color: $content7;
    }

    /*
     * Out of flow, so it cannot take height from the plan or shift the
     * centred page dots, and low-contrast on purpose: legible from a metre
     * away by somebody looking for it, invisible from across the corridor.
     */
    &_stamp {
        position: absolute;
        right: var(--space-3);
        bottom: var(--space-2);

        margin: 0;

        font-size: 11px;
        color: varToRgba('content7', 0.7);
    }
}
</style>
