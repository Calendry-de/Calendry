<template>
    <div class="plan">
        <p
            v-if="error"
            class="plan_message"
            role="alert"
        >{{ error }}</p>

        <template v-else-if="board">
            <header class="plan_head">
                <h1 class="plan_title">{{ board.screenName ?? t('screen.plan.fallbackName') }}</h1>
                <p class="plan_clock">
                    <span class="plan_time">{{ clock }}</span>
                </p>
            </header>

            <ul class="plan_days">
                <li
                    v-for="day in board.days"
                    :key="day.date"
                    class="day"
                >
                    <header class="day_head">
                        <h2 class="day_name">{{ day.offset === 0 ? t('screen.plan.today') : t('screen.plan.tomorrow') }}</h2>
                        <p class="day_date">{{ longDate(day.date) }}</p>
                    </header>

                    <!--
                        EVERY EMPTY DAY IS NAMED, never drawn as emptiness, and
                        the three reasons are kept apart because they are
                        different facts a reader can act on: a term gap, a
                        weekend, and the ordinary "nothing changed today" that
                        is the whole point of walking up to this board.
                    -->
                    <p
                        v-if="day.state !== 'ok'"
                        class="day_note"
                        role="status"
                    >{{ t(EMPTY_STATE_KEY[day.state]) }}</p>

                    <ul
                        v-else
                        class="entries"
                    >
                        <li
                            v-for="entry in day.entries"
                            :key="entry.sessionId"
                            class="entry"
                            :class="[`entry--${entry.change}`, { 'entry--now': entry.isNow }]"
                        >
                            <p class="entry_when">
                                <span class="entry_time">{{ timeOf(entry) }}</span>
                                <span
                                    v-if="entry.isNow"
                                    class="entry_now"
                                >{{ t('screen.plan.nowLabel') }}</span>
                            </p>

                            <div class="entry_body">
                                <p class="entry_title">
                                    <!--
                                        PUNCTUATION, NOT GRAMMAR: the pieces
                                        joined here are tenant vocabulary
                                        (Offering title, Group names, Room
                                        names), each already complete and never
                                        translated, so the separators stay in
                                        the template.
                                    -->
                                    {{ entry.title }}
                                    <template v-if="entry.groups.length">· {{ entry.groups.join(', ') }}</template>
                                    <template v-if="entry.rooms.length">· {{ entry.rooms.join(', ') }}</template>
                                </p>

                                <p class="entry_detail">
                                    <span class="entry_change">{{ t(CHANGE_KEY[entry.change]) }}</span>
                                    <span v-if="entry.coveringLecturer">
                                        {{ t('screen.plan.coveredBy', { name: entry.coveringLecturer }) }}
                                    </span>
                                    <span v-if="entry.originalLecturers.length">
                                        {{ t('screen.plan.insteadOf', { names: entry.originalLecturers.join(', ') }) }}
                                    </span>
                                    <span v-if="entry.change !== 'covered' && entry.movedFrom">
                                        {{ t('screen.plan.wasAt', { time: hhmm(entry.movedFrom.startMinute) }) }}
                                    </span>
                                    <span v-if="entry.movedTo">
                                        {{ t('screen.plan.movesTo', {
                                            day: weekdayName(entry.movedTo.isoWeekday),
                                            time: hhmm(entry.movedTo.startMinute),
                                        }) }}
                                    </span>
                                    <span v-if="entry.reason">{{ entry.reason }}</span>
                                </p>
                            </div>
                        </li>
                    </ul>
                </li>
            </ul>
        </template>
    </div>
</template>

<script setup lang="ts">
import type { MessageKey } from '~~/i18n/keys';
import { useLanguage, useT } from '~/composables/i18n';

