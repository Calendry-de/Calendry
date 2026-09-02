<template>
    <li
        class="crow"
        :class="{ 'crow--off': !row.isEnabled, 'crow--superseded': superseded }"
    >
        <div class="crow_head">
            <!--
                READ-ONLY IS TEXT, NOT A DISABLED CHECKBOX.

                A disabled control reads as "unavailable right now"; a stated
                value reads as "this is the setting, and it is not yours to
                change", which is what a missing update permission actually
                means. Same rule ManageField follows for every generic field.
            -->
            <p
                v-if="!canUpdate"
                class="crow_state"
            >
                <span
                    class="crow_dot"
                    :class="row.isEnabled ? 'crow_dot--on' : 'crow_dot--off'"
                    aria-hidden="true"
                />
                <span class="crow_name">{{ heading }}</span>
                <span class="crow_state-word">{{ row.isEnabled ? 'On' : 'Off' }}</span>
            </p>

            <label
                v-else
                class="crow_toggle"
            >
                <input
                    :checked="row.isEnabled"
                    :disabled="busy"
                    type="checkbox"
                    @change="$emit('update:enabled', ($event.target as HTMLInputElement).checked)"
                >
                <span class="crow_name">{{ heading }}</span>
            </label>

            <span class="crow_tags">
                <!--
                    WHICH EVALUATOR OWNS THIS RULE. The four structural types are
                    checked by this app on every manual edit; the rest only ever
                    reach the solver. Both are switchable: `violations.ts` and
                    `assembleSolverInput` each filter on `isEnabled`, and the
                    solver only enforces a structural rule when its config is
                    present (convert.rs), so the distinction to surface is not
                    "can I turn it off" but "who acts on it".
                -->
                <!--
                    THE SEVERITY BADGE, not just the weight slot below.
                    Rows used to sit in a section that was ALL hard or ALL soft,
                    so the section header alone said which; grouping by category
                    instead means one section can hold both, and the row is now
                    the only place left that says it.
                -->
                <span
                    class="crow_tag"
                    :class="`crow_tag--sev-${severity.toLowerCase()}`"
                >{{ severity === 'HARD' ? 'Hard' : 'Soft' }}</span>

                <span
                    class="crow_tag"
                    :class="`crow_tag--${type.evaluator}`"
                >{{ type.evaluator === 'app' ? 'Checked as you edit' : 'Solver' }}</span>

                <span
                    v-if="superseded"
                    class="crow_tag crow_tag--superseded"
                >Superseded</span>

                <!--
                    NEVER REPLACES THE TOGGLE: issue #8 is a suggestion, not
                    a restriction. This tenant is in SCHOOL mode and this rule
                    is the kind whose value shows up in a large, multi-building,
                    partly-online institution; it stays fully switchable here.
                -->
                <span
                    v-if="lessRelevant"
                    class="crow_tag crow_tag--low-relevance"
                >Less common for schools</span>
            </span>
        </div>

        <p class="crow_desc">
            <template v-if="subtitle">{{ subtitle }}</template>
            <template v-else>{{ type.description }}</template>
        </p>

        <p
            v-if="superseded"
            class="crow_superseded-note"
        >
            Replaced by <strong>{{ supersededBy }}</strong>. It still applies while it is on, and
            can still be turned off, but it cannot be recreated once removed, because a rule's
            type is fixed when it is created.
        </p>

        <div class="crow_foot">
            <button
                :aria-expanded="open"
                class="crow_scope"
                type="button"
                @click="open = !open"
            >
                <span class="crow_scope-label">Applies to</span>
                <span class="crow_scope-value">{{ scopeSummary }}</span>
                <Icon
                    aria-hidden="true"
                    :name="open ? 'material-symbols:expand-less' : 'material-symbols:expand-more'"
                />
            </button>

            <!--
                THE WEIGHT SLOT IS THE HARD/SOFT SIGNAL.

                A hard row has no weight cell at all (not an empty one, not a
                disabled one), and a soft row always has one, in the same place
                on every row of its section. An absent control cannot be misread
                the way a badge can, and the incident this guards against was
                someone reading a label: a `minimize_exam_week_sessions` row
                wearing the name of a different type for eighteen seconds and
                then forever, because `type` is create-only.
            -->
            <p
                v-if="severity === 'SOFT' && !canUpdate"
                class="crow_weight crow_weight--static"
            >
                <span>Weight</span>
                <strong>{{ row.weight ?? 0 }}</strong>
            </p>

            <label
                v-else-if="severity === 'SOFT'"
                class="crow_weight"
            >
                <span>Weight</span>
                <input
                    :disabled="busy"
                    min="0"
                    type="number"
                    :value="row.weight ?? 0"
                    @change="$emit('update:weight', ($event.target as HTMLInputElement).value)"
                >
            </label>

            <slot name="actions" />
        </div>

        <!--
            ONE disclosure per row, holding everything tunable about it.

            Not a nested form: every control inside writes on change, exactly
            like the toggle and the weight above. A Save button here would make
            several independent rules succeed or fail together, the same
            objection ManageRelationsPanel already records for PUT-set
            sub-resources.
        -->
        <div
            v-if="open"
            class="crow_panel"
        >
            <fieldset class="crow_scopes">
                <legend>Session kinds</legend>

                <p class="crow_hint">
                    Nothing selected means <strong>every kind</strong>, the tenant-wide rule.
                    Selecting kinds narrows this rule to them.
                </p>

                <p
                    v-if="scopeRequired"
                    class="crow_hint crow_hint--warn"
                    role="status"
                >
                    This rule needs at least one kind. Its type already has a tenant-wide version,
                    so clearing them all would make this a second rule applying everywhere, which
                    the server refuses.
                </p>

                <!--
                    "No kinds" and "you may not read kinds" are different facts
                    and must not render the same way. The fetch degrades to an
                    empty list on a 403, so without this a tenant with kinds
                    would be told they have none and sent to fix the wrong thing.
                -->
                <p
                    v-else-if="!canReadKinds"
                    class="crow_hint crow_hint--warn"
                >
                    You do not have permission to read session kinds, so they cannot be listed here.
                    Any kinds this rule is already scoped to are shown by id above.
                </p>

                <p
                    v-else-if="!kinds.length"
                    class="crow_hint crow_hint--warn"
                >No session kinds exist yet, so there is nothing to scope to.</p>

                <p
                    v-else-if="!canUpdate"
                    class="crow_hint"
                >{{ scopedKindIds.length ? '' : 'Not narrowed: this rule applies to every kind.' }}</p>

                <div
                    v-if="kinds.length"
                    class="crow_kinds"
                >
                    <template v-if="canUpdate">
                        <label
                            v-for="kind in kinds"
                            :key="kind.id"
                            class="crow_kind"
                            :class="{ 'crow_kind--on': scopedKindIds.includes(kind.id) }"
                        >
                            <input
                                :checked="scopedKindIds.includes(kind.id)"
                                :disabled="busy"
                                type="checkbox"
                                @change="toggleKind(kind.id)"
                            >
                            <span>{{ kind.name }}</span>
                        </label>
                    </template>

                    <!-- Read-only: the selection as text, not as dead checkboxes. -->
                    <template v-else>
                        <span
                            v-for="name in scopeNames"
                            :key="name"
                            class="crow_kind crow_kind--static"
                        >{{ name }}</span>
                    </template>
                </div>
            </fieldset>

            <fieldset
                v-if="paramControls.length"
                class="crow_params"
            >
                <legend>Parameters</legend>

                <template
                    v-for="control in paramControls"
                    :key="control.param.key"
                >
                    <ManageWeekdayPicker
                        v-if="control.kind === 'weekdays'"
                        :help="control.param.help"
                        :label="control.param.label"
                        :model-value="(paramValue(control.param.key) as number[]) ?? []"
                        :readonly="!canUpdate"
                        @update:model-value="$emit('update:param', { key: control.param.key, value: $event })"
                    />

                    <ManageField
                        v-else
                        :field="control.field"
                        :model-value="paramValue(control.param.key)"
                        :readonly="!canUpdate"
                        @update:model-value="$emit('update:param', { key: control.param.key, value: $event })"
                    />
                </template>
            </fieldset>

            <p
                v-else
                class="crow_hint"
            >This rule takes no parameters.</p>
        </div>
    </li>
