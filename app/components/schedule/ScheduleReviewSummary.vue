<template>
    <section class="rev">
        <!--
            THE RISK LINE.

            This was a tinted panel holding a 32px numeral, a note, a type list
            and a reassurance: four elements of chrome to say "nothing is
            wrong", and on a clean proposal the largest thing on the page was a
            `0`. The panel is gone. A clean result is one sentence; a breach gets
            the weight, because a breach is the only thing here that should stop
            somebody.
        -->
        <div class="rev_argument">
        <div
            v-if="violations.proposed.hard > 0"
            class="rev_risk"
        >
            <!--
                ONE PLURAL MESSAGE, verb included. This was a numeral, a noun
                with an `-s` flip and a VERB with the opposite flip, three
                mustaches for one sentence, and German has neither suffix. The
                `<strong>` around the count survives as an `<i18n-t>` slot so
                the numeral can move wherever the translated clause needs it.
            -->
            <p class="rev_risk-head">
                <Icon
                    name="material-symbols:error"
                    aria-hidden="true"
                />
                <i18n-t
                    keypath="schedule.reviewSummary.hardSurviving"
                    tag="span"
                    scope="global"
                    :plural="violations.proposed.hard"
                >
                    <template #count>
                        <strong>{{ violations.proposed.hard }}</strong>
                    </template>
                </i18n-t>
            </p>

            <ul class="rev_types">
                <li
                    v-for="row in proposedTypes"
                    :key="row.type"
                >
                    <span class="rev_types-count">{{ row.count }}</span>
                    {{ row.label }}
                </li>
            </ul>

            <!--
                Reported, never netted out: these name Sessions the solver
                invented under a synthetic key that appears nowhere in the
                placements, so no row can be pointed at.
            -->
            <p
                v-if="violations.proposed.unmappable > 0"
                class="rev_note"
            >
                {{ t('schedule.reviewSummary.unmappable', {
                    locatable,
                    total: violations.proposed.sessionReferences,
                    unmappable: violations.proposed.unmappable,
                }) }}
            </p>
        </div>

        <p
            v-else
            class="rev_clear"
        >
            <Icon
                name="material-symbols:check-circle-outline"
                aria-hidden="true"
            />
            {{ t('schedule.reviewSummary.clear') }}
        </p>

        <!--
            THE COMPARISON, AS ONE SENTENCE THAT CANNOT STRAND.

            The counts are not commensurable and must not read as a delta:
            `current` comes from this app's evaluator, which fills
            constraint_violation from the STRUCTURAL double-booking rules only,
            while `proposed` is the solver reporting across all 14 constraint
            types. Measured on the same timetable they disagree: the solver
            reported 23 where this evaluator then found 41.

            THE OLD LAYOUT DEFEATED THAT ARGUMENT TWICE. First as two symmetric
            cards, where adjacency plus symmetry IS an arrow. Then as a `3fr/2fr`
            grid whose second column was described in the code as "a footing
            line" and rendered, at 1440, as a stranded aside six hundred pixels
            from the panel it was meant to foot; a reviewer circled it and
            asked what it was.

            A caveat cannot strand if it is inside the same sentence as the fact
            it qualifies. One paragraph, subordinate clause, no second numeral
            competing for the eye.
        -->
        <!--
            The whole sentence is one plural message: the `-s` flip sat in the
            middle of a clause carrying two interpolations, so neither the noun
            nor the numeral had a key of its own. "They re-run after applying."
            stays a SEPARATE key because it is a separate sentence rendered
            under a separate condition, not a fragment of this one.
        -->
        <p class="rev_compare">
            <i18n-t
                keypath="schedule.reviewSummary.compare"
                tag="span"
                scope="global"
                :plural="violations.current.hard"
            >
                <template #rules>{{ structuralRuleCount }}</template>
                <template #count>
                    <strong>{{ violations.current.hard }}</strong>
                </template>
            </i18n-t><template v-if="decidable"> {{ t('schedule.reviewSummary.recheckNote') }}</template>
        </p>

        </div>

        <dl class="rev_facts">
            <div
                v-if="plan.skippedLocked"
                class="rev_fact"
            >
                <dt>{{ t('schedule.reviewSummary.lockedLabel') }}</dt>
                <dd>
                    {{ t('schedule.reviewSummary.lockedValue', { count: plan.skippedLocked }, plan.skippedLocked) }}
                </dd>
            </div>

            <!--
                THE SHORTFALL, ABOVE EVERY OTHER FACT.

                A run that answers fewer placements than it was asked for looks
                identical to a complete one in every count on this page: the
                missing Sessions simply appear as deletions, and "11 removed"
                reads as a decision the solver made. It is not one: it is an
                answer with holes in it, and the apply now refuses to delete on
                it. That refusal has to be visible, or the page has quietly
                corrected something the reviewer would want to know about.
            -->
            <div
                v-if="demandShort"
                class="rev_fact rev_fact--warn"
            >
                <dt>{{ t('schedule.reviewSummary.demandShortLabel') }}</dt>
                <dd>
                    {{ t('schedule.reviewSummary.demandShortValue', {
                        returned: demandShort.returned.toLocaleString(),
                        required: demandShort.required.toLocaleString(),
                        count: demandShort.shortOfferings,
                    }, demandShort.shortOfferings) }}
                    <!--
                        The worst of the inline plurals: a noun suffix, a VERB
                        ("is"/"are") and a PRONOUN used twice ("it"/"them") all
                        agreeing with one count across five mustaches. One
                        plural message per form now carries all of it.
                    -->
                    <template v-if="withheld">
                        {{ t('schedule.reviewSummary.withheldValue', { count: withheld }, withheld) }}
                    </template>
                </dd>
            </div>

            <!--
                Older runs recorded nothing about what they asked for, so the
                check above cannot run at all. Said only when it MATTERS: a
                proposal with no deletions rests on nothing, so warning about it
                would be noise on every historical proposal in the list.
            -->
            <div
                v-else-if="unverifiedDeletes"
                class="rev_fact rev_fact--warn"
            >
                <dt>{{ t('schedule.reviewSummary.unverifiedLabel') }}</dt>
                <dd>
                    {{ t('schedule.reviewSummary.unverifiedValue', { count: plan.deleted }, plan.deleted) }}
                    {{ t('schedule.reviewSummary.unverifiedFix') }}
                </dd>
            </div>

            <div
                v-if="plan.placementsUnmapped"
                class="rev_fact rev_fact--warn"
            >
                <dt>{{ t('schedule.reviewSummary.unplaceableLabel') }}</dt>
                <dd>
                    {{ t('schedule.reviewSummary.unplaceableValue', {
                        count: plan.placementsUnmapped,
                    }, plan.placementsUnmapped) }}
                </dd>
            </div>

            <div class="rev_fact">
                <dt>{{ t('schedule.reviewSummary.runLabel') }}</dt>
                <dd>
                    {{ terminationSentence(run?.terminationReason ?? null, t) }}
                    <template v-if="run?.elapsedMillis">
                        {{ t('schedule.reviewSummary.took', {
                            seconds: (run.elapsedMillis / 1000).toFixed(1),
                        }) }}
                    </template>
                </dd>
            </div>

            <!--
                The objective is a RELATIVE score with no absolute scale: two
                proposals for the same term measured 430 and 33,955, so it is
                said as a comparable quantity and pointed at the one place a
                comparison exists.
            -->
            <div
                v-if="run?.objective !== null && run?.objective !== undefined"
                class="rev_fact"
            >
                <dt>{{ t('schedule.reviewSummary.scoreLabel') }}</dt>
                <dd>
                    {{ t('schedule.reviewSummary.scoreValue', {
                        score: run.objective.toLocaleString(),
                    }) }}
                    <NuxtLink
                        class="rev_link"
                        to="/schedule/proposals"
                    >{{ t('schedule.reviewSummary.compareProposals') }}</NuxtLink>
                </dd>
            </div>
        </dl>
    </section>