/**
 * The Vertretungsplan on a wall: the second lobby-display mode (issue #31).
 *
 * SAME DEVICE CONTRACT AS `/screen`, deliberately, and the three properties
 * that matter are copied rather than reinvented: no chrome at all, sized for
 * distance with `clamp()` against the VIEWPORT rather than the app's font
 * tokens (which are calibrated for someone at a keyboard), and refreshed on a
 * 60 s interval with every time-dependent decision made SERVER-side. `isNow`
 * in particular is never computed here: a display left running for a term
 * would otherwise drift against the schedule it draws.
 *
 * "TODAY" IS THE TENANT'S DAY, not this device's. Nothing on this page derives
 * a date from the browser: `day.date` and `day.offset` arrive already resolved
 * in `Tenant.timezone`, and the local clock below exists only so the board
 * looks alive.
 *
 * A SEPARATE PAGE FROM `/screen`, because a screen's mode is fixed when its
 * key is issued and the management form hands out the matching address. The
 * data route refuses a key of the other mode by name, and that refusal is
 * SHOWN below rather than swallowed: it names the address that would work, so
 * whoever walks past can fix it.
 */
interface SlotSpan {
    isoWeekday: number;
    blockIndex: number;
    startMinute: number;
    endMinute: number;
}

type Change = 'covered' | 'cancelled' | 'moved-in' | 'moved-away';
type DayState = 'ok' | 'no-substitutions' | 'no-term' | 'not-a-teaching-day';

interface Entry {
    sessionId: string;
    change: Change;
    title: string;
    kind: string;
    groups: string[];
    rooms: string[];
    originalLecturers: string[];
    coveringLecturer: string | null;
    reason: string | null;
    slot: SlotSpan | null;
    movedFrom: SlotSpan | null;
    movedTo: SlotSpan | null;
    isNow: boolean;
}

interface Day {
    date: string;
    isoWeekday: number;
    offset: number;
    state: DayState;
    termName: string | null;
    entries: Entry[];
}

interface Plan {
    screenName: string | null;
    generatedAt: string;
    mode: 'SUBSTITUTION_PLAN';
    days: Day[];
}

/**
 * One message per named empty state. A `Record` keyed by the union rather than
 * a chain of `v-if`s, so adding a state to the API is a typecheck error here
 * instead of a day that silently renders blank.
 */
const EMPTY_STATE_KEY: Record<Exclude<DayState, 'ok'>, MessageKey> = {
    'no-substitutions': 'screen.plan.noSubstitutions',
    'no-term': 'screen.plan.noTerm',
    'not-a-teaching-day': 'screen.plan.notTeachingDay',
};

const CHANGE_KEY: Record<Change, MessageKey> = {
    covered: 'screen.plan.change.covered',
    cancelled: 'screen.plan.change.cancelled',
    'moved-in': 'screen.plan.change.movedIn',
    'moved-away': 'screen.plan.change.movedAway',
};

definePageMeta({ layout: false });

const { t } = useT();
const { locale } = useLanguage();
const route = useRoute();
const request = useRequestFetch();
const key = computed(() => String(route.query.key ?? ''));
const board = ref<Plan | null>(null);
const error = ref('');

/* Purely so the display looks alive; nothing on the page is decided from it. */
const now = ref(new Date());
const clock = computed(() => now.value.toTimeString().slice(0, 5));