</template>

<script setup lang="ts">
import type { ConstraintTypeDef } from '#shared/constraintTypes';
import ManageField from '~/components/manage/ManageField.vue';
import ManageWeekdayPicker from '~/components/manage/ManageWeekdayPicker.vue';
import { constraintParamControls } from '~/utils/constraintFields';

/** The shape this row reads. Kept local so the row depends on data, not on a fetch. */
export interface ConstraintRowData {
    id: string;
    type: string;
    name: string;
    severity: 'HARD' | 'SOFT';
    weight: number | null;
    params: Record<string, unknown> | null;
    isEnabled: boolean;
    isDefault: boolean;
    scopes?: { kindId: string | null; offeringId: string | null }[];
}

/**
 * One constraint, as a switch you tune rather than a record you edit.
 *
 * OWNERSHIP BOUNDARY: this component owns how ONE rule is presented and what
 * the user can express about it. It does no fetching, resolves no permissions
 * and performs no writes; every change leaves as an intent, and
 * `ManageConstraintGrid` decides what to do with it. That is what lets the same
 * component render both a catalogue rule and a scoped variant without either
 * one growing its own copy of the toggle, weight, scope and parameter controls.
 *
 * The row is also the only place that knows a rule can be read-only. `canUpdate`
 * arrives as a prop rather than being resolved here so that a row rendered in
 * some future context cannot disagree with the page it sits on.
 */
