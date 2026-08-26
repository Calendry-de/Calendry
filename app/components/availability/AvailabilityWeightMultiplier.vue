<template>
    <div class="weight">
        <span
            v-if="label"
            class="weight_label"
        >{{ label }}</span>

        <p
            v-if="help"
            class="weight_help"
        >{{ help }}</p>

        <!--
            Read-only renders as TEXT, never a disabled input — the same rule the
            two pickers beside this one follow: a disabled control reads as
            "unavailable right now" rather than "not yours to change".
        -->
        <p
            v-if="readonly"
            class="weight_static"
        >{{ describe(model) }}</p>

        <template v-else>
            <!--
                Two states, and neither is an empty box. `null` is a real
                setting ("use the tenant default"), so it gets a sentence and an
                explicit way in; an override gets an input and an explicit way
                back out. An empty input would render the default state as
                something that merely looks unfilled.
            -->
            <div
                v-if="model === null"
                class="weight_default"
            >
                <span class="weight_state">Using the institution's default weight</span>
                <common-button
                    size="S"
                    type="secondary"
                    @click="startOverride"
                >Set an override</common-button>
            </div>

            <div
                v-else
                class="weight_override"
            >
                <label class="weight_field">
                    <span class="weight_fieldLabel">Counts</span>
                    <input
                        v-model="text"
                        class="weight_input"
                        inputmode="decimal"
                        :max="WEIGHT_MULTIPLIER_MAX"
                        :min="WEIGHT_MULTIPLIER_MIN"
                        step="0.05"
                        type="number"
                        @input="commit"
                    >
                    <span class="weight_times">× the default</span>
                </label>

                <common-button
                    size="S"
                    type="secondary"
                    @click="clearOverride"
                >Use default</common-button>
            </div>

            <p
                v-if="localError"
                class="weight_error"
                role="alert"
            >{{ localError }}</p>
        </template>

        <p
            v-if="error"
            class="weight_error"
            role="alert"
        >{{ error }}</p>
    </div>
</template>

<script setup lang="ts">
import {
    WEIGHT_MULTIPLIER_MAX,
    WEIGHT_MULTIPLIER_MIN,
    isWeightMultiplierInRange,
} from '#shared/availability';

/**
 * How much one person's stated preference counts, relative to the tenant default.
 *
 * Shape deliberately mirrors `ManageWeekdayPicker` and
 * `AvailabilityBlockPicker` — `v-model`, `label`/`help`/`error`/`readonly` — so
 * the three read as one editor split across three axes rather than as two
 * pickers and a stray field.
 *
 * ADMINISTRATOR-ONLY BY CONSTRUCTION, not by a check in here. The self-service
 * page neither sends this field (the endpoint refuses it by name) nor receives
 * it (`/api/me/availability` selects only the two axes), so there is no
 * self-service caller for this component to guard against.
 *
 * The bounds come from `#shared/availability`, the same constants the
 * administrator write path's zod schema uses. Client-side validation here is a
 * courtesy, not the guarantee: the server refuses out-of-range values and the
 * database CHECK refuses them again for writes that never reach a handler, so
 * `error` exists to surface a server rejection that arrives anyway.
 */
withDefaults(defineProps<{
    label?: string;
    help?: string;
    /** A server-side rejection, shown verbatim. */
    error?: string;
    readonly?: boolean;
}>(), {
    label: undefined,
    help: undefined,
    error: undefined,
    readonly: false,
});

const model = defineModel<number | null>({ required: true });

/**
 * The input's own string, kept separate from the model.
 *
 * A number input mid-edit can be transiently unparseable ("1.", "", "-") and
 * binding the model straight to it would either write NaN or snap the value
 * back under the user's cursor. The model is only written when the text parses
 * to something in range; otherwise `localError` says why nothing was accepted.
 */
const text = ref(model.value === null ? '' : String(model.value));
const localError = ref('');

/** Chosen because it is the neutral override: explicit, and changes nothing yet. */
const NEUTRAL = 1;

watch(model, (value) => {
    // Keeps the field in step when the parent reseeds it — opening a different
    // person's row, or a refresh after save.
    const next = value === null ? '' : String(value);

    if (next !== text.value) {
        text.value = next;
        localError.value = '';
    }
});

function describe(value: number | null): string {
    return value === null
        ? 'Using the institution\'s default weight'
        : `Counts ${value}× the default`;
}

function startOverride() {
    model.value = NEUTRAL;
    text.value = String(NEUTRAL);
    localError.value = '';
}

function clearOverride() {
    model.value = null;
    text.value = '';
    localError.value = '';
}

function commit() {
    const parsed = Number(text.value);

    if (text.value.trim() === '' || !Number.isFinite(parsed)) {
        localError.value = `Enter a number between ${WEIGHT_MULTIPLIER_MIN} and ${WEIGHT_MULTIPLIER_MAX}, `
            + 'or use the default.';

        return;
    }

    if (!isWeightMultiplierInRange(parsed)) {
        localError.value = `A multiplier must be between ${WEIGHT_MULTIPLIER_MIN} and `
            + `${WEIGHT_MULTIPLIER_MAX}. Anything outside that would let one person's preference `
            + 'outweigh the rules it competes with.';

        return;
    }

    localError.value = '';
    model.value = parsed;
}

defineExpose({ describe });
</script>

<style scoped lang="scss">
.weight {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    &_label {
        font-size: var(--font-size-md);
        font-weight: 650;
        color: $content2;
    }

    &_help,
    &_static {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.6;
        color: $content7;
    }

    &_default,
    &_override {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: center;
    }

    &_state {
        font-size: var(--font-size-sm);
        color: $content6;
    }

    &_field {
        display: flex;
        gap: var(--space-3);
        align-items: center;
    }

    &_fieldLabel,
    &_times {
        font-size: var(--font-size-sm);
        color: $content6;
    }

    &_input {
        width: 84px;
        padding: var(--space-3) var(--space-4);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-md);
        font-variant-numeric: tabular-nums;
        color: $content4;

        background: $surface0;

        &:focus-visible {
            border-color: $primary500;
        }
    }

    &_error {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $error700;
    }
}
</style>
