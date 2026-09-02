<template>
    <CommonAppShell
        description="Which curriculum plan each group is currently on, and moving every eligible one forward at once."
        title="Curriculum progression"
    >
        <p class="intro">
            Nothing here is stored on the group: this is worked out fresh each time
            from the offerings a plan already created. A group with a plan that names a
            successor, and a later term to move into, is eligible to advance.
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
            >No group is eligible to advance right now.</p>

            <div
                v-else
                class="actions"
            >
                <CommonButton
                    :disabled="advancing"
                    type="primary"
                    @click="advanceAll"
                >{{ advancing ? 'Advancing…' : `Advance ${eligibleCount} eligible group${eligibleCount === 1 ? '' : 's'}` }}</CommonButton>
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
                <li
                    v-for="row in result.advanced"
                    :key="`${row.groupId}:${row.toPlanId}`"
                    class="result_row result_row--ok"
                >{{ row.groupName }}: {{ row.fromPlanName }} → {{ row.toPlanName }} ({{ row.toTermName }})</li>
                <li
                    v-for="batch in result.failed"
                    :key="`${batch.planId}:${batch.termId}`"
                    class="result_row result_row--error"
                >{{ batch.groupIds.length }} group{{ batch.groupIds.length === 1 ? '' : 's' }} could not move to
                    {{ batch.planName }} ({{ batch.termName }}): {{ batch.reason }}</li>
            </ul>

            <table
                v-if="rows.length"
                class="table"
            >
                <thead>
                    <tr>
                        <th>Group</th>
                        <th>Current phase</th>
                        <th>Advances to</th>
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
                                >(none)</span>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>

            <p
                v-else-if="!loadError"
                class="note"
            >No group has an offering created from a curriculum plan yet.</p>
        </template>
    </CommonAppShell>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import CommonAppShell from '~/components/common/CommonAppShell.vue';
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
                    statusMessage: 'Curriculum progression needs offering_plan.apply.',
                }));
            }
        },
    ],
});

useHead({ title: 'Curriculum progression' });

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
const loadError = computed(() => (error.value ? 'Could not load curriculum progression.' : ''));

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
        advanceError.value = (cause as { data?: { statusMessage?: string } }).data?.statusMessage
            ?? 'Could not advance groups. Nothing was changed.';
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
