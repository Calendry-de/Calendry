<template>
    <CommonAppShell
        :description="t('managePages.curriculumProgression.description')"
        :title="t('managePages.curriculumProgression.pageTitle')"
    >
        <p class="intro">
            {{ t('managePages.curriculumProgression.intro') }}
        </p>

        <p
            v-if="loadError"
            class="note note--error"
            role="alert"
        >{{ loadError }}</p>

        <template v-else>
            <p
                v-if="!eligibleCount"
                class="note"
            >{{ t('managePages.curriculumProgression.noneEligible') }}</p>

            <div
                v-else
                class="actions"
            >
                <!--
                    ONE plural message with the count inside it: "group{s}" was
                    a word split across an expression, so no part of it could be
                    keyed and German pluralises the stem, not the suffix.
                -->
                <CommonButton
                    :disabled="advancing"
                    type="primary"
                    @click="advanceAll"
                >{{ advancing
                    ? t('managePages.curriculumProgression.advancing')
                    : t('managePages.curriculumProgression.advance', { count: eligibleCount }) }}</CommonButton>
            </div>

            <p
                v-if="advanceError"
                class="note note--error"
                role="alert"
            >{{ advanceError }}</p>

            <ul
                v-if="result"
                class="result"
            >
                <!--
                    Both rows below join TENANT-NAMED values (group, plan, term)
                    with punctuation only, so the joins stay in code:
                    i18n/CONVENTIONS.md § "Assembled sentences" — the arrow, the
                    colon and the parentheses carry no grammar, and a message
                    whose whole content is "{a}: {b} → {c} ({d})" gives a
                    translator nothing to translate. The failure row is the
                    opposite case (it has a verb and a plural), so it IS keyed.
                -->
                <li
                    v-for="row in result.advanced"
                    :key="`${row.groupId}:${row.toPlanId}`"
                    class="result_row result_row--ok"
                >{{ row.groupName }}: {{ row.fromPlanName }} → {{ row.toPlanName }} ({{ row.toTermName }})</li>
                <li
                    v-for="batch in result.failed"
                    :key="`${batch.planId}:${batch.termId}`"
                    class="result_row result_row--error"
                >{{ t('managePages.curriculumProgression.failedRow', {
                    count: batch.groupIds.length,
                    plan: batch.planName,
                    term: batch.termName,
                    reason: batch.reason,
                }) }}</li>
            </ul>

            <table
                v-if="rows.length"
                class="table"
            >
                <thead>
                    <tr>
                        <th>{{ t('managePages.curriculumProgression.columnGroup') }}</th>
                        <th>{{ t('managePages.curriculumProgression.columnPhase') }}</th>
                        <th>{{ t('managePages.curriculumProgression.columnAdvances') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <template
                        v-for="row in rows"
                        :key="row.groupId"
                    >
                        <tr
                            v-for="application in row.applications"
                            :key="`${row.groupId}:${application.planId}:${application.termId}`"
                        >
                            <td>{{ row.groupName }}</td>
                            <td>{{ application.planName }} · {{ application.termName }}</td>
                            <td>
                                <span v-if="application.advance">{{ application.advance.planName }} ({{ application.advance.termName }})</span>
                                <span
                                    v-else
                                    class="table_muted"
                                >{{ t('managePages.curriculumProgression.advancesToNone') }}</span>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>

            <p
                v-else-if="!loadError"
                class="note"
            >{{ t('managePages.curriculumProgression.emptyHint') }}</p>
        </template>
    </CommonAppShell>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import CommonAppShell from '~/components/common/CommonAppShell.vue';
import { useT } from '~/composables/i18n';
import { useSession } from '~/composables/session';

/**
 * The bulk half of curriculum-plan progression (issue #100): the single-
 * Group version already lives on each Group's own page
 * (`ManageGroupApplyPlan.vue`, reading `GET /api/group-plan-applications/:id`).
 * This is a bespoke settings page rather than a registry entity for the same
 * reason `/manage/access-defaults` is: there is no list of rows to CRUD, just
 * one tenant-wide action.
 *
 * NOTHING IS STORED. "Which phase is a group in" is derived fresh, every
 * load, from the offerings a plan already created
 * (`deriveGroupPlanApplications`, `server/utils/offeringPlans.ts`): a Group
 * absent from the table has simply never had a plan applied.
 */
definePageMeta({
    // Gated inline, not through the `manage` entity middleware, same reason
    // `/manage/access-defaults` is: this is not a registry entity.
    middleware: [
        () => {
            const held = new Set(useSession().value?.permissions ?? []);

            if (!held.has('offering_plan.apply')) {
                return abortNavigation(createError({
                    statusCode: 403,
                    message: 'Curriculum progression needs offering_plan.apply.',
                }));
            }
        },
    ],
});

const { t } = useT();

useHead(() => ({ title: t('managePages.curriculumProgression.pageTitle') }));

interface AdvanceTarget { planId: string; planName: string; termId: string; termName: string }
interface Application { planId: string; planName: string; termId: string; termName: string; advance: AdvanceTarget | null }
interface GroupRow { groupId: string; groupName: string; applications: Application[] }

interface AdvancedGroup { groupId: string; groupName: string; fromPlanName: string; toPlanId: string; toPlanName: string; toTermName: string; offerings: number }
interface FailedBatch { planId: string; planName: string; termId: string; termName: string; groupIds: string[]; reason: string }
interface AdvanceAllResult { advanced: AdvancedGroup[]; failed: FailedBatch[] }

const request = useRequestFetch();

const { data, error, refresh } = await useAsyncData(
    'curriculum-progression',
    () => request<{ rows: GroupRow[] }>('/api/group-plan-applications'),
);

const rows = computed(() => data.value?.rows ?? []);
const loadError = computed(() => (error.value ? t('managePages.curriculumProgression.loadError') : ''));

const eligibleCount = computed(
    () => rows.value.reduce((sum, row) => sum + row.applications.filter((a) => a.advance).length, 0),
);

const advancing = ref(false);
const advanceError = ref('');
const result = ref<AdvanceAllResult | null>(null);

async function advanceAll() {
    if (advancing.value) {
        return;
    }

    advancing.value = true;
    advanceError.value = '';
    result.value = null;

    try {
        result.value = await request<AdvanceAllResult>('/api/group-plan-applications/advance-all', { method: 'POST' });
        await refresh();
    } catch (cause) {
        advanceError.value = serverErrorMessage(cause)
            ?? t('managePages.curriculumProgression.advanceError');
    } finally {
        advancing.value = false;
    }
}
</script>

<style scoped lang="scss">
.intro {
    max-width: 68ch;
    margin-bottom: var(--space-6);
    font-size: var(--font-size-md);
    color: $content6;
}

.note {
    max-width: 68ch;
    margin-bottom: var(--space-6);
    font-size: var(--font-size-sm);
    color: $content7;

    &--error {
        color: $error700;
    }
}

.actions {
    margin-bottom: var(--space-6);
}

.result {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);

    margin: 0 0 var(--space-6);
    padding: 0;

    list-style: none;

    &_row {
        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);

        &--ok {
            color: $success700;
            background: varToRgba('success500', 0.12);
        }

        &--error {
            color: $error700;
            background: varToRgba('error500', 0.14);
        }
    }
}

.table {
    border-collapse: collapse;
    width: 100%;

    th, td {
        padding: var(--space-3) var(--space-4);
        border-bottom: 1px solid $surface4;

        font-size: var(--font-size-sm);
        color: $content4;
        text-align: left;
    }

    th {
        font-weight: 650;
        color: $content7;
    }

    &_muted { color: $content7; }
}
</style>