</template>

<script setup lang="ts">
import { STRUCTURAL_CONSTRAINT_TYPES, constraintTypeLabel } from '#shared/constraintTypes';
import { terminationSentence } from '~/composables/generationReview';
import type { ReviewPreview } from '~/composables/generationReview';
import { useT } from '~/composables/i18n';

/**
 * The proposal's risk and provenance, as a strip rather than a dashboard.
 *
 * `deletedByOffering` used to render here as its own block. It does not any
 * more: `ScheduleReviewChanges` names every removal against the Offering it
 * belongs to, destructive rows first, which is the same information attached to
 * the thing it happened to. Two lists of the same removals is one list too
 * many.
 */
const props = defineProps<{
    plan: NonNullable<ReviewPreview['plan']>;
    violations: ReviewPreview['violations'];
    run: ReviewPreview['run'];
    /** What the run asked for against what it answered. Absent on an older payload. */
    demand?: ReviewPreview['demand'];
    /** READY, so "they re-run after applying" is a true statement about a future. */
    decidable: boolean;
}>();

const { t } = useT();

/**
 * The shortfall, or null when there is nothing to report.
 *
 * `shortOfferings > 0` is the test rather than `returned < required`: the
 * per-Offering count is what the plan actually withholds deletes on, so a
 * summary that spoke from the totals could claim a shortfall the plan did not
 * act on: two readings of the same run that disagree in front of the reviewer.
 */