const props = defineProps<{
    /** The catalogue entry this row is an instance of. */
    type: ConstraintTypeDef;
    row: ConstraintRowData;
    /** Overrides the catalogue label; a variant carries its own name. */
    heading: string;
    /** Overrides the catalogue description. */
    subtitle?: string;
    /** Session kinds available to scope to, already fetched by the grid. */
    kinds: { id: string; name: string }[];
    /** Distinguishes "no kinds exist" from "you may not read kinds". */
    canReadKinds: boolean;
    canUpdate: boolean;
    /** A write for this row is in flight. */
    busy: boolean;
    /** Emptying this row's scopes would be refused by the server. */
    scopeRequired?: boolean;
    /** This row's type has been replaced by a newer one. */
    superseded?: boolean;
    supersededBy?: string;
    /**
     * Issue #8: this tenant's mode does not suggest this type first. A
     * labelling difference only; the toggle, weight and scope controls
     * behave identically either way.
     */
    lessRelevant?: boolean;
}>();

const emit = defineEmits<{
    'update:enabled': [boolean];
    'update:weight': [string];
    'update:param': [{ key: string; value: unknown }];
    'update:scopes': [string[]];
}>();

/**
 * Whether the disclosure is open.
 *
 * Local, and deliberately so: nothing outside the row acts on it, no two rows
 * constrain each other, and it is not persisted. Holding it in the grid would
 * make the grid the owner of thirteen booleans it never reads.
 */
const open = ref(false);

/**
 * Severity comes from the CATALOGUE, not the row.
 *
 * A row's stored severity can contradict its type: `severityMismatch()` exists
 * because the generic CRUD API accepted such rows before the write boundary was
 * tightened, and legacy ones may still be out there. The wire has no severity
 * field at all: the TYPE decides, and any weight on a hard row is ignored. So
 * rendering the row's own value would show a weight control that changes a
 * number nothing reads.
 */
const severity = computed<'HARD' | 'SOFT'>(() => props.type.severity ?? props.row.severity);

const paramControls = computed(() => constraintParamControls(props.type));

const scopedKindIds = computed(() => (props.row.scopes ?? [])
    .map((scope) => scope.kindId)
    .filter((id): id is string => Boolean(id)));

const kindName = (id: string) => props.kinds.find((kind) => kind.id === id)?.name ?? id;

const scopeNames = computed(() => scopedKindIds.value.map(kindName));

const scopeSummary = computed(() => (scopeNames.value.length
    ? scopeNames.value.join(', ')
    : 'Every session kind'));

function paramValue(key: string): unknown {
    return (props.row.params ?? {})[key] ?? null;
}

function toggleKind(kindId: string) {
    const next = scopedKindIds.value.includes(kindId)
        ? scopedKindIds.value.filter((id) => id !== kindId)
        : [...scopedKindIds.value, kindId];

    // The whole set travels, because `writeChildren` replaces it wholesale:
    // the submitted list is the authority, like every other PUT-set here.
    emit('update:scopes', next);
}
</script>

