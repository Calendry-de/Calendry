<template>
    <CommonPage title="My unavailability">
        <p class="intro">
            Days and blocks you cannot teach. What you submit here is
            <strong>reviewed by an administrator</strong> before it affects any timetable —
            declaring unavailability is a hard rule for the scheduler, so it is not
            applied on your say-so alone.
        </p>

        <!--
            The limitation, stated where the person is about to rely on it. The
            solver's LecturerVeto reads a Session's LECTURERS; a window recorded
            against somebody assigned to a Session in any other capacity is
            stored and honoured by nobody. Leaving that unsaid would be the UI
            implying coverage the scheduler does not have.
        -->
        <p class="note">
            <Icon
                name="material-symbols:info-outline"
                aria-hidden="true"
            />
            The scheduler applies this when you are the <strong>lecturer</strong> of a session.
            Sessions you are attached to in another capacity are not affected yet.
        </p>

        <p
            v-if="!grid"
            class="note note--warn"
            role="alert"
        >
            This institution has no time grid configured, so blocks cannot be shown or
            checked. An administrator has to create one first.
        </p>

        <!--
            TWO MODES, SIDE BY SIDE AND NAMED, not one shape bent to express
            both. "I never teach Friday afternoons" and "I am away the week of
            the 14th" are different claims: one recurs for as long as it stands,
            the other has dates and ends. Expressing the second as the first
            means asking somebody to translate their holiday into week numbers,
            which is the arithmetic the machine is for.
        -->
        <div class="modes">
            <button
                class="modes_tab"
                :class="{ 'modes_tab--on': mode === 'recurring' }"
                type="button"
                @click="mode = 'recurring'"
            >
                <strong>Every week</strong>
                <span>Days or blocks you never teach</span>
            </button>
            <button
                class="modes_tab"
                :class="{ 'modes_tab--on': mode === 'holiday' }"
                type="button"
                @click="mode = 'holiday'"
            >
                <strong>Specific dates</strong>
                <span>Holiday or another absence</span>
            </button>
        </div>

        <section
            v-if="mode === 'holiday'"
            class="card"
        >
            <h2>Away on specific dates</h2>

            <AvailabilityHolidayForm
                ref="holidayForm"
                :busy="busy"
                :error="error"
                :terms="terms"
                @submit="submitHoliday"
            />
        </section>

        <section
            v-else
            class="card"
        >
            <h2>Declare unavailability</h2>

            <ManageWeekdayPicker
                v-model="draftDays"
                help="Leave every day unticked to mean the whole week."
                label="Days"
            />

            <AvailabilityBlockPicker
                v-model="draftBlocks"
                :grid="grid"
                help="Leave every block unticked to mean the whole day."
                label="Blocks"
            />

            <label class="field">
                <span class="field_label">Reason (optional)</span>
                <input
                    v-model="draftReason"
                    class="field_input"
                    maxlength="500"
                    placeholder="Fixed commitment elsewhere"
                    type="text"
                >
            </label>

            <p
                v-if="wouldBlockEverything"
                class="note note--warn"
            >
                With nothing ticked on either axis this would mean
                <strong>never available at all</strong>. Pick at least one day or block.
            </p>

            <p
                v-if="error"
                class="note note--error"
                role="alert"
            >{{ error }}</p>

            <div class="actions">
                <CommonButton
                    :disabled="busy || wouldBlockEverything"
                    type="primary"
                    @click="submit"
                >{{ busy ? 'Submitting…' : 'Submit for approval' }}</CommonButton>
            </div>
        </section>

        <section class="card">
            <header class="card_head">
                <h2>What you have declared</h2>
                <span
                    v-if="blocked"
                    class="card_meter"
                >
                    {{ blocked.blocked }} of {{ blocked.total }} teaching slots blocked
                    <template v-if="blocked.weekScopedWindows">
                        ({{ blocked.weekScopedWindows }} week-specific
                        {{ blocked.weekScopedWindows === 1 ? 'entry' : 'entries' }} not counted)
                    </template>
                </span>
            </header>

            <p
                v-if="!vetoes.length"
                class="empty"
            >Nothing declared. The scheduler may place you at any time.</p>

            <ul
                v-else
                class="rows"
            >
                <li
                    v-for="row in vetoes"
                    :key="row.id"
                    class="rows_row"
                >
                    <span
                        class="rows_status"
                        :class="`rows_status--${row.status.toLowerCase()}`"
                    >{{ STATUS_LABEL[row.status] }}</span>

                    <span class="rows_what">{{ describeRow(row) }}</span>

                    <span
                        v-if="row.reason"
                        class="rows_reason"
                    >{{ row.reason }}</span>

                    <!--
                        The load-bearing sentence on this page. Without it a
                        pending row LOOKS like a blocked Friday, and the person
                        plans around something that is not in force.
                    -->
                    <span class="rows_effect">{{ EFFECT[row.status] }}</span>

                    <span
                        v-if="row.decisionNote"
                        class="rows_reason"
                    >Reviewer: {{ row.decisionNote }}</span>

                    <button
                        class="rows_remove"
                        :disabled="busy"
                        type="button"
                        @click="remove(row.id)"
                    >Remove</button>
                </li>
            </ul>
        </section>
    </CommonPage>
