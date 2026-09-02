<template>
    <section class="avail">
        <h3 class="avail_heading">Availability within a term</h3>

        <p class="avail_help">
            Leave a term blank to make this group available for all of it. Setting dates
            restricts placement to that range, for a cohort that runs the first half of a
            term, or joins late.
        </p>

        <!--
            THE ENABLEMENT CAVEAT, stated where the data is entered.

            Windows are Group data; whether the scheduler honours them is the
            tenant's `group_veto` rule, which is HARD but off until enabled. A
            page that took the dates and said nothing would be the third
            "recorded, but is it used?" surface in this app, and the other two
            each took a correction to get right.

            TWO STATES, not one, and the second is the worse one. This condition
            was `vetoRule && !vetoRule.isEnabled`, which treated a MISSING rule
            as nothing to mention, and a missing rule is exactly what every
            tenant provisioned before this type has, because a new catalogue type
            needs `backfill:constraints` before it exists as a row. So the
            silence fell precisely where the person could not fix it from here.
            Caught by rendering the page rather than by reading the condition.
        -->
        <!--
            FOUR STATES, NOT THREE. Whether these dates bind depends on a rule
            this panel may not be allowed to read, so "there is no such rule" and
            "I cannot tell" have to be different sentences. They were the same
            one, and it asserted the first: a group editor without
            `constraint.read` was told the institution had no rule and an
            administrator needed to add it, on a tenant where the rule existed
            and was enabled.
        -->
        <p
            v-if="!rulesReadable || !vetoRule || !vetoRule.isEnabled"
            class="avail_note"
            role="status"
        >
            <Icon
                name="material-symbols:info-outline"
                aria-hidden="true"
            />
            <span v-if="!rulesReadable">
                <strong>Saved.</strong>
                Whether the scheduler honours these dates depends on a rule this account
                cannot read, so this panel cannot say. The dates themselves are stored
                either way.
            </span>
            <span v-else-if="vetoRule">
                <strong>Saved, but not yet enforced.</strong>
                “{{ vetoRule.name }}” is switched off, so the scheduler currently ignores
                these dates. Enable it under Constraints to make them binding.
            </span>
            <span v-else>
                <strong>Saved, but not yet enforced.</strong>
                This institution has no “group availability” rule configured, so the
                scheduler currently ignores these dates. An administrator needs to add it
                before they take effect.
            </span>
        </p>

        <p
            v-if="error"
            class="avail_error"
            role="alert"
        >{{ error }}</p>

        <p
            v-if="!terms.length"
            class="avail_empty"
        >No terms defined yet, so there is nothing to narrow.</p>

        <ul
            v-else
            class="avail_list"
        >
            <li
                v-for="term in terms"
                :key="term.id"
                class="avail_row"
            >
                <span class="avail_term">
                    {{ term.name }}
                    <span class="avail_span">{{ formatDate(term.startDate, locale) }} – {{ formatDate(term.endDate, locale) }}</span>
                </span>

                <template v-if="readonly">
                    <p class="avail_static">{{ describe(term) }}</p>
                </template>

                <template v-else>
                    <label class="avail_field">
                        <span class="avail_field-label">Available from</span>
                        <input
                            class="avail_input"
                            :max="isoOf(term.endDate)"
                            :min="isoOf(term.startDate)"
                            type="date"
                            :value="draft[term.id]?.availableFrom ?? ''"
                            @change="edit(term.id, 'availableFrom', ($event.target as HTMLInputElement).value)"
                        >
                    </label>

                    <label class="avail_field">
                        <span class="avail_field-label">Available to</span>
                        <input
                            class="avail_input"
                            :max="isoOf(term.endDate)"
                            :min="isoOf(term.startDate)"
                            type="date"
                            :value="draft[term.id]?.availableTo ?? ''"
                            @change="edit(term.id, 'availableTo', ($event.target as HTMLInputElement).value)"
                        >
                    </label>
                </template>

                <!--
                    THE PREVIEW, and it is not decoration. `Unavailability.weeks`
                    is an index into the term's calendar weeks, so a window
                    ending mid-week frees the WHOLE of that week, the same
                    non-obvious rounding the calendar-period editor earned a
                    preview for. Without it a tenant sets 15 May and has no way
                    to discover that the solver was told something slightly
                    wider.
                -->
                <p
                    class="avail_preview"
                    role="status"
                >{{ preview(term) }}</p>
            </li>
        </ul>
    </section>
</template>

<script setup lang="ts">
import { blackedOutWeeks, weekCountOf } from '#shared/academicCalendar';
import { useViewerLocale } from '~/composables/locale';
import { formatDate } from '~/utils/formatDate';

const locale = useViewerLocale();

