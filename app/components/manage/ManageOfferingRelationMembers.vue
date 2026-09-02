<template>
    <fieldset class="relmembers">
        <legend v-if="label">{{ label }}</legend>

        <!--
            `<i18n-t>` so the type key stays a `<code>` element inside one
            translatable sentence. `different_time` is an IDENTIFIER, never
            translated, which is exactly why it travels as a slot rather than
            as part of the message.
        -->
        <i18n-t
            class="relmembers_help"
            keypath="manageUi.relationMembers.help"
            scope="global"
            tag="p"
        >
            <template #type>
                <code>different_time</code>
            </template>
        </i18n-t>

        <ol
            v-if="members.length"
            class="relmembers_list"
        >
            <li
                v-for="(offeringId, index) in members"
                :key="offeringId"
                class="relmembers_row"
            >
                <span class="relmembers_index">{{ index + 1 }}</span>
                <span class="relmembers_title">{{ titleOf(offeringId) }}</span>
                <button
                    v-if="!readonly"
                    class="relmembers_remove"
                    :disabled="disabled"
                    type="button"
                    :aria-label="t('manageUi.shared.removeAria', { label: titleOf(offeringId) })"
                    @click="remove(offeringId)"
                >
                    <Icon
                        name="material-symbols:close"
                        aria-hidden="true"
                    />
                </button>
            </li>
        </ol>

        <p
            v-else
            class="relmembers_empty"
        >{{ t('manageUi.relationMembers.empty') }}</p>

        <label
            v-if="!readonly"
            class="relmembers_add"
        >
            <span class="sr-only">{{ t('manageUi.relationMembers.addLabel') }}</span>
            <select
                :disabled="disabled || !available.length"
                :value="''"
                @change="add($event)"
            >
                <option value="">{{ addPlaceholder }}</option>
                <option
                    v-for="offering in available"
                    :key="offering.id"
                    :value="offering.id"
                >{{ titleOf(offering.id) }}</option>
            </select>
        </label>

        <p
            v-if="error"
            class="relmembers_error"
            role="alert"
        >{{ error }}</p>
        <p
            v-else-if="help"
            class="relmembers_hint"
        >{{ help }}</p>
    </fieldset>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';

/**
 * The ordered Offering picker a RELATION-shaped constraint type needs
 * (`ConstraintTypeDef.relation`, ADR-0028 in calendry-solver): its operands,
 * not a param the generic `ManageField`/`constraintParamControls` machinery
 * can render, and not `ConstraintScope` either (a relation's Offerings are
 * what the rule is ABOUT, never a filter narrowing it).
 *
 * PRESENTATIONAL, like `ManageWeekdayPicker` beside it: no fetch, no save of
 * its own. `members` travels as part of the constraint's own `draft` (the
 * `constraints` resource's `members` childKey), saved in the SAME request as
 * the rest of the row, same reasoning `scopes` already follows, and for the
 * same reason: a relation with fewer than its type's `minMembers` is refused
 * at the write boundary, so members have to arrive with the row that needs
 * them rather than after it exists.
 *
 * ORDER IS INSERTION ORDER, not drag-reordered: no relation type built so
 * far reads it (`different_time` is symmetric); see `ConstraintRelationMember`
 * schema note for why a position is still stored.
 */
const props = defineProps<{
    label?: string;
    help?: string;
    error?: string;
    readonly?: boolean;
    disabled?: boolean;
    /** Every Offering this tenant has, for naming members and offering the rest. */
    offerings: { id: string; title: string; code?: string | null }[];
    /**
     * Distinguishes "every Offering is already a member" from "the Offering
     * list failed to load", both would otherwise render as an empty
     * `available` list and the same disabled control, which is exactly the
     * "no data and fetch failed render identically" trap this codebase keeps
     * getting caught by.
     */
    loadFailed?: boolean;
}>();

const members = defineModel<string[]>({ required: true });

const { t } = useT();

function titleOf(offeringId: string): string {
    const offering = props.offerings.find((o) => o.id === offeringId);

    if (!offering) {
        // The raw id rather than a blank: an unresolvable member is something
        // to see, not to paper over; see the dangling-member report in
        // `assembleSolverInput`.
        return offeringId;
    }

    return offering.code ? `${offering.code} - ${offering.title}` : offering.title;
}

const available = computed(() => {
    const taken = new Set(members.value);

    return props.offerings.filter((offering) => !taken.has(offering.id));
});

const addPlaceholder = computed(() => {
    if (props.loadFailed) {
        return t('manageUi.relationMembers.loadFailed');
    }

    return available.value.length
        ? t('manageUi.relationMembers.addOption')
        : t('manageUi.relationMembers.allNamed');
});

function add(event: Event) {
    const select = event.target as HTMLSelectElement;
    const value = select.value;

    select.value = '';

    if (value) {
        members.value = [...members.value, value];
    }
}

function remove(offeringId: string) {
    members.value = members.value.filter((id) => id !== offeringId);
}
</script>

<style scoped lang="scss">
.relmembers {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    margin: 0;
    padding: 0;
    border: 0;

    legend {
        padding: 0 0 var(--space-3);
        font-size: var(--font-size-sm);
        font-weight: 650;
        color: $content4;
    }

    &_help {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;

        code {
            font-family: monospace;
        }
    }

    &_list {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        margin: 0;
        padding: 0;

        list-style: none;
    }

    &_row {
        display: flex;
        gap: var(--space-4);
        align-items: center;
        justify-content: space-between;

        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-md);
        color: $content3;

        background: $surface0;
    }

    &_index {
        flex: none;
        font-variant-numeric: tabular-nums;
        color: $content7;
    }

    &_title {
        overflow: hidden;
        flex: 1;

        min-width: 0;

        text-overflow: ellipsis;
        white-space: nowrap;
    }

    &_remove {
        cursor: pointer;

        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;

        width: 24px;
        height: 24px;
        border: 0;
        border-radius: var(--radius-sm);

        color: $surface7;

        background: none;

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

    &_empty {
        margin: 0;
        font-size: var(--font-size-sm);
        font-style: italic;
        color: $content7;
    }

    &_add select {
        width: 100%;
        padding: var(--space-3) var(--space-5);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content4;

        background: $surface0;
    }

    &_error {
        margin: 0;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $error700;
    }

    &_hint {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;
    }
}

.sr-only {
    position: absolute;

    overflow: hidden;

    width: 1px;
    height: 1px;

    clip-path: inset(50%);
}
</style>
