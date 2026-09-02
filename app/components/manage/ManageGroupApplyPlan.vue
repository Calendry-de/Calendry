<template>
    <section
        v-if="canApply"
        class="apply"
    >
        <header class="apply_head">
            <h2>Curriculum plans</h2>
        </header>

        <p
            v-if="applications.length"
            class="apply_help"
        >Already has:</p>

        <ul
            v-if="applications.length"
            class="apply_history"
        >
            <li
                v-for="application in applications"
                :key="`${application.planId}:${application.termId}`"
                class="apply_history-row"
            >
                <span>{{ application.planName }} · {{ application.termName }}</span>
                <CommonButton
                    v-if="application.advance"
                    :disabled="busy"
                    type="secondary"
                    @click="advance(application.advance)"
                >Advance to {{ application.advance.planName }} ({{ application.advance.termName }})</CommonButton>
            </li>
        </ul>

        <p class="apply_help">
            {{ applications.length ? 'Apply another plan:' : 'Gives this group every offering in the chosen plan, for the term below: it creates whichever ones don’t exist yet and attaches this group to whichever already do, so two groups taking the same subject in one term share one offering rather than duplicating it.' }}
        </p>

        <p
            v-if="error"
            class="apply_error"
            role="alert"
        >{{ error }}</p>

        <div class="apply_controls">
            <label class="apply_field">
                <span>Plan</span>
                <select
                    v-model="planId"
                    :disabled="busy"
                >
                    <option value="">Choose a plan…</option>
                    <option
                        v-for="plan in plans"
                        :key="plan.id"
                        :value="plan.id"
                    >{{ plan.name }}</option>
                </select>
            </label>

            <label class="apply_field">
                <span>Term</span>
                <select
                    v-model="termId"
                    :disabled="busy"
                >
                    <option value="">Choose a term…</option>
                    <option
                        v-for="term in terms"
                        :key="term.id"
                        :value="term.id"
                    >{{ term.name }}</option>
                </select>
            </label>

            <CommonButton
                :disabled="busy || !planId || !termId"
                type="primary"
                @click="apply(planId, termId)"
            >{{ busy ? 'Applying…' : 'Apply' }}</CommonButton>
        </div>

        <p
            v-if="summary"
            class="apply_ok"
        >{{ summary }}</p>
    </section>
</template>

<script setup lang="ts">
/**
 * The action that makes an `OfferingPlan` actually do something: pick a
 * Plan and a Term, and this Group gets that plan's whole course load: real
 * Offerings, each already attached to it. Also shows what this Group
 * already has, because "advance" (below) reads directly off that history;
 * see `group-plan-applications/[id].get.ts` for how it's reconstructed.
 *
 * ONE ACTION SERVES BOTH ONBOARDING STORIES. A brand-new Group ("this
 * year's Jahrgang 10") applies a plan once, right here on the page it lands
 * on after creation. An EXISTING Group moving into a new Term uses
 * "Advance" instead of re-picking a Plan and Term by hand: it already
 * knows both, from the Plan's own `nextPlanId` and the next Term
 * chronologically. There is no Group-level "current term" to switch,
 * because Group is Term-independent by design (TAXONOMY.md): the only thing
 * that was ever term-scoped is the Offerings.
 *
 * NO CONFIRM STEP ON EITHER PATH, because the server side is idempotent: an
 * Offering already shared with another Group for this subject/Term is
 * joined, not duplicated (see `offering-plan-apply/[id].post.ts`), so
 * applying or advancing again is always safe.
 */
const props = defineProps<{
    groupId: string;
    readonly?: boolean;
}>();

interface PlanRow { id: string; name: string }
interface TermRow { id: string; name: string }
interface AppliedOffering { id: string; title: string; action: 'created' | 'attached' | 'already-attached' }
interface AdvanceTarget { planId: string; planName: string; termId: string; termName: string }
interface Application { planId: string; planName: string; termId: string; termName: string; advance: AdvanceTarget | null }

