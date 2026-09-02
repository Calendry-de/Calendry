<template>
    <CommonPage :title="t('my.teachingPattern.pageTitle')">
        <!--
            `<i18n-t>` rather than three keys concatenated in English order: the
            two emphasised pattern names are grammar, not decoration, and German
            puts them elsewhere in the clause. One message with two placeholders
            lets them move; the slot names match the placeholders.
        -->
        <i18n-t
            class="intro"
            keypath="my.teachingPattern.intro"
            scope="global"
            tag="p"
        >
            <template #spread>
                <strong>{{ t('my.teachingPattern.introSpread') }}</strong>
            </template>
            <template #together>
                <strong>{{ t('my.teachingPattern.introTogether') }}</strong>
            </template>
        </i18n-t>

        <p
            v-if="error"
            class="note note--error"
            role="alert"
        >{{ error }}</p>

        <p
            v-if="!offerings.length"
            class="note note--warn"
        >
            {{ t('my.teachingPattern.emptyHint') }}
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
                    <strong>{{ moduleLabel(offering) }}</strong>
                    <span class="row_meta">{{ offering.term.name }}</span>
                </div>

                <label class="row_field">
                    <span class="row_label">{{ t('my.teachingPattern.patternLabel') }}</span>
                    <select
                        class="row_select"
                        :disabled="busy.has(offering.id)"
                        :value="offering.schedulingPattern ?? ''"
                        @change="onChange(offering.id, ($event.target as HTMLSelectElement).value)"
                    >
                        <option
                            :selected="offering.schedulingPattern === null"
                            value=""
                        >{{ t('my.teachingPattern.patternUndecided') }}</option>
                        <option
                            :selected="offering.schedulingPattern === 'DISTRIBUTED'"
                            value="DISTRIBUTED"
                        >{{ t('my.teachingPattern.patternDistributed') }}</option>
                        <option
                            :selected="offering.schedulingPattern === 'BLOCK'"
                            value="BLOCK"
                        >{{ t('my.teachingPattern.patternBlock') }}</option>
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
                        >{{ t('my.teachingPattern.patternMultiplePerDay') }}</option>
                    </select>
                </label>

                <span
                    v-if="savedId === offering.id"
                    class="row_status row_status--ok"
                >{{ t('my.teachingPattern.saved') }}</span>
            </li>
        </ul>
    </CommonPage>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';

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

const { t } = useT();

useHead(() => ({ title: t('my.teachingPattern.pageTitle') }));

interface OfferingRow {
    id: string;
    title: string;
    code: string | null;
    schedulingPattern: 'DISTRIBUTED' | 'BLOCK' | null;
    term: { id: string; name: string };
}

/** "CODE: Title", or the title alone: the colon is punctuation a translator owns. */
function moduleLabel(offering: OfferingRow): string {
    return offering.code
        ? t('my.teachingPattern.moduleWithCode', { code: offering.code, title: offering.title })
        : offering.title;
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
        error.value = serverErrorMessage(cause)
            ?? t('my.teachingPattern.saveError');
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