<style scoped lang="scss">
.crow {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    padding: var(--space-5) var(--space-6);
    border: 1px solid $surface3;
    border-radius: var(--radius-lg);

    background: $surface0;

    transition: 0.12s;

    /* A disabled rule is dimmed but never hidden: it is a rule the tenant can
       see and switch on, which is the entire point of the default-row model. */
    &--off {
        border-color: $surface2;
        background: $surface1;

        .crow_name { color: $content7; }
    }

    &--superseded {
        border-style: dashed;
    }

    &_head {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: center;
    }

    &_toggle,
    &_state {
        cursor: pointer;

        display: flex;
        gap: var(--space-4);
        align-items: center;

        margin: 0;

        input { accent-color: $primary500; }
    }

    &_state {
        cursor: default;
    }

    /* The read-only stand-in for the checkbox: states the value rather than
       showing a control nobody can operate. */
    &_dot {
        flex: none;

        width: 9px;
        height: 9px;
        border-radius: 50%;

        background: $surface5;

        &--on { background: $success500; }
    }

    &_state-word {
        font-size: var(--font-size-xs);
        font-weight: 650;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_name {
        font-size: var(--font-size-md);
        font-weight: 650;
        color: $content3;
    }

    &_tags {
        display: flex;
        gap: var(--space-3);
        align-items: center;
        margin-left: auto;
    }

    &_tag {
        padding: var(--space-1) var(--space-4);
        border-radius: var(--radius-sm);

        font-size: var(--font-size-xs);
        font-weight: 650;
        letter-spacing: 0.03em;

        &--app {
            color: $primary700;
            background: varToRgba('primary500', 0.14);
        }

        &--solver {
            color: $content6;
            background: $surface2;
        }

        &--superseded {
            color: $warning700;
            background: varToRgba('warning500', 0.18);
        }

        &--low-relevance {
            color: $content7;
            background: $surface2;
        }

        &--sev-hard {
            color: $error700;
            background: varToRgba('error500', 0.16);
        }

        &--sev-soft {
            color: $warning700;
            background: varToRgba('warning500', 0.2);
        }
    }

    &_desc {
        max-width: 74ch;
        margin: 0;

        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;
    }

    &_superseded-note {
        max-width: 74ch;
        margin: 0;
        padding: var(--space-3) var(--space-5);
        border-radius: var(--radius-md);

        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $warning700;

        background: varToRgba('warning500', 0.12);

        strong { font-weight: 650; }
    }

    &_foot {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: center;

        margin-top: var(--space-1);
    }

    &_scope {
        cursor: pointer;

        display: flex;
        gap: var(--space-3);
        align-items: baseline;

        margin-right: auto;
        padding: var(--space-2) var(--space-4) var(--space-2) 0;
        border: 0;

        font: inherit;
        text-align: left;

        background: none;

        svg {
            align-self: center;
            width: 16px;
            height: 16px;
            color: $surface7;
        }

        @include hover() {
            &:hover .crow_scope-value { color: $primary700; }
        }
    }

    &_scope-label {
        font-size: var(--font-size-xs);
        font-weight: 650;
        color: $surface7;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    &_scope-value {
        font-size: var(--font-size-sm);
        color: $content5;
        transition: 0.12s;
    }

    /* Fixed position on every soft row, so the column reads down the section.
       Hard rows render nothing here at all; see the template note. */
    &_weight {
        display: flex;
        gap: var(--space-3);
        align-items: center;

        margin: 0;

        font-size: var(--font-size-sm);
        color: $content7;

        input {
            width: 5.5rem;
            padding: var(--space-2) var(--space-4);
            border: 1px solid $surface4;
            border-radius: var(--radius-md);

            font-family: inherit;
            font-size: var(--font-size-sm);
            font-variant-numeric: tabular-nums;
            color: $content3;

            background: $surface1;

            &:focus {
                border-color: $primary500;
                outline: none;
            }
        }

        &--static strong {
            font-variant-numeric: tabular-nums;
            color: $content3;
        }
    }

    &_panel {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);

        margin-top: var(--space-3);
        padding-top: var(--space-5);
        border-top: 1px solid $surface3;
    }

    &_scopes,
    &_params {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);

        margin: 0;
        padding: 0;
        border: 0;

        legend {
            padding: 0 0 var(--space-2);

            font-size: var(--font-size-xs);
            font-weight: 650;
            color: $surface7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
    }

    &_kinds {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
    }

    &_kind {
        cursor: pointer;

        display: flex;
        gap: var(--space-3);
        align-items: center;

        padding: var(--space-2) var(--space-5);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-size: var(--font-size-sm);
        color: $content5;

        transition: 0.12s;

        input { accent-color: $primary500; }

        &--on {
            border-color: $primary500;
            color: $primary700;
            background: varToRgba('primary500', 0.12);
        }

        &--static {
            cursor: default;
            border-style: dashed;
        }
    }

    &_hint {
        max-width: 74ch;
        margin: 0;

        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;

        strong {
            font-weight: 650;
            color: $content5;
        }

        &--warn {
            color: $warning700;

            strong { color: $warning700; }
        }
    }
}
</style>