const canApply = useHasPermission('offering_plan.apply');
const request = useRequestFetch();

const { data: plansData } = await useAsyncData(
    'apply-plan:plans',
    () => request<PlanRow[]>('/api/offering-plans'),
    { default: () => [] as PlanRow[] },
);

const { data: termsData } = await useAsyncData(
    'apply-plan:terms',
    () => request<TermRow[]>('/api/terms'),
    { default: () => [] as TermRow[] },
);

const { data: applicationsData, refresh: refreshApplications } = await useAsyncData(
    `apply-plan:history:${props.groupId}`,
    () => request<Application[]>(`/api/group-plan-applications/${props.groupId}`),
    { default: () => [] as Application[] },
);

const plans = computed(() => plansData.value ?? []);
const terms = computed(() => termsData.value ?? []);
const applications = computed(() => applicationsData.value ?? []);

const planId = ref('');
const termId = ref('');
const busy = ref(false);
const error = ref('');
const summary = ref('');

function describe(offerings: AppliedOffering[]): string {
    const created = offerings.filter((o) => o.action === 'created').length;
    const attached = offerings.filter((o) => o.action === 'attached').length;
    const already = offerings.filter((o) => o.action === 'already-attached').length;

    if (!created && !attached) {
        return 'This group already has every offering in this plan for this term.';
    }

    const parts = [
        ...(created ? [`created ${created} offering${created === 1 ? '' : 's'}`] : []),
        ...(attached ? [`joined this group to ${attached} existing offering${attached === 1 ? '' : 's'}`] : []),
    ];

    const alreadyClause = already ? ` (${already} already had this group)` : '';

    return `Done: ${parts.join(' and ')}${alreadyClause}.`;
}

async function apply(applyPlanId: string, applyTermId: string) {
    if (!applyPlanId || !applyTermId || busy.value) {
        return;
    }

    busy.value = true;
    error.value = '';
    summary.value = '';

    try {
        const result = await request<{ offerings: AppliedOffering[] }>(
            `/api/offering-plan-apply/${applyPlanId}`,
            { method: 'POST', body: { termId: applyTermId, groupId: props.groupId } },
        );

        summary.value = describe(result.offerings);
        planId.value = '';
        termId.value = '';
        await refreshApplications();
    } catch (cause) {
        // h3 nests a custom `data` one level inside the response body; see
        // `useEntityForm`'s own comment on this, verified against a live error.
        const body = (cause as { data?: { statusMessage?: string } }).data;

        error.value = body?.statusMessage ?? 'Could not apply this plan.';
    } finally {
        busy.value = false;
    }
}

function advance(target: AdvanceTarget) {
    void apply(target.planId, target.termId);
}
</script>

<style scoped lang="scss">
.apply {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    padding: var(--space-6);
    border-radius: var(--radius-xl);

    background: $surface1;

    &_head h2 {
        margin: 0;
        font-size: var(--font-size-md);
        font-weight: 680;
        color: $content2;
    }

    &_help {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: $content7;
    }

    &_history {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        margin: 0;
        padding: 0;

        list-style: none;

        &-row {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-4);
            align-items: center;
            justify-content: space-between;

            padding: var(--space-3) var(--space-4);
            border-radius: var(--radius-lg);

            font-size: var(--font-size-md);
            color: $content3;

            background: $surface0;
        }
    }

    &_error {
        margin: 0;
        padding: var(--space-3) var(--space-5);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $error700;

        background: varToRgba('error500', 0.14);
    }

    &_controls {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: flex-end;
    }

    &_field {
        display: flex;
        flex: 1 1 200px;
        flex-direction: column;
        gap: var(--space-2);

        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $content4;

        select {
            padding: var(--space-3) var(--space-5);
            border: 1px solid $surface4;
            border-radius: var(--radius-lg);

            font-family: inherit;
            font-size: var(--font-size-md);
            font-weight: 400;
            color: $content4;

            background: $surface0;
        }
    }

    &_ok {
        margin: 0;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: $success700;
    }
}
</style>
