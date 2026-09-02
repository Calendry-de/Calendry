<template>
    <CommonPage title="My teaching pattern">
        <p class="intro">
            How each module you lead is placed across the term.
            <strong>Spread</strong> gives it a consistent weekly slot; <strong>Kept together</strong>
            concentrates it into a short window instead. Neither is a guarantee: a pattern is weighed
            against every other rule the next time this institution generates a timetable, and it takes
            effect only once a tenant has switched the matching rule on.
        </p>

        <p
            v-if="error"
            class="note note--error"
            role="alert"
        >{{ error }}</p>

        <p
            v-if="!offerings.length"
            class="note note--warn"
        >
            You are not listed as a lecturer on any module, so there is nothing to set a pattern for.
        </p>

        <ul
            v-else
            class="rows"
        >
            <li
                v-for="offering in offerings"
                :key="offering.id"
                class="row"
            >
                <div class="row_main">
                    <strong>{{ offering.code ? `${offering.code}: ${offering.title}` : offering.title }}</strong>
                    <span class="row_meta">{{ offering.term.name }}</span>
                </div>

                <label class="row_field">
                    <span class="row_label">Pattern</span>
                    <select
                        class="row_select"
                        :disabled="busy.has(offering.id)"
                        :value="offering.schedulingPattern ?? ''"
                        @change="onChange(offering.id, ($event.target as HTMLSelectElement).value)"
                    >
                        <option
                            :selected="offering.schedulingPattern === null"
                            value=""
                        >Not decided</option>
                        <option
                            :selected="offering.schedulingPattern === 'DISTRIBUTED'"
                            value="DISTRIBUTED"
                        >Spread across the term</option>
                        <option
                            :selected="offering.schedulingPattern === 'BLOCK'"
                            value="BLOCK"
                        >Kept together</option>
                        <!--
                            THE TICKET'S THIRD MODE, DELIBERATELY DISABLED. "Multiple sessions
                            grouped into a day" needs a solver evaluator that rewards clustering
                            within a day (the existing per-day caps only discourage excess, they
                            do not encourage it), and that evaluator lives in calendry-solver, not
                            here. A native `disabled` option is unclickable rather than merely
                            unexplained, so this is a stated gap, not a silent one.
                        -->
                        <option
                            disabled
                            value="MULTIPLE_PER_DAY"
                        >Multiple in a day (not available yet)</option>
                    </select>
                </label>

                <span
                    v-if="savedId === offering.id"
                    class="row_status row_status--ok"
                >Saved</span>
            </li>
        </ul>
    </CommonPage>
</template>

<script setup lang="ts">
/**
 * A lecturer's own choice of HOW each module they lead is taught (issue #28),
 * the same shape `/my/preferences` uses for slot preferences, attached to
 * an Offering instead of to the Person.
 *
 * `GET /api/me/offerings` is a CONVENIENCE list, not the boundary: the write
 * (`PUT /api/me/offerings/:id/scheduling-pattern`) re-checks the caller
 * against `OfferingLecturer` itself, so a stale row here changes nothing
 * about what can actually be saved.
 */
definePageMeta({ middleware: 'my' });
useHead({ title: 'My teaching pattern' });

interface OfferingRow {
    id: string;
    title: string;
    code: string | null;
    schedulingPattern: 'DISTRIBUTED' | 'BLOCK' | null;
    term: { id: string; name: string };
}

const request = useRequestFetch();

const { data, refresh } = await useAsyncData(
    'my:teaching-pattern',
    () => request<{ rows: OfferingRow[] }>('/api/me/offerings'),
);

const offerings = computed(() => data.value?.rows ?? []);

const busy = ref(new Set<string>());
const error = ref('');
const savedId = ref('');

async function onChange(offeringId: string, value: string) {
    error.value = '';
    savedId.value = '';
    busy.value = new Set(busy.value).add(offeringId);

    try {
        await request(`/api/me/offerings/${offeringId}/scheduling-pattern`, {
            method: 'PUT',
            body: { schedulingPattern: value },
        });

        await refresh();
        savedId.value = offeringId;
    } catch (cause) {
        error.value = (cause as { statusMessage?: string })?.statusMessage ?? 'Could not save that.';
        await refresh();
    } finally {
        const next = new Set(busy.value);

        next.delete(offeringId);
        busy.value = next;
    }
}
</script>

<style scoped lang="scss">
.intro {
    max-width: 68ch;
    margin: 0 0 var(--space-6);

    font-size: var(--font-size-md);
    line-height: 1.6;
    color: $content5;
}

.note {
    max-width: 68ch;
    margin: 0 0 var(--space-6);
    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-lg);

    font-size: var(--font-size-sm);
    line-height: 1.5;
    color: $content5;

    background: $surface1;

    &--warn {
        color: $warning700;
        background: varToRgba('warning500', 0.12);
    }

    &--error {
        color: $error700;
        background: varToRgba('error500', 0.14);
    }
}

.rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);

    margin: 0;
    padding: 0;

    list-style: none;
}

.row {
    display: flex;
    gap: var(--space-4);
    align-items: center;
    justify-content: space-between;

    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-lg);

    background: $surface1;

    &_main {
        display: flex;
        flex-direction: column;
        gap: 2px;

        min-width: 0;

        color: $content3;
    }

    &_meta {
        font-size: var(--font-size-sm);
        color: $content7;
    }

    &_field {
        display: flex;
        flex: none;
        gap: var(--space-2);
        align-items: center;
    }

    &_label {
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content4;
    }

    &_select {
        padding: var(--space-2) var(--space-3);
        border: 1px solid $surface4;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-sm);
        color: $content3;

        background: $surface0;
    }

    &_status {
        flex: none;
        font-size: var(--font-size-xs);
        font-weight: 650;

        &--ok {
            color: $success700;
        }
    }
}
</style>
