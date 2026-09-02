<template>
    <section
        v-if="canApply"
        class="apply"
    >
        <header class="apply_head">
            <h2>{{ t('manageUi.groupApplyPlan.title') }}</h2>
        </header>

        <p
            v-if="applications.length"
            class="apply_help"
        >{{ t('manageUi.groupApplyPlan.alreadyHas') }}</p>

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
                >{{ t('manageUi.groupApplyPlan.advance', {
                    plan: application.advance.planName,
                    term: application.advance.termName,
                }) }}</CommonButton>
            </li>
        </ul>

        <p class="apply_help">
            {{
                applications.length
                    ? t('manageUi.groupApplyPlan.applyAnother')
                    : t('manageUi.groupApplyPlan.introHint')
            }}
        </p>

        <p
            v-if="error"
            class="apply_error"
            role="alert"
        >{{ error }}</p>

        <div class="apply_controls">
            <label class="apply_field">
                <span>{{ t('manageUi.groupApplyPlan.planLabel') }}</span>
                <select
                    v-model="planId"
                    :disabled="busy"
                >
                    <option value="">{{ t('manageUi.groupApplyPlan.planPlaceholder') }}</option>
                    <option
                        v-for="plan in plans"
                        :key="plan.id"
                        :value="plan.id"
                    >{{ plan.name }}</option>
                </select>
            </label>

            <label class="apply_field">
                <span>{{ t('manageUi.shared.termLabel') }}</span>
                <select
                    v-model="termId"
                    :disabled="busy"
                >
                    <option value="">{{ t('manageUi.shared.termPlaceholder') }}</option>
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
            >{{ busy ? t('manageUi.shared.applying') : t('manageUi.groupApplyPlan.apply') }}</CommonButton>
        </div>

        <p
            v-if="summary"
            class="apply_ok"
        >{{ summary }}</p>
    </section>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';

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

const { t } = useT();

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

/**
 * What one apply actually did, as a sentence.
 *
 * GRAMMAR, NOT PUNCTUATION (i18n/CONVENTIONS.md § "Assembled sentences"), and
 * built the way that section prescribes for exactly this shape:
 *
 *   - each clause is ONE plural message, verb and noun together, never a count
 *     with an `-s` patched onto the word beside it: German pluralises by stem;
 *   - the conjunction is a PAIRWISE FOLD through `listJoin` (`"{list} and
 *     {next}"`), so it stays translatable at any list length rather than being
 *     a bare `' and '` fragment;
 *   - the two ways the sentence can END (with or without the "already had this
 *     group" aside) are two whole messages, because that aside sits inside the
 *     final full stop and a translator has to be able to move it.
 *
 * The alternative, one message per combination, would be six messages whose
 * two counts cannot both be pluralised in one vue-i18n string anyway.
 */
function describe(offerings: AppliedOffering[]): string {
    const created = offerings.filter((o) => o.action === 'created').length;
    const attached = offerings.filter((o) => o.action === 'attached').length;
    const already = offerings.filter((o) => o.action === 'already-attached').length;

    if (!created && !attached) {
        return t('manageUi.groupApplyPlan.nothingToDo');
    }

    const parts = [
        ...(created ? [t('manageUi.shared.partCreated', { count: created }, created)] : []),
        ...(attached ? [t('manageUi.groupApplyPlan.partAttached', { count: attached }, attached)] : []),
    ];

    const list = parts.reduce((joined, next) => t(
        'manageUi.shared.listJoin',
        { list: joined, next },
    ));

    return already
        ? t('manageUi.groupApplyPlan.doneWithAlready', { parts: list, count: already })
        : t('manageUi.groupApplyPlan.done', { parts: list });
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
        error.value = serverErrorMessage(cause) ?? t('manageUi.shared.applyError');
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