/**
 * A Group's per-Term availability window.
 *
 * OWN COMPONENT rather than more of `ManageGroupForm`, which was already at its
 * one bespoke responsibility (the cycle-safe parent picker). This owns a
 * different boundary: a sub-resource with its own endpoint, its own save, and a
 * preview of a mapping the tenant cannot otherwise see.
 *
 * SAVES IMMEDIATELY, per change, like every other relation: it is not part of
 * the entity's Save transaction. Which also means it needs an id to hang off,
 * so the parent renders it in edit mode only.
 */
const props = defineProps<{
    groupId: string;
    readonly: boolean;
}>();

interface TermRow {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
}

interface WindowRow {
    termId: string;
    availableFrom: string | null;
    availableTo: string | null;
}

/** Editable state, keyed by term. `''` for a cleared bound, never `null`. */
type Draft = Record<string, { availableFrom: string; availableTo: string } | undefined>;

const request = useRequestFetch();
const error = ref('');
const draft = ref<Draft>({});

interface ConstraintRow {
    type: string;
    name: string;
    isEnabled: boolean;
}

/*
 * `useRequestFetch()`, never bare `$fetch`: server-side the latter drops the
 * browser cookie, so the call 401s and this renders its empty state:
 * indistinguishable from a tenant with no terms.
 *
 * A BARE ARRAY, not `{ rows }`. `/api/[resource]` switches shape on `limit`:
 * paginated callers get `{ rows, total }`, everyone else gets the array. Both
 * fetches here were first written as `{ rows }`, and the two halves failed
 * differently in a way worth remembering: `/api/constraints` threw
 * `Cannot read properties of undefined (reading 'find')` during SSR, while
 * `/api/terms` hit a `?? []` fallback and rendered "No terms defined yet" for a
 * tenant with two. The crash was the lucky half.
 *
 * Typecheck could not catch either: `request<T>()` is an unchecked assertion
 * about what the server sends, so a wrong `T` is a lie the compiler believes.
 */
const asyncData = useAsyncData(
    `group-availability-${props.groupId}`,
    async () => {
        const [termList, windows, constraints] = await Promise.all([
            request<TermRow[]>('/api/terms'),
            request<WindowRow[]>(`/api/groups/${props.groupId}/availability`),
            /*
             * Tolerant: a caller who may edit groups need not hold
             * `constraint.read`, and the enablement note is an explanation
             * rather than the feature. Failing the whole panel over it would
             * hide the editor from exactly the person sent here to use it.
             */
            request<ConstraintRow[]>('/api/constraints')
                .then((rows) => ({ rows, readable: true }))
                /*
                 * NULL, not an empty list. Returning `[]` on failure made
                 * "there is no such rule" and "I may not read the rules" the
                 * same value, and the note below then stated the first as
                 * fact: telling somebody their dates are ignored and an
                 * administrator must add a rule, for a tenant where that rule
                 * exists and is switched on.
                 */
                .catch(() => ({ rows: null, readable: false })),
        ]);

        return { termList, windows, constraints };
    },
);

const terms = computed<TermRow[]>(() => asyncData.data.value?.termList ?? []);

/** False when the constraint list could not be read at all; see the fetch. */
const rulesReadable = computed(() => asyncData.data.value?.constraints.readable ?? false);

const vetoRule = computed(() => asyncData.data.value?.constraints.rows
    ?.find((row) => row.type === 'group_veto'));

/*
 * Seeded from the AWAITED promise, not from a watcher. Vue does not flush
 * watchers during SSR, so `watch(data, seed, { immediate: true })` runs once
 * before the fetch resolves and never again: first render would show empty
 * inputs for a group that has windows saved.
 */
await asyncData;
seed();

// Later client-side refreshes only.
watch(() => asyncData.data.value?.windows, seed);

function seed(): void {
    const next: Draft = {};

    for (const row of asyncData.data.value?.windows ?? []) {
        next[row.termId] = {
            availableFrom: isoOf(row.availableFrom),
            availableTo: isoOf(row.availableTo),
        };
    }

    draft.value = next;
}

/** ISO date (YYYY-MM-DD) from whatever the API returned, or `''`. */
function isoOf(value: string | null | undefined): string {
    return value ? String(value).slice(0, 10) : '';
}

async function edit(termId: string, key: 'availableFrom' | 'availableTo', value: string): Promise<void> {
    const current = draft.value[termId] ?? { availableFrom: '', availableTo: '' };
    const next = { ...current, [key]: value };

    draft.value = { ...draft.value, [termId]: next };
    await save();
}

