import type { ConstraintParamDef, ConstraintTypeDef } from '#shared/constraintTypes';
import type { FieldDef } from '~/utils/manageRegistry';

/**
 * How one catalogue parameter is rendered as a form control.
 *
 * WHY THIS IS A PAIR AND NOT TWO FUNCTIONS
 * ----------------------------------------
 * A parameter needs one of two controls: `weekdays` has a bespoke picker
 * (ManageWeekdayPicker), everything else maps onto the generic `ManageField`.
 * Both call sites used to decide that with their own `v-if` and then map the
 * field with their own copy of the mapper: a branch and a mapper that had to
 * agree, in two places, with nothing checking that they did.
 *
 * They had already stopped agreeing. `ManageConstraintGrid` mapped
 * `percent -> number` but dropped `required`, `min` and `max` and skipped the
 * "(%)" relabelling, so the same parameter rendered as two different controls
 * depending on which screen you were looking at. Worse, its mapper passed
 * `param.type` straight through for anything it did not special-case, so a
 * `weekdays` param reaching it would have produced a FieldDef with a type
 * outside `FieldType`; invisible, because the `v-if` happened to intercept it
 * first.
 *
 * Returning the DECISION and the field together removes the branch from the
 * caller: there is one place that knows `weekdays` is special, and a caller
 * cannot pick the wrong control because it no longer picks.
 */
export type ConstraintParamControl =
    /** ISO-weekday multi-select. Rendered by ManageWeekdayPicker. */
    | { kind: 'weekdays'; param: ConstraintParamDef }
    /** Everything else, as a field the generic renderer understands. */
    | { kind: 'field'; param: ConstraintParamDef; field: FieldDef };

/**
 * A catalogue parameter, expressed as a field the generic renderer understands.
 *
 * `percent` renders as a number labelled "(%)" because the tenant thinks in
 * 0–100 while the wire wants 0.0–1.0. The conversion happens server-side at the
 * mapping boundary (`buildVariant` in solverInput.ts), so what is STORED is
 * what was typed; the label is the only place the unit is stated, which is why
 * dropping it mattered.
 */
function paramField(param: ConstraintParamDef): FieldDef {
    const type: FieldDef['type'] = (() => {
        switch (param.type) {
            case 'percent': return 'number';
            case 'number': return 'number';
            case 'boolean': return 'boolean';
            case 'select': return 'select';
            // `weekdays` never reaches here: `constraintParamControl` routes it
            // to its own control before this is called.
            default: return 'text';
        }
    })();

    return {
        key: param.key,
        label: param.type === 'percent' ? `${param.label} (%)` : param.label,
        type,
        help: param.help,
        required: param.required,
        min: param.min,
        max: param.max,
        options: param.options,
    };
}

/** Which control one parameter needs, and the field definition if it is generic. */
export function constraintParamControl(param: ConstraintParamDef): ConstraintParamControl {
    return param.type === 'weekdays'
        ? { kind: 'weekdays', param }
        : { kind: 'field', param, field: paramField(param) };
}

/** Every parameter of a type, ready to render. */
export function constraintParamControls(type: ConstraintTypeDef): ConstraintParamControl[] {
    return type.params.map(constraintParamControl);
}
