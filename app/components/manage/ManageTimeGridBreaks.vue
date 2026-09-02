<template>
    <section class="breaks">
        <header class="breaks_head">
            <h3>{{ t('manageUi.timeGridBreaks.title') }}</h3>
            <span
                v-if="model.length"
                class="breaks_count"
            >{{ t('manageUi.timeGridBreaks.count', { count: model.length }) }}</span>
        </header>

        <p class="breaks_hint">
            {{ t('manageUi.timeGridBreaks.hint') }}
        </p>

        <!--
            Read-only renders as TEXT, not disabled controls, the same rule the
            rest of the management area follows (see ManageField). A row of
            greyed selects reads as "unavailable right now"; a sentence reads as
            "this is the configuration, and it is not yours to change".
        -->
        <ul
            v-if="readonly && model.length"
            class="breaks_static-list"
        >
            <li
                v-for="(brk, i) in model"
                :key="i"
            >
                <strong>{{ brk.label || t('manageUi.timeGridBreaks.defaultLabel') }}</strong>
                <!--
                    Three finished items separated by ` · `, which is
                    PUNCTUATION, not grammar (i18n/CONVENTIONS.md § "Assembled
                    sentences"): each piece is its own whole message and the
                    separator carries no part of any of them.
                -->
                <span>
                    {{ t('manageUi.timeGridBreaks.staticAfterBlock', { block: brk.afterBlockIndex + 1 }) }} ·
                    {{ t('manageUi.shared.minutes', { minutes: brk.durationMinutes }) }} ·
                    {{
                        brk.dayOfWeek === null
                            ? t('manageUi.timeGridBreaks.staticAllDays')
                            : t('manageUi.timeGridBreaks.dayOnly', { day: weekdayName(brk.dayOfWeek) })
                    }}
                </span>
            </li>
        </ul>

        <ul
            v-else-if="model.length"
            class="breaks_list"
        >
            <li
                v-for="(brk, i) in model"
                :key="i"
                class="breaks_row"
            >
                <label class="breaks_field">
                    <span class="breaks_field-label">{{ t('manageUi.timeGridBreaks.afterBlockLabel') }}</span>
                    <select
                        class="breaks_control"
                        @change="updateBreak(i, { afterBlockIndex: Number(($event.target as HTMLSelectElement).value) })"
                    >
                        <!-- :selected, not :value on the select: a
                             select's value is a property, so SSR
                             drops it and the browser falls back to
                             the first option. -->
                        <option
                            v-for="n in blockChoices"
                            :key="n"
                            :selected="brk.afterBlockIndex === n"
                            :value="n"
                        >{{ n + 1 }}</option>
                    </select>
                </label>

                <label class="breaks_field breaks_field--minutes">
                    <span class="breaks_field-label">{{ t('manageUi.timeGridBreaks.minutesLabel') }}</span>
                    <input
                        class="breaks_control"
                        min="1"
                        type="number"
                        :value="brk.durationMinutes"
                        @input="updateBreak(i, { durationMinutes: Number(($event.target as HTMLInputElement).value) })"
                    >
                </label>

                <label class="breaks_field breaks_field--grow">
                    <span class="breaks_field-label">{{ t('manageUi.timeGridBreaks.labelLabel') }}</span>
                    <input
                        class="breaks_control"
                        :placeholder="t('manageUi.timeGridBreaks.defaultLabel')"
                        type="text"
                        :value="brk.label"
                        @input="updateBreak(i, { label: ($event.target as HTMLInputElement).value })"
                    >
                </label>

                <label class="breaks_field">
                    <span class="breaks_field-label">{{ t('manageUi.timeGridBreaks.daysLabel') }}</span>
                    <!-- Bounded to the grid's own teaching days: a
                         break on a day nothing is scheduled is
                         configuration that can never take effect. -->
                    <select
                        class="breaks_control"
                        @change="updateBreak(i, { dayOfWeek: ($event.target as HTMLSelectElement).value === ''
                            ? null : Number(($event.target as HTMLSelectElement).value) })"
                    >
                        <option
                            :selected="brk.dayOfWeek === null"
                            value=""
                        >{{ t('manageUi.timeGridBreaks.allDaysOption') }}</option>
                        <option
                            v-for="iso in activeDays"
                            :key="iso"
                            :selected="brk.dayOfWeek === iso"
                            :value="iso"
                        >{{ t('manageUi.timeGridBreaks.dayOnly', { day: weekdayName(iso) }) }}</option>
                    </select>
                </label>

                <button
                    :aria-label="t('manageUi.timeGridBreaks.removeAria', {
                        block: brk.afterBlockIndex + 1,
                    })"
                    class="breaks_remove"
                    :title="t('manageUi.timeGridBreaks.removeTitle')"
                    type="button"
                    @click="removeBreak(i)"
                >
                    <Icon
                        aria-hidden="true"
                        name="material-symbols:close"
                    />
                </button>
            </li>
        </ul>

        <p
            v-else
            class="breaks_empty"
        >{{ t('manageUi.timeGridBreaks.empty') }}</p>

        <CommonButton
            v-if="!readonly"
            type="secondary"
            @click="addBreak"
        >{{ t('manageUi.timeGridBreaks.add') }}</CommonButton>
    </section>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import type { TimeGridBreak } from '#shared/timeGrid';