</template>

<script setup lang="ts">
import type { BlockedSlotSummary, TermWindow } from '#shared/availability';
import type { TimeGrid } from '~/composables/schedule';
import AvailabilityBlockPicker from '~/components/availability/AvailabilityBlockPicker.vue';
import AvailabilityHolidayForm from '~/components/availability/AvailabilityHolidayForm.vue';
import ManageWeekdayPicker from '~/components/manage/ManageWeekdayPicker.vue';
import { describeWindow } from '~/utils/availabilityLabels';

definePageMeta({ middleware: 'my' });

useHead({ title: 'My unavailability' });

interface VetoRow {
    id: string;
    days: number[];
    blocks: number[];
    weeks: number[];
    termId: string | null;
    term: { name: string } | null;
    reason: string | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    decisionNote: string | null;
}

interface Payload {
    personId: string;
    grid: TimeGrid | null;
    terms: TermWindow[];
    vetoes: VetoRow[];
    blocked: BlockedSlotSummary | null;
}

const STATUS_LABEL: Record<VetoRow['status'], string> = {
    PENDING: 'Awaiting review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
};

/**
 * What each status MEANS for the timetable, spelled out per row.
 *
 * A badge alone is not enough. "Pending" next to "every Friday" reads as a
 * blocked Friday to anybody who is not thinking about workflow states, and the
 * whole cost of the approval step lands on the person who then discovers they
 * were scheduled anyway.
 */
const EFFECT: Record<VetoRow['status'], string> = {
    PENDING: 'Not yet in effect — the scheduler can still place you here.',
    APPROVED: 'In effect from the next schedule run.',
    REJECTED: 'Not in effect. Remove it, or talk to an administrator.',
};

/*
 * `useRequestFetch`, not `$fetch`: on the server a bare fetch carries no cookie
 * and 401s into an empty page that looks exactly like having declared nothing.
 */
const request = useRequestFetch();

const { data, refresh } = await useAsyncData(
    'my:availability',
    () => request<Payload>('/api/me/availability'),
);

const grid = computed(() => data.value?.grid ?? null);
const terms = computed(() => data.value?.terms ?? []);

/** Which entry mode the form is showing. Not persisted — it is a question, not a setting. */
const mode = ref<'recurring' | 'holiday'>('recurring');
const holidayForm = ref<{ reset: () => void } | null>(null);
const vetoes = computed(() => data.value?.vetoes ?? []);
const blocked = computed(() => data.value?.blocked ?? null);

const draftDays = ref<number[]>([]);
const draftBlocks = ref<number[]>([]);
const draftReason = ref('');
const busy = ref(false);
const error = ref('');

/** Mirrors the server's own refusal, so the button explains itself before the 422. */
const wouldBlockEverything = computed(() => draftDays.value.length === 0 && draftBlocks.value.length === 0);

async function submit() {
    busy.value = true;
    error.value = '';

    try {
        await request('/api/me/availability/vetoes', {
            method: 'POST',
            body: {
                days: draftDays.value,
                blocks: draftBlocks.value,
                weeks: [],
                reason: draftReason.value.trim() || null,
            },
        });

        draftDays.value = [];
        draftBlocks.value = [];
        draftReason.value = '';

        await refresh();
    } catch (cause) {
        error.value = (cause as { statusMessage?: string }).statusMessage ?? 'Could not submit that.';
    } finally {
        busy.value = false;
    }
}

