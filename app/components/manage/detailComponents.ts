import type { Component } from 'vue';
import ManageAccessRoleForm from '~/components/manage/ManageAccessRoleForm.vue';
import ManageAccountForm from '~/components/manage/ManageAccountForm.vue';
import ManageCalendarPeriodForm from '~/components/manage/ManageCalendarPeriodForm.vue';
import ManageConstraintBuilder from '~/components/manage/ManageConstraintBuilder.vue';
import ManageConstraintGrid from '~/components/manage/ManageConstraintGrid.vue';
import ManageGroupForm from '~/components/manage/ManageGroupForm.vue';
import ManageGroupTree from '~/components/manage/ManageGroupTree.vue';
import ManageTimeGridEditor from '~/components/manage/ManageTimeGridEditor.vue';

/**
 * Bespoke bodies, resolved by the name a registry entry declares.
 *
 * THE SEAM THAT KEEPS THIS FROM BECOMING NINE PAGES: an entity that needs
 * something the generic scaffold cannot express replaces ONE slot — the fields
 * area, or the rows of the list — and keeps the shell, header, permission
 * handling, save/error plumbing and delete confirmation. Nothing here is a
 * whole page, and both bespoke forms below literally render `ManageEntityForm`
 * with their extra control passed into its `fields` slot.
 *
 * Two entities qualify so far, each for a stated reason:
 *
 *   GroupTree      a hierarchy shown as a flat table loses the one property
 *                  that makes it a hierarchy
 *   GroupForm      the parent select's options depend on which row is being
 *                  edited (self and descendants excluded)
 *   TimeGridEditor   `activeDays` is an ISO-weekday array, and the numbers are
 *                    unverifiable without a preview of the day they produce
 *   ConstraintBuilder type, severity, weight and params constrain each other;
 *                    as four independent controls they would compose states the
 *                    database CHECK rejects
 *
 * Offering is NOT here, and that is the point. It references a Term, a Kind and
 * a Role and holds three many-to-many sets — the hub of the whole model — but
 * every one of those is registry data (`fields`, `relations`), so it renders on
 * the generic scaffold. "Complex entity" did not turn out to mean "bespoke page".
 */
export const DETAIL_COMPONENTS: Record<string, Component> = {
    GroupForm: ManageGroupForm,
    TimeGridEditor: ManageTimeGridEditor,
    ConstraintBuilder: ManageConstraintBuilder,
    CalendarPeriodForm: ManageCalendarPeriodForm,
    /**
     * AccessRoleForm  the grants are a matrix over the FIXED permission
     *                 catalogue, which is code rather than an entity, so there
     *                 is no resource for a relation picker to draw options from
     *                 and no fetch that could be authoritative about them.
     */
    AccessRoleForm: ManageAccessRoleForm,
    /**
     * AccountForm      a login has a person it acts as, drawn from a
     *                  candidates endpoint rather than from `/api/persons`, and
     *                  a secret that must be visible exactly once. Neither is
     *                  expressible as a registry field, and the credential verbs
     *                  beside them (issue a password, sign out everywhere) must
     *                  not sit under a Save button that does not cover them.
     */
    AccountForm: ManageAccountForm,
};

export const LIST_COMPONENTS: Record<string, Component> = {
    GroupTree: ManageGroupTree,
    /**
     * Constraints are a fixed catalogue of switches, not a collection you
     * populate. The generic table framed them as the latter, which is how a
     * tenant ended up with types that had no row and were therefore never
     * evaluated. See the component for the full reasoning.
     */
    ConstraintGrid: ManageConstraintGrid,
};

export function resolveDetailComponent(name: string | undefined): Component | undefined {
    return name ? DETAIL_COMPONENTS[name] : undefined;
}

export function resolveListComponent(name: string | undefined): Component | undefined {
    return name ? LIST_COMPONENTS[name] : undefined;
}