import { useT } from '~/composables/i18n';
import { weekdayName } from '~/composables/schedule';

/**
 * The named-break editor for a TimeGrid.
 *
 * Split out of `ManageTimeGridEditor` because the two halves answer different
 * questions and neither needs the other's internals: this owns the break
 * COLLECTION (what rows exist and what each one says), while the editor owns
 * the draft and the preview that shows what the collection does to a day.
 *
 * It holds no draft access of its own; breaks arrive and leave through the
 * model, so dirty tracking, the single Save and the PUT-set persistence all
 * stay exactly where they were.
 */
const props = defineProps<{
    /** Positions a break may follow: every block except the last. */
    blockChoices: number[];
    /** The grid's teaching days, ISO 1..7. Bounds the day picker. */
    activeDays: number[];
    readonly?: boolean;
}>();

const model = defineModel<TimeGridBreak[]>({ required: true });

const { t } = useT();

function addBreak() {
    // Position defaults to the middle of the day and "all days": the lunch
    // case, which is what someone reaching for this button usually wants.
    //
    // `blockChoices` is every block but the last, so the day's block count is
    // one more than its length; deriving it here keeps this component off the
    // draft entirely.
    const blocksPerDay = props.blockChoices.length + 1;
    const middle = Math.max(0, Math.floor(blocksPerDay / 2) - 1);

    model.value = [...model.value, {
        afterBlockIndex: props.blockChoices.includes(middle) ? middle : (props.blockChoices[0] ?? 0),
        durationMinutes: 45,
        // Deliberately NOT 'Lunch'. A default that is usually right gets left in
        // place; a default that names one specific break gets left in place too,
        // and then it is wrong. The demo tenant ended up with two breaks both
        // labelled "Lunch": a 10:00 morning break and a 13:00 lunch, because
        // the second one kept this default. A neutral word is one nobody
        // mistakes for a considered answer.
        /*
         * NOT a message, deliberately (issue #19). This is a STORED value, not
         * copy: it is written into the draft, saved, and then rendered to every
         * viewer of the timetable regardless of their language. Translating it
         * would make a break's stored name depend on which language its author
         * happened to be using. The DISPLAY fallback for an empty label, and
         * this input's placeholder, are messages; the seed is data.
         */
        label: 'Break',
        dayOfWeek: null,
    }];
}

function updateBreak(index: number, patch: Partial<TimeGridBreak>) {
    model.value = model.value.map((b, i) => (i === index ? { ...b, ...patch } : b));
}

function removeBreak(index: number) {
    model.value = model.value.filter((_, i) => i !== index);
}
</script>

<style scoped lang="scss">
.breaks {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: flex-start;

    padding: var(--space-5) var(--space-6);
    border-radius: var(--radius-lg);

    background: $surface2;

    &_head {
        display: flex;
        gap: var(--space-4);
        align-items: baseline;
        align-self: stretch;

        h3 {
            margin: 0;

            font-size: var(--font-size-xs);
            font-weight: 650;
            color: $surface7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
    }

    &_count {
        margin-left: auto;
        font-size: var(--font-size-xs);
        font-variant-numeric: tabular-nums;
        color: $content7;
    }

    &_hint {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;
    }

    &_list,
    &_static-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        align-self: stretch;

        margin: 0;
        padding: 0;

        list-style: none;
    }

    /* One row per break: the four fields on a line, wrapping to two on a narrow
       panel rather than shrinking the selects below what a weekday name needs. */
    &_row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: flex-end;

        padding: var(--space-4) var(--space-5);
        border-radius: var(--radius-lg);

        background: $surface0;
    }

    &_field {
        display: flex;
        flex: none;
        flex-direction: column;
        gap: var(--space-2);

        &-label {
            font-size: var(--font-size-xs);
            font-weight: 650;
            color: $content7;
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }

        /* The label is the only free text here, so it takes the slack; the
           numeric field takes as little as a three-digit value needs. */
        &--grow {
            flex: 1;
            min-width: 120px;
        }

        &--minutes { width: 84px; }
    }

    &_control {
        width: 100%;
        padding: var(--space-3) var(--space-4);
        border: 1px solid $surface4;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content3;

        background: $surface1;

        transition: 0.15s;

        &:focus {
            border-color: $primary500;
            outline: none;
        }
    }

    &_remove {
        cursor: pointer;

        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;

        width: 30px;
        height: 30px;
        border: 0;
        border-radius: var(--radius-md);

        color: $surface7;

        background: none;

        transition: 0.12s;

        svg {
            width: 16px;
            height: 16px;
        }

        @include hover() {
            &:hover {
                color: $error700;
                background: varToRgba('error500', 0.14);
            }
        }
    }

    /* The read-only rendering: a sentence per break rather than dead controls. */
    &_static-list li {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
        align-items: baseline;

        padding: var(--space-3) var(--space-5);
        border-radius: var(--radius-md);

        font-size: var(--font-size-sm);

        background: $surface0;

        strong {
            font-weight: 650;
            color: $content3;
        }

        span { color: $content7; }
    }

    &_empty {
        margin: 0;
        font-size: var(--font-size-sm);
        font-style: italic;
        color: $content7;
    }
}
</style>