/**
 * A holiday row reads as its dates, not as "every day, all day".
 *
 * `describeWindow` renders the wire's own emptiness convention faithfully — an
 * empty `days` IS every day — which is right for a recurring window and useless
 * for a holiday, where the empty axes are an implementation detail of blocking
 * whole weeks. Naming the term and weeks is what the person actually entered.
 */
function describeRow(row: VetoRow): string {
    if (row.weeks.length === 0) {
        return describeWindow(row, grid.value);
    }

    const label = row.term?.name ?? 'term';
    const weeks = row.weeks.map((week) => week + 1).join(', ');

    return `${label}: week${row.weeks.length === 1 ? '' : 's'} ${weeks} — away all day`;
}

async function submitHoliday(payload: { startDate: string; endDate: string; reason: string | null }) {
    busy.value = true;
    error.value = '';

    try {
        await request('/api/me/availability/holidays', { method: 'POST', body: payload });

        holidayForm.value?.reset();
        await refresh();
    } catch (cause) {
        error.value = (cause as { statusMessage?: string }).statusMessage ?? 'Could not submit that.';
    } finally {
        busy.value = false;
    }
}

async function remove(id: string) {
    busy.value = true;
    error.value = '';

    try {
        await request(`/api/me/availability/vetoes/${id}`, { method: 'DELETE' });
        await refresh();
    } catch (cause) {
        error.value = (cause as { statusMessage?: string }).statusMessage ?? 'Could not remove that.';
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped lang="scss">
.intro,
.note,
.empty {
    margin: 0;
    font-size: var(--font-size-sm);
    line-height: 1.6;
    color: $content7;
}

.note {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;

    svg {
        flex: none;
        width: 16px;
        height: 16px;
    }

    &--warn {
        color: $warning700;
    }

    &--error {
        font-weight: 600;
        color: $error700;
    }
}

.modes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);

    &_tab {
        cursor: pointer;

        display: flex;
        flex: 1 1 200px;
        flex-direction: column;
        gap: 2px;

        padding: var(--space-4) var(--space-5);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        text-align: left;

        background: $surface0;

        strong {
            font-size: var(--font-size-md);
            color: $content2;
        }

        span {
            font-size: var(--font-size-sm);
            color: $content7;
        }

        &--on {
            border-color: $primary500;
            background: $surface2;
        }
    }
}

.card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    padding: var(--space-6);
    border-radius: var(--radius-xl);

    background: $surface1;

    h2 {
        margin: 0;
        font-size: var(--font-size-md);
        font-weight: 680;
        color: $content2;
    }

    &_head {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
        align-items: baseline;
        justify-content: space-between;
    }

    &_meter {
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content7;
    }
}

.field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);

    &_label {
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content4;
    }

    &_input {
        width: 100%;
        padding: 10px var(--space-5);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content3;

        background: $surface0;

        &:focus {
            border-color: $primary500;
            outline: none;
        }
    }
}

.actions {
    display: flex;
    gap: var(--space-3);
}

.rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    margin: 0;
    padding: 0;

    list-style: none;

    &_row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: var(--space-2) var(--space-4);
        align-items: baseline;

        padding: var(--space-4);
        border-radius: var(--radius-lg);

        background: $surface0;
    }

    &_status {
        grid-row: 1;
        font-size: var(--font-size-xs);
        font-weight: 700;
        text-transform: uppercase;

        &--pending {
            color: $warning700;
        }

        &--approved {
            color: $success700;
        }

        &--rejected {
            color: $error700;
        }
    }

    &_what {
        grid-row: 1;
        font-size: var(--font-size-md);
        color: $content3;
    }

    &_effect,
    &_reason {
        grid-column: 1 / -1;
        font-size: var(--font-size-sm);
        color: $content7;
    }

    &_remove {
        cursor: pointer;

        grid-row: 1;

        padding: var(--space-1) var(--space-3);
        border: 1px solid $surface4;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-xs);
        color: $content4;

        background: $surface1;

        &:hover {
            border-color: $error700;
            color: $error700;
        }
    }
}
</style>
