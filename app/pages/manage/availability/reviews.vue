<template>
    <CommonAppShell
        :description="t('managePages.availabilityReviews.description')"
        :title="t('managePages.availabilityReviews.pageTitle')"
    >
        <!--
            `<i18n-t>` so the emphasised word stays inside ONE translatable
            sentence: it is grammar, not decoration, and German would not leave
            it at the same point in the clause.
        -->
        <i18n-t
            class="intro"
            keypath="managePages.availabilityReviews.intro"
            scope="global"
            tag="p"
        >
            <template #hard>
                <strong>{{ t('managePages.availabilityReviews.introHard') }}</strong>
            </template>
        </i18n-t>

        <p
            v-if="error"
            class="note note--error"
            role="alert"
        >{{ error }}</p>

        <!--
            ENTRY, not just review. `POST /api/availability/vetoes` existed from
            the previous slice with nothing calling it: an administrator could
            approve somebody else's window but not record one, which is the more
            common case when leave is reported by email.
        -->
        <section
            v-if="canDecide"
            class="entry"
        >
            <header class="entry_head">
                <h2>{{ t('managePages.availabilityReviews.entryHead') }}</h2>
                <span class="entry_hint">{{ t('managePages.availabilityReviews.entryHint') }}</span>
            </header>

            <label class="entry_field">
                <span class="entry_label">{{ t('managePages.availabilityReviews.personLabel') }}</span>
                <select
                    v-model="subject"
                    class="entry_input"
                >
                    <!-- `:selected` so the choice survives SSR; see ManageField. -->
                    <option
                        :selected="!subject"
                        value=""
                    >{{ t('managePages.availabilityReviews.personPlaceholder') }}</option>
                    <option
                        v-for="person in people"
                        :key="person.id"
                        :selected="person.id === subject"
                        :value="person.id"
                    >{{ person.familyName }}, {{ person.givenName }}</option>
                </select>
            </label>

            <div class="modes">
                <button
                    class="modes_tab"
                    :class="{ 'modes_tab--on': mode === 'recurring' }"
                    type="button"
                    @click="mode = 'recurring'"
                >
                    <strong>{{ t('managePages.availabilityReviews.modeRecurringTitle') }}</strong>
                    <span>{{ t('managePages.availabilityReviews.modeRecurringHint') }}</span>
                </button>
                <button
                    class="modes_tab"
                    :class="{ 'modes_tab--on': mode === 'holiday' }"
                    type="button"
                    @click="mode = 'holiday'"
                >
                    <strong>{{ t('managePages.availabilityReviews.modeHolidayTitle') }}</strong>
                    <span>{{ t('managePages.availabilityReviews.modeHolidayHint') }}</span>
                </button>
            </div>

            <template v-if="mode === 'holiday'">
                <AvailabilityHolidayForm
                    ref="holidayForm"
                    :active-days="grid?.activeDays"
                    :busy="busy === 'entry'"
                    :error="entryError"
                    :submit-label="t('managePages.availabilityReviews.record')"
                    :terms="terms"
                    @submit="submitHoliday"
                />
            </template>

            <template v-else>
                <ManageWeekdayPicker
                    v-model="draftDays"
                    :help="t('managePages.availabilityReviews.daysHelp')"
                    :label="t('managePages.availabilityReviews.daysLabel')"
                />

                <AvailabilityBlockPicker
                    v-model="draftBlocks"
                    :grid="grid"
                    :help="t('managePages.availabilityReviews.blocksHelp')"
                    :label="t('managePages.availabilityReviews.blocksLabel')"
                />

                <p
                    v-if="entryError"
                    class="note note--error"
                    role="alert"
                >{{ entryError }}</p>

                <div class="entry_actions">
                    <CommonButton
                        :disabled="busy === 'entry' || !subject || (!draftDays.length && !draftBlocks.length)"
                        type="primary"
                        @click="submitRecurring"
                    >{{ busy === 'entry'
                        ? t('managePages.availabilityReviews.recording')
                        : t('managePages.availabilityReviews.record') }}</CommonButton>
                </div>
            </template>
        </section>

        <section class="queue">
            <header class="queue_head">
                <h2>{{ t('managePages.availabilityReviews.pendingHead') }}</h2>
                <span class="queue_count">{{ pending.length }}</span>
            </header>

            <p
                v-if="!pending.length"
                class="empty"
            >{{ t('managePages.availabilityReviews.pendingEmpty') }}</p>

            <ul
                v-else
                class="rows"
            >
                <li
                    v-for="row in pending"
                    :key="row.id"
                    class="rows_row"
                >
                    <div class="rows_main">
                        <strong>{{ nameOf(row) }}</strong>
                        <span>{{ describeRow(row) }}</span>
                        <span
                            v-if="row.reason"
                            class="rows_reason"
                        >“{{ row.reason }}”</span>
                    </div>

                    <label class="rows_note">
                        <span class="sr-only">{{ t('managePages.availabilityReviews.noteLabel', { person: nameOf(row) }) }}</span>
                        <input
                            v-model="notes[row.id]"
                            maxlength="500"
                            :placeholder="t('managePages.availabilityReviews.notePlaceholder')"
                            type="text"
                        >
                    </label>

                    <div class="rows_actions">
                        <CommonButton
                            :disabled="busy === row.id"
                            type="primary"
                            @click="decide(row.id, 'APPROVED')"
                        >{{ t('managePages.availabilityReviews.approve') }}</CommonButton>
                        <CommonButton
                            :disabled="busy === row.id"
                            type="secondary"
                            @click="decide(row.id, 'REJECTED')"
                        >{{ t('managePages.availabilityReviews.reject') }}</CommonButton>
                    </div>
                </li>
            </ul>
        </section>

        <section class="queue">
            <header class="queue_head">
                <h2>{{ t('managePages.availabilityReviews.decidedHead') }}</h2>
                <span class="queue_count">{{ decided.length }}</span>
            </header>

            <p
                v-if="!decided.length"
                class="empty"
            >{{ t('managePages.availabilityReviews.decidedEmpty') }}</p>

            <ul
                v-else
                class="rows"
            >
                <li
                    v-for="row in decided"
                    :key="row.id"
                    class="rows_row"
                >
                    <div class="rows_main">
                        <!--
                            ONE MESSAGE PER STATUS, never the enum interpolated
                            or case-transformed: lowercasing an enum only ever
                            produces English (i18n/CONVENTIONS.md § "Never
                            case-transform user-facing text"). The
                            `.toLowerCase()` below builds a CSS class, which
                            that rule explicitly exempts.
                        -->
                        <span
                            class="rows_status"
                            :class="`rows_status--${row.status.toLowerCase()}`"
                        >{{ statusLabel(row.status) }}</span>
                        <strong>{{ nameOf(row) }}</strong>
                        <span>{{ describeRow(row) }}</span>
                        <span
                            v-if="row.decisionNote"
                            class="rows_reason"
                        >{{ t('managePages.availabilityReviews.decisionNote', { note: row.decisionNote }) }}</span>
                    </div>

                    <!--
                        A rejected row is KEPT so the submitter can see what
                        happened to it. Deleting is a separate, deliberate act
                        rather than what rejecting silently does.
                    -->
                    <div class="rows_actions">
                        <CommonButton
                            :disabled="busy === row.id"
                            type="destructive"
                            @click="remove(row.id)"
                        >{{ t('common.action.delete') }}</CommonButton>
                    </div>
                </li>
            </ul>
        </section>
    </CommonAppShell>
</template>

<script setup lang="ts">
import { isoDate } from '#shared/academicCalendar';
import type { TermWindow } from '#shared/availability';
import type { TimeGrid } from '~/composables/schedule';
import AvailabilityBlockPicker from '~/components/availability/AvailabilityBlockPicker.vue';
import AvailabilityHolidayForm from '~/components/availability/AvailabilityHolidayForm.vue';
import CommonAppShell from '~/components/common/CommonAppShell.vue';
import ManageWeekdayPicker from '~/components/manage/ManageWeekdayPicker.vue';
import { describeWindow } from '~/utils/availabilityLabels';
import { useT } from '~/composables/i18n';
import { useHasPermission } from '~/composables/session';

definePageMeta({
    /*
     * Gated INLINE rather than through the `manage` middleware: that one resolves
     * the route segment against the entity registry and 404s anything it does
     * not recognise, and this page is not a registry entity: it has no list,
     * no row form and no `/api/reviews` resource behind it.
     */
    middleware: [
        () => {
            const held = new Set(useSession().value?.permissions ?? []);

            if (!held.has('availability.manage_any')) {
                return abortNavigation(createError({
                    statusCode: 403,
                    message: 'Reviewing unavailability needs availability.manage_any.',
                }));
            }
        },
    ],
});

const { t } = useT();

useHead(() => ({ title: t('managePages.availabilityReviews.pageTitle') }));

interface ReviewRow {
    id: string;
    personId: string;
    days: number[];
    blocks: number[];
    weeks: number[];
    /** ISO date-times of a date-range absence (issue #118); null on a pattern. */
    absentFrom: string | null;
    absentTo: string | null;
    termId: string | null;
    term: { name: string } | null;
    reason: string | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    decisionNote: string | null;
    person: { givenName: string; familyName: string } | null;
}

interface PersonRow {
    id: string;
    givenName: string;
    familyName: string;
}

const request = useRequestFetch();

/*
 * ONE endpoint now carries the whole page: the queue, the people to record for,
 * the grid to name blocks and the terms to resolve dates against. It used to
 * borrow the grid from the preferences endpoint, which worked and read as an
 * accident; everything a page needs arriving under its own gate is the rule this
 * area follows, and a second call was one more thing to get 403 on.
 */
const { data, refresh } = await useAsyncData(
    'manage:availability-reviews',
    () => request<{
        rows: ReviewRow[];
        people: PersonRow[];
        grid: TimeGrid | null;
        terms: TermWindow[];
    }>('/api/availability/vetoes'),
);

const grid = computed(() => data.value?.grid ?? null);
const terms = computed(() => data.value?.terms ?? []);
const people = computed(() => data.value?.people ?? []);
const rows = computed(() => data.value?.rows ?? []);
const pending = computed(() => rows.value.filter((row) => row.status === 'PENDING'));
const decided = computed(() => rows.value.filter((row) => row.status !== 'PENDING'));

const notes = ref<Record<string, string>>({});
const busy = ref<string | null>(null);
const error = ref('');

/** The entry form's own state, kept apart so a failed decision cannot blank it. */
const subject = ref('');
const mode = ref<'recurring' | 'holiday'>('recurring');
const draftDays = ref<number[]>([]);
const draftBlocks = ref<number[]>([]);
const entryError = ref('');
const holidayForm = ref<{ reset: () => void } | null>(null);

// UI only: every route re-checks. Kept because the page is reachable with
// `read_any` through a direct URL even though the nav offers it only to
// `manage_any`.
const canDecide = useHasPermission('availability.manage_any');

/**
 * A holiday row reads as its term and weeks, a recurring one as its pattern.
 *
 * `describeWindow` renders the wire's emptiness convention faithfully: empty
 * `days` IS every day, which is right for a recurring window and misleading for
 * a holiday, where the empty axes are how "the whole of these weeks" is spelled.
 */
function describeRow(row: ReviewRow): string {
    if (row.weeks.length === 0) {
        return describeWindow(t, row, grid.value);
    }

    // A DATED absence (issue #118) reads as its dates: that is what the person
    // entered, and since the dates are what reaches the solver, listing the
    // touched weeks would overstate what is blocked.
    if (row.absentFrom && row.absentTo) {
        return t('managePages.availabilityReviews.holidayRowDates', {
            term: row.term?.name ?? t('managePages.availabilityReviews.holidayRowTerm'),
            from: isoDate(new Date(row.absentFrom)),
            to: isoDate(new Date(row.absentTo)),
        });
    }

    // ONE plural message: `week{s}` was a word split across an expression, so
    // no part of it could be keyed, and German pluralises the stem.
    return t('managePages.availabilityReviews.holidayRow', {
        term: row.term?.name ?? t('managePages.availabilityReviews.holidayRowTerm'),
        weeks: row.weeks.map((week) => week + 1).join(', '),
        count: row.weeks.length,
    });
}

/**
 * One message per decided status, never the raw enum: an interpolated or
 * lowercased enum value only ever renders English.
 */
function statusLabel(status: ReviewRow['status']): string {
    return status === 'APPROVED'
        ? t('managePages.availabilityReviews.statusApproved')
        : t('managePages.availabilityReviews.statusRejected');
}

async function submitRecurring() {
    busy.value = 'entry';
    entryError.value = '';

    try {
        await request('/api/availability/vetoes', {
            method: 'POST',
            body: { personId: subject.value, days: draftDays.value, blocks: draftBlocks.value, weeks: [] },
        });

        draftDays.value = [];
        draftBlocks.value = [];
        await refresh();
    } catch (cause) {
        entryError.value = serverErrorMessage(cause)
            ?? t('managePages.availabilityReviews.recordError');
    } finally {
        busy.value = null;
    }
}

async function submitHoliday(payload: { startDate: string; endDate: string; reason: string | null }) {
    if (!subject.value) {
        entryError.value = t('managePages.availabilityReviews.pickPersonFirst');

        return;
    }

    busy.value = 'entry';
    entryError.value = '';

    try {
        await request('/api/availability/vetoes/holidays', {
            method: 'POST',
            body: { ...payload, personId: subject.value },
        });

        holidayForm.value?.reset();
        await refresh();
    } catch (cause) {
        entryError.value = serverErrorMessage(cause)
            ?? t('managePages.availabilityReviews.recordError');
    } finally {
        busy.value = null;
    }
}

function nameOf(row: ReviewRow): string {
    return row.person
        ? `${row.person.givenName} ${row.person.familyName}`.trim()
        // An unresolvable reference shows the id rather than an empty cell: a
        // missing name is something to see, not to hide.
        : row.personId;
}

async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    if (!canDecide.value) {
        return;
    }

    busy.value = id;
    error.value = '';

    try {
        await request(`/api/availability/vetoes/${id}/decision`, {
            method: 'POST',
            body: { decision, note: notes.value[id]?.trim() || null },
        });

        await refresh();
    } catch (cause) {
        error.value = serverErrorMessage(cause)
            ?? t('managePages.availabilityReviews.decisionError');
    } finally {
        busy.value = null;
    }
}