async function save(): Promise<void> {
    error.value = '';

    /*
     * A PUT-SET, so a term with no bounds is simply absent from the payload and
     * its row is deleted. That is how a window is cleared, and it is why
     * clearing both inputs needs no separate "remove" affordance: an absent row
     * and a boundless one already mean the same thing, and the database refuses
     * to store the second.
     */
    const rows = Object.entries(draft.value)
        .filter(([, window]) => window && (window.availableFrom || window.availableTo))
        .map(([termId, window]) => ({
            termId,
            availableFrom: window!.availableFrom || null,
            availableTo: window!.availableTo || null,
        }));

    try {
        /*
         * A BARE ARRAY as the body, not `{ rows }`: `[relation].put.ts` parses
         * `z.array(config.item)`. Sent as `{ rows }` first, which is a flat 400
         * with nothing saved; the same wrapper assumption also broke both GET
         * shapes above. The rule that would have avoided all three: read the
         * route, do not infer the envelope.
         */
        await request(`/api/groups/${props.groupId}/availability`, {
            method: 'PUT',
            body: rows,
        });
    } catch (cause) {
        const message = (cause as { data?: { message?: string } }).data?.message;

        error.value = message ?? 'Could not save the availability window.';
    }
}

/** The stored window in words, for the read-only rendering. */
function describe(term: TermRow): string {
    const window = draft.value[term.id];

    if (!window?.availableFrom && !window?.availableTo) {
        return 'All term';
    }

    if (window.availableFrom && window.availableTo) {
        return `${formatDate(window.availableFrom, locale.value)} – ${formatDate(window.availableTo, locale.value)}`;
    }

    return window.availableFrom
        ? `From ${formatDate(window.availableFrom, locale.value)}`
        : `Until ${formatDate(window.availableTo, locale.value)}`;
}

/**
 * What the solver will actually be told, in weeks.
 *
 * Calls the SAME `blackedOutWeeks` the assembly calls, so this cannot drift from
 * the wire, the rule the calendar-period preview follows for the same reason.
 */
function preview(term: TermRow): string {
    const window = draft.value[term.id];

    if (!window?.availableFrom && !window?.availableTo) {
        return 'Available every week of this term.';
    }

    const start = new Date(term.startDate);
    const end = new Date(term.endDate);
    const blocked = blackedOutWeeks(start, end, {
        availableFrom: window.availableFrom ? new Date(window.availableFrom) : null,
        availableTo: window.availableTo ? new Date(window.availableTo) : null,
    });
    const total = weekCountOf(start, end);
    const free = total - blocked.length;

    if (!blocked.length) {
        return `These dates cover all ${total} weeks, so nothing is narrowed.`;
    }

    if (!free) {
        return `Blocks every week of this term: no session could be placed.`;
    }

    // Week numbers are 1-based for a human, 0-based on the wire.
    const names = blocked.map((index) => index + 1).join(', ');

    return `${free} of ${total} weeks available. Blocked: week ${names}.`;
}
</script>

<style scoped lang="scss">
.avail {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    &_heading {
        margin: 0;
        font-size: var(--font-size-md);
        font-weight: 650;
        color: $content1;
    }

    &_help,
    &_empty {
        max-width: 68ch;
        margin: 0;

        font-size: var(--font-size-sm);
        line-height: 1.6;
        color: $content7;
    }

    &_note,
    &_error {
        display: flex;
        gap: var(--space-3);
        align-items: flex-start;

        max-width: 68ch;
        margin: 0;

        font-size: var(--font-size-sm);
        line-height: 1.6;

        > .iconify {
            flex: none;
            width: 16px;
            height: 16px;
        }
    }

    &_note {
        color: $content7;
    }

    &_error {
        color: $warning800;
    }

    &_list {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);

        margin: 0;
        padding: 0;

        list-style: none;
    }

    &_row {
        display: grid;
        grid-template-columns: minmax(0, 1.4fr) auto auto;
        gap: var(--space-3) var(--space-4);
        align-items: end;

        // The border is the only thing separating one term from the next, so it
        // comes from the CONTENT ramp: no step of the surface ramp reaches 3:1
        // against this ground in either theme (measured).
        padding-bottom: var(--space-4);
        border-bottom: 1px solid varToRgba('content7', 0.35);

        &:last-child {
            border-bottom: none;
        }

        @include mobile {
            grid-template-columns: minmax(0, 1fr);
            align-items: stretch;
        }
    }

    &_term {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);

        font-size: var(--font-size-md);
        font-weight: 600;
        color: $content2;
    }

    &_span {
        font-size: var(--font-size-xs);
        font-weight: 400;
        color: $content7;
    }

    &_field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    &_field-label {
        font-size: var(--font-size-xs);
        color: $content7;
    }

    &_input {
        padding: var(--space-3);
        border: 1px solid varToRgba('content7', 0.5);
        border-radius: var(--radius-sm);

        font-size: var(--font-size-sm);
        color: $content1;

        background: $surface2;

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: 1px;
        }
    }

    &_static {
        margin: 0;
        font-size: var(--font-size-sm);
        color: $content2;
    }

    &_preview {
        // Spans the row, under the controls it explains.
        grid-column: 1 / -1;

        margin: 0;

        font-size: var(--font-size-xs);
        line-height: 1.5;
        color: $content7;
    }
}
</style>