function hhmm(minutes: number): string {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The clock range an entry occupies, or an em dash for one with no slot left. */
function timeOf(entry: Entry): string {
    const span = entry.slot ?? entry.movedFrom;

    return span ? `${hhmm(span.startMinute)}–${hhmm(span.endMinute)}` : '—';
}

/*
 * FORMATTED FROM THE TENANT-LOCAL DATE STRING the server sent, parsed as UTC
 * and rendered in UTC. Letting the browser interpret `YYYY-MM-DD` in its own
 * zone is how a board in a device set to the wrong timezone captions Tuesday's
 * substitutions "Monday".
 */
function longDate(date: string): string {
    return new Intl.DateTimeFormat(locale.value, {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
}

/** An ISO weekday's name, off a known Monday so the mapping cannot drift. */
function weekdayName(isoWeekday: number): string {
    const monday = Date.UTC(2024, 0, 1);

    return new Intl.DateTimeFormat(locale.value, { weekday: 'long', timeZone: 'UTC' })
        .format(new Date(monday + (isoWeekday - 1) * 86_400_000));
}

async function load(): Promise<void> {
    if (!key.value) {
        error.value = t('screen.board.missingKey');

        return;
    }

    try {
        board.value = await request<Plan>(`/api/screens/substitutions?key=${encodeURIComponent(key.value)}`);
        error.value = '';
    } catch (cause) {
        const message = (cause as { data?: { message?: string } }).data?.message;

        /*
         * SHOWN, not swallowed. A revoked screen, a mistyped URL and a key
         * configured for the other board are three different problems with
         * three different fixes, and the person who can act on any of them is
         * the one walking past, so the wall has to say which it is rather than
         * going blank.
         */
        error.value = message ?? t('screen.board.unreachable');
    }
}

await load();

onMounted(() => {
    const tick = setInterval(() => { now.value = new Date(); }, 1000);
    // A minute is the resolution that matters (a block boundary), and the same
    // interval the room board runs on: ~525k requests over a year of
    // unattended running, which is nothing.
    const refresh = setInterval(() => { void load(); }, 60_000);

    onBeforeUnmount(() => {
        clearInterval(tick);
        clearInterval(refresh);
    });
});

useHead({ title: () => board.value?.screenName ?? t('screen.plan.fallbackName') });
</script>

<style scoped lang="scss">
/*
 * SIZED FOR DISTANCE, exactly as `/screen` is and for the same reason: the
 * reader is several metres away and walking. That is why this page uses
 * `clamp()` against the viewport rather than the shared font-size tokens,
 * which are calibrated for someone at a keyboard. Spacing, radii and colour
 * still come from tokens.
 */
.plan {
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
        margin: 0;
    }

    &_time {
        font-size: clamp(24px, 3.2vw, 56px);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: $content1;
    }

    &_message {
        margin: auto;
        font-size: clamp(17px, 2vw, 34px);
        color: $content7;
        text-align: center;
    }

    &_days {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
        gap: clamp(var(--space-4), 1.5vh, var(--space-6));

        margin: 0;
        padding: 0;

        list-style: none;
    }
}

.day {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    padding: clamp(var(--space-5), 2vh, var(--space-7));

    // The content ramp: no step of the surface ramp reaches 3:1 against this
    // ground in either theme, and on a wall an edge that is merely almost
    // visible is not visible.
    border: 2px solid varToRgba('content7', 0.4);
    border-radius: var(--radius-lg);

    &_head {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3) var(--space-4);
        align-items: baseline;
    }

    &_name {
        margin: 0;
        font-size: clamp(20px, 2.4vw, 40px);
        font-weight: 700;
        color: $content1;
    }

    &_date {
        margin: 0;
        font-size: clamp(13px, 1.2vw, 22px);
        color: $content7;
    }

    &_note {
        margin: 0;
        font-size: clamp(15px, 1.6vw, 28px);
        color: $content7;
    }
}

.entries {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    margin: 0;
    padding: 0;

    list-style: none;
}

.entry {
    display: flex;
    gap: var(--space-4);
    align-items: baseline;

    padding-left: var(--space-4);
    border-left: 4px solid varToRgba('content7', 0.5);

    &--covered {
        border-left-color: $primary500;
    }

    &--cancelled {
        border-left-color: $error600;
    }

    &--moved-in,
    &--moved-away {
        border-left-color: $warning800;
    }

    &--now {
        background: varToRgba('primary500', 0.12);
    }

    &_when {
        display: flex;
        flex: none;
        flex-direction: column;
        gap: var(--space-1);

        min-width: 9ch;
        margin: 0;
    }

    &_time {
        font-size: clamp(15px, 1.5vw, 26px);
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        color: $content1;
    }

    &_now {
        font-size: clamp(10px, 0.9vw, 16px);
        font-weight: 700;
        color: $primary500;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }

    &_body {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    &_title {
        margin: 0;
        font-size: clamp(16px, 1.7vw, 28px);
        font-weight: 600;
        color: $content1;
    }

    &_detail {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1) var(--space-3);

        margin: 0;

        font-size: clamp(12px, 1.1vw, 20px);
        color: $content7;
    }

    &_change {
        font-weight: 700;
        color: $content2;
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }
}
</style>