async function remove(id: string) {
    busy.value = id;
    error.value = '';

    try {
        await request(`/api/availability/vetoes/${id}`, { method: 'DELETE' });
        await refresh();
    } catch (cause) {
        error.value = serverErrorMessage(cause)
            ?? t('managePages.availabilityReviews.deleteError');
    } finally {
        busy.value = null;
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

.note--error {
    font-weight: 600;
    color: $error700;
}

.entry {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    padding: var(--space-6);
    border-radius: var(--radius-xl);

    background: $surface1;

    &_head {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
        align-items: baseline;

        h2 {
            margin: 0;
            font-size: var(--font-size-md);
            font-weight: 680;
            color: $content2;
        }
    }

    &_hint {
        font-size: var(--font-size-sm);
        color: $content7;
    }

    &_field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        max-width: 360px;
    }

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
    }

    &_actions {
        display: flex;
        gap: var(--space-3);
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

.queue {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    &_head {
        display: flex;
        gap: var(--space-3);
        align-items: baseline;

        h2 {
            margin: 0;
            font-size: var(--font-size-md);
            font-weight: 680;
            color: $content2;
        }
    }

    &_count {
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content7;
    }
}

.rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    margin: 0;
    padding: 0;

    list-style: none;

    &_row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: center;
        justify-content: space-between;

        padding: var(--space-5);
        border-radius: var(--radius-xl);

        background: $surface1;
    }

    &_main {
        display: flex;
        flex-direction: column;
        gap: 2px;

        font-size: var(--font-size-sm);
        color: $content3;
    }

    &_reason {
        color: $content7;
    }

    &_status {
        font-size: var(--font-size-xs);
        font-weight: 700;

        &--approved {
            color: $success700;
        }

        &--rejected {
            color: $error700;
        }
    }

    &_note input {
        min-width: 220px;
        padding: 8px var(--space-4);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-sm);
        color: $content3;

        background: $surface0;
    }

    &_actions {
        display: flex;
        gap: var(--space-2);
    }
}
</style>