const demandShort = computed(() => {
    const demand = props.demand;

    return demand && demand.verified && demand.shortOfferings > 0 ? demand : null;
});

const withheld = computed(() => props.plan.deletesWithheld ?? 0);

/**
 * A run with no ledger that nonetheless proposes removals: the case this check
 * exists for, arriving from before the check existed. Absent `demand` counts as
 * unverified: an older payload has no field, and reading that as "verified"
 * would restore exactly the silent assumption being removed.
 */
const unverifiedDeletes = computed(() => !props.demand?.verified && props.plan.deleted > 0);

/**
 * Derived, not written out. This label read "3 structural rules" for the whole
 * of Stage 7 after `no_double_booking_person` made it four, a user-facing
 * count stating the wrong number, which nothing checks. Binding it to the
 * catalogue is what stops that recurring.
 */
const structuralRuleCount = STRUCTURAL_CONSTRAINT_TYPES.length;

/**
 * Both breakdowns go through the catalogue, because they arrive in two
 * different namespaces: the app evaluator writes snake_case reasons and the
 * solver reports its proto's PascalCase names. Rendered raw, two adjacent lists
 * spoke two languages and one of them said "4 × MaxOnlineShare".
 */
const toRows = (byType: Record<string, number>) => Object.entries(byType)
    .map(([type, count]) => ({ type, count, label: constraintTypeLabel(type) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

const proposedTypes = computed(() => toRows(props.violations.proposed.byType));

const locatable = computed(() => (
    props.violations.proposed.sessionReferences - props.violations.proposed.unmappable
));
</script>

<style scoped lang="scss">
.rev {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);

    /*
     * TWO COLUMNS FROM `pc()`, and this is a correction to my own first pass.
     *
     * Capping the whole strip at the prose measure left a 750px column of text
     * with roughly 600px of empty page beside it at 1440, and the `<dl>`'s rule
     * stopped dead in the middle of the screen. The band above and the grid
     * below both run full width, so the argument between them read as a stranded
     * left-hand column: the same "weird layout" complaint this redesign started
     * from, one section lower.
     *
     * The verdict and its caveat keep a reading measure; the provenance facts sit
     * beside them instead of under them. Below `pc()` it stacks, which is correct
     * for one column.
     */
    @include pc() {
        flex-direction: row;
        gap: var(--space-9);
        align-items: flex-start;
    }

    /*
     * THE FLEX BASIS BELONGS INSIDE `pc()`, and leaving it outside was a real
     * defect rather than a redundancy.
     *
     * `.rev` is a COLUMN below 1366px, so `flex: 1 1 46ch` is a main-axis
     * HEIGHT there, not a width. Measured on the 390 capture: blank bands of
     * 126px, 120px and 235px around this one component, with the change list
     * pushed a full screen further down. Invisible at 1440, where the row
     * direction makes the same declaration mean what it was written to mean.
     */
    &_argument {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
        max-width: var(--review-measure, 78ch);

        @include pc() {
            flex: 1 1 46ch;
        }
    }

    /*
     * THE ONE PLACE THIS PAGE STILL FILLS A BOX, and it is the only state that
     * earns one: a surviving hard violation is the whole reason warn-and-allow
     * lets this proposal be applied at all.
     *
     * `$surface2`, not `$surface1`. Panels here were `$surface1` on a `$surface1`
     * body, the same value in both themes, so every card on this page rendered
     * invisible and the composition existed only in the source. Fixed at page
     * scope; the token roles in DESIGN.md that made it possible are their own
     * change.
     */
    &_risk {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);

        /*
         * A 1px edge, not the 2px coloured gutter. That gutter is the DIFF
         * vocabulary, where each placement state overrides only
         * `border-left-color`/`-style`. This redesign spent it on six
         * unrelated callouts, which devalues it and trips the floor's own
         * rule about coloured left borders above 1px. The error tint, the
         * icon and the red numeral are already three channels.
         */
        padding: var(--space-6);
        border: 1px solid $surface5;
        border-radius: var(--radius-lg);

        background:
            linear-gradient(varToRgba('error600', 0.08), varToRgba('error600', 0.08)),
            $surface2;
    }

    &_risk-head {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
        align-items: baseline;

        font-size: var(--font-size-md);
        font-variant-numeric: tabular-nums;
        color: $content1;

        strong {
            font-size: var(--font-size-lg);
            font-weight: 600;
            color: $error700;
        }

        .iconify {
            flex: none;
            align-self: center;

            width: 16px;
            height: 16px;

            color: $error700;
        }
    }

    // Never hue alone: the clean state carries its own icon and its own words,
    // so it survives greyscale and a screen reader.
    &_clear {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        font-size: var(--font-size-md);
        color: $content6;

        .iconify {
            flex: none;
            width: 16px;
            height: 16px;
            color: $success700;
        }
    }

    &_types {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        font-size: var(--font-size-sm);
        color: $content2;
        list-style: none;

        li {
            display: flex;
            gap: var(--space-3);
            align-items: baseline;
        }
    }

    &_types-count {
        min-width: 1.5ch;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        text-align: right;
    }

    &_note {
        padding-top: var(--space-4);
        border-top: 1px solid $surface5;
        font-size: var(--font-size-sm);
        color: $content6;
    }

    &_compare {
        font-size: var(--font-size-md);
        font-variant-numeric: tabular-nums;
        line-height: var(--leading-prose);
        color: $content6;

        strong { color: $content2; }
    }

    /*
     * A definition list, and the semantics are the point: every row here is a
     * label and its value, which is what `<dl>` means. It rendered as anonymous
     * `<span>`s inside `<div>`s before, so nothing but proximity said the label
     * belonged to the value.
     */
    &_facts {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);

        padding-top: var(--space-6);
        border-top: 1px solid $surface5;

        // Beside the argument rather than under it, so the rule that separated
        // the two vertically becomes the seam between two columns. The basis is
        // scoped here for the same reason as `_argument`'s.
        @include pc() {
            flex: 1 1 34ch;

            padding-top: 0;
            padding-left: var(--space-7);
            border-top: 0;
            border-left: 1px solid $surface5;
        }
    }

    &_fact {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: baseline;

        dt {
            min-width: 92px;

            font-size: var(--font-size-xs);
            font-weight: 600;
            color: $content6;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        dd {
            flex: 1 1 24ch;
            font-size: var(--font-size-md);
            font-variant-numeric: tabular-nums;
            color: $content2;
        }

        // The one fact that is a warning rather than provenance: sessions this
        // proposal wants and cannot store are silently absent after applying.
        &--warn dd { color: $warning800; }
    }

    &_link {
        color: $primary700;
        text-decoration: underline;
        text-underline-offset: 2px;
    }
}
</style>
