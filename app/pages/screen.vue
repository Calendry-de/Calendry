<template>
    <div class="board">
        <p
            v-if="error"
            class="board_message"
            role="alert"
        >{{ error }}</p>

        <template v-else-if="board">
            <header class="board_head">
                <h1 class="board_title">{{ board.screenName ?? 'Room board' }}</h1>
                <p class="board_clock">
                    <span class="board_time">{{ clock }}</span>
                    <span class="board_date">{{ today }}</span>
                </p>
            </header>

            <!--
                NAMED, not drawn as emptiness. Between terms the rooms below are
                genuinely all free, which is true and worth showing — but a
                display that showed only free rooms with no explanation would be
                indistinguishable from one whose timetable had been wiped.
            -->
            <p
                v-if="board.state === 'no-term'"
                class="board_note"
                role="status"
            >No term is running today.</p>

            <ul class="board_rooms">
                <li
                    v-for="room in board.rooms"
                    :key="room.id"
                    class="room"
                    :class="{ 'room--busy': room.current }"
                >
                    <p class="room_name">{{ room.name }}</p>

                    <div class="room_state">
                        <template v-if="room.current">
                            <p class="room_label">Now</p>
                            <p class="room_session">{{ room.current.title }}</p>
                            <p class="room_meta">
                                {{ hhmm(room.current.startMinute) }}–{{ hhmm(room.current.endMinute) }}
                                <template v-if="room.current.groups.length">
                                    · {{ room.current.groups.join(', ') }}
                                </template>
                            </p>
                        </template>

                        <template v-else>
                            <p class="room_label room_label--free">Free</p>
                            <p
                                v-if="room.next"
                                class="room_meta"
                            >
                                Next {{ hhmm(room.next.startMinute) }} · {{ room.next.title }}
                            </p>
                            <p
                                v-else
                                class="room_meta"
                            >Nothing else today</p>
                        </template>
                    </div>
                </li>
            </ul>

            <p
                v-if="!board.rooms.length"
                class="board_message"
            >This screen has no rooms to show.</p>
        </template>
    </div>
</template>

<script setup lang="ts">
/**
 * The lobby display.
 *
 * NO CHROME AT ALL — no nav, no header, no account menu. This page is not
 * browsed, it is mounted on a wall and left running for a term, and every
 * affordance on it is a thing nobody can click. It reads at a distance and does
 * one job: which rooms are busy right now.
 *
 * AUTHENTICATES WITH A DEVICE KEY in its own URL, never a session cookie, which
 * is why it sits in `ANONYMOUS_ROUTES` — a session check would bounce a display
 * to a login form nobody is standing at. The key holds no permissions and is
 * scoped to rooms; `GET /api/screens/board` is what enforces it.
 */
interface Entry {
    id: string;
    title: string;
    groups: string[];
    startMinute: number;
    endMinute: number;
    isNow: boolean;
}

interface BoardRoom {
    id: string;
    name: string;
    isVirtual: boolean;
    current: Entry | null;
    next: Entry | null;
    entries: Entry[];
}

interface Board {
    screenName: string | null;
    generatedAt: string;
    state: 'ok' | 'no-term';
    termName?: string;
    rooms: BoardRoom[];
}

definePageMeta({ layout: false });

const route = useRoute();
const request = useRequestFetch();
const key = computed(() => String(route.query.key ?? ''));
const board = ref<Board | null>(null);
const error = ref('');

/*
 * A LOCAL CLOCK, ticking every second, purely so the display looks alive — but
 * "is this room busy" is decided SERVER-side (`isNow`), from the same clock that
 * chose the term week. A display left running for months would otherwise drift
 * against the schedule it draws and there would be nothing on screen to say so.
 */
const now = ref(new Date());
const clock = computed(() => now.value.toTimeString().slice(0, 5));
const today = computed(() => now.value.toDateString());

function hhmm(minutes: number): string {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

async function load(): Promise<void> {
    if (!key.value) {
        error.value = 'This display has no key. Open it with the address the screen was set up with.';

        return;
    }

    try {
        board.value = await request<Board>(`/api/screens/board?key=${encodeURIComponent(key.value)}`);
        error.value = '';
    } catch (cause) {
        const message = (cause as { data?: { message?: string } }).data?.message;

        /*
         * The message is SHOWN, not swallowed. A revoked screen and a mistyped
         * URL are different problems with different fixes, and the person who
         * can act on either is the one walking past — so the wall has to say
         * which it is rather than going blank.
         */
        error.value = message ?? 'Could not reach the timetable.';
    }
}

await load();

onMounted(() => {
    const tick = setInterval(() => { now.value = new Date(); }, 1000);
    /*
     * A minute is the resolution that matters — a block boundary — and it keeps
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

useHead({ title: () => board.value?.screenName ?? 'Room board' });
</script>

<style scoped lang="scss">
/*
 * SIZED FOR DISTANCE, not for a desk. Everything here is deliberately larger
 * than the app's scale: the reader is several metres away and walking. That is
 * why this page uses `clamp()` against the viewport rather than the shared
 * font-size tokens — the tokens are calibrated for someone at a keyboard, and
 * borrowing them here would produce a technically consistent board nobody can
 * read from the far side of a corridor.
 */
.board {
    display: flex;
    flex-direction: column;
    gap: clamp(var(--space-5), 2vh, var(--space-7));

    min-height: 100vh;
    padding: clamp(var(--space-5), 3vh, var(--space-8));

    background: $surface0;

    &_head {
        display: flex;
        gap: var(--space-5);
        align-items: baseline;
        justify-content: space-between;
    }

    &_title {
        margin: 0;
        font-size: clamp(24px, 3.2vw, 56px);
        font-weight: 700;
        color: $content1;
    }

    &_clock {
        display: flex;
        gap: var(--space-4);
        align-items: baseline;
        margin: 0;
    }

    &_time {
        font-size: clamp(24px, 3.2vw, 56px);
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

    &_rooms {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: clamp(var(--space-4), 1.5vh, var(--space-6));

        margin: 0;
        padding: 0;

        list-style: none;
    }
}

.room {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    padding: clamp(var(--space-5), 2vh, var(--space-7));

    // The content ramp, because no step of the surface ramp reaches 3:1 against
    // this ground in either theme — and on a wall, at distance, an edge that is
    // merely almost visible is not visible.
    border: 2px solid varToRgba('content7', 0.4);
    border-radius: var(--radius-lg);

    &--busy {
        border-color: $primary500;
    }

    &_name {
        margin: 0;
        font-size: clamp(20px, 2.4vw, 40px);
        font-weight: 700;
        color: $content1;
    }

    &_state {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    &_label {
        margin: 0;

        font-size: clamp(11px, 1vw, 18px);
        font-weight: 700;
        color: $primary500;
        text-transform: uppercase;
        letter-spacing: 0.08em;

        &--free {
            color: $content7;
        }
    }

    &_session {
        margin: 0;
        font-size: clamp(17px, 1.8vw, 30px);
        font-weight: 600;
        color: $content1;
    }

    &_meta {
        margin: 0;
        font-size: clamp(13px, 1.2vw, 22px);
        font-variant-numeric: tabular-nums;
        color: $content7;
    }
}
</style>
