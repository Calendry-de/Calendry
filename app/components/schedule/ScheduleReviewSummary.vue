<template>
    <section class="rev">
        <h2 class="rev_heading">What this proposal does</h2>

        <!--
            TWO READINGS, NOT TWO PANELS.

            The counts are not commensurable and must not be rendered as a
            delta: `current` comes from constraint_violation, which this app's
            evaluator fills using only the structural double-booking rules
            (STRUCTURAL_CONSTRAINT_TYPES — the count is derived, never written
            out, because it went stale once when Stage 7a made it four), while
            `proposed` is the solver reporting on all 14 constraint
            types. Measured on the same timetable they disagree — the solver
            reported 23 where the app's evaluator then found 41 rows. "0 → 23"
            would be the most misleading thing this screen could say.

            THAT ARGUMENT USED TO BE DEFEATED BY THE LAYOUT. Two equal cards
            side by side, headed "Now" and "Proposed", each showing one big
            numeral in identical type: adjacency plus symmetry IS an arrow, and
            the sentence denying it sat underneath in 11px italic — the most
            recessed text on the screen carrying the most interpretive weight.

            So the shape now matches the claim. The proposal's own count is the
            card, because it is the number the decision turns on. The current
            schedule's count is a footing line — present, findable, deliberately
            not a rival numeral. The disclaimer leads, at reading weight.
        -->
        <p class="rev_incomparable">
            The two counts below come from different rule sets and are not a
            like-for-like difference.
        </p>

        <div class="rev_state">
            <article
                class="rev_panel"
                :class="{ 'rev_panel--flagged': violations.proposed.hard > 0 }"
            >
                <h3 class="rev_panel-title">
                    <Icon
                        v-if="violations.proposed.hard > 0"
                        name="material-symbols:error"
                        class="rev_panel-icon"
                        aria-hidden="true"
                    />
                    In this proposal
                </h3>

                <p class="rev_count">
                    <!--
                        Never hue alone (DESIGN.md): the count carries an icon
                        above it, a tinted panel, a border, and this text, which
                        is the only part a screen reader or a greyscale display
                        gets. `sr-only` rather than aria-label so the visible
                        numeral keeps its own reading order.
                    -->
                    <span class="rev_sr">{{ violations.proposed.hard > 0
                        ? 'Unresolved hard-rule issues:'
                        : 'Hard-rule issues:' }}</span>
                    {{ violations.proposed.hard }}
                </p>

                <p class="rev_panel-note">
                    unresolved hard-rule issue{{ violations.proposed.hard === 1 ? '' : 's' }},
                    reported by the solver across 14 constraint types
                </p>

                <ul
                    v-if="proposedTypes.length"
                    class="rev_types"
                >
                    <li
                        v-for="row in proposedTypes"
                        :key="row.type"
                    >
                        <span class="rev_types-count">{{ row.count }}</span>
                        {{ row.label }}
                    </li>
                </ul>

                <p
                    v-else
                    class="rev_types-none"
                >Every hard rule the solver checks is satisfied.</p>

                <!--
                    Reported, never netted out: these name Sessions the solver
                    invented, using a synthetic key that appears nowhere in the
                    placements, so they cannot be attached to any row.
                -->
                <p
                    v-if="violations.proposed.unmappable > 0"
                    class="rev_unmappable"
                >
                    {{ locatable }} of {{ violations.proposed.sessionReferences }} session references
                    can be located; {{ violations.proposed.unmappable }} name sessions the solver
                    created and cannot be pinned to a slot.
                </p>
            </article>

            <div class="rev_current">
                <p class="rev_current-line">
                    For comparison, Calendry's own {{ structuralRuleCount }} structural checks
                    currently find
                    <strong>{{ violations.current.hard }}</strong>
                    issue{{ violations.current.hard === 1 ? '' : 's' }} on the live schedule.
                    They re-run after applying.
                </p>

                <ul
                    v-if="currentTypes.length"
                    class="rev_types rev_types--inline"
                >
                    <li
                        v-for="row in currentTypes"
                        :key="row.type"
                    >
                        <span class="rev_types-count">{{ row.count }}</span>
                        {{ row.label }}
                    </li>
                </ul>
            </div>
        </div>

        <div class="rev_facts">
            <div class="rev_fact">
                <span class="rev_fact-label">Changes</span>
                <span class="rev_fact-value">
                    <strong>{{ plan.created }}</strong> added ·
                    <strong>{{ plan.moved }}</strong> moved ·
                    {{ plan.unchanged }} unchanged ·
                    <strong :class="{ 'rev_destructive': plan.deleted > 0 }">{{ plan.deleted }}</strong> removed
                </span>
            </div>

            <div
                v-if="plan.skippedLocked"
                class="rev_fact"
            >
                <span class="rev_fact-label">Locked</span>
                <span class="rev_fact-value">
                    {{ plan.skippedLocked }} session{{ plan.skippedLocked === 1 ? '' : 's' }}
                    left exactly as they are
                </span>
            </div>

            <div
                v-if="plan.placementsUnmapped"
                class="rev_fact"
            >
                <span class="rev_fact-label">Unplaceable</span>
                <!--
                    Was "N placement(s) cannot be stored", which is this
                    codebase's sentence rather than the reviewer's: what they
                    need to know is that the proposal wants sessions this
                    schedule has nowhere to put.
                -->
                <span class="rev_fact-value">
                    {{ plan.placementsUnmapped }}
                    session{{ plan.placementsUnmapped === 1 ? '' : 's' }} this proposal wants
                    cannot be recorded, and will not be created
                </span>
            </div>

            <div class="rev_fact">
                <span class="rev_fact-label">Run</span>
                <span class="rev_fact-value">
                    {{ terminationSentence(run?.terminationReason ?? null) }}
                    <template v-if="run?.elapsedMillis">
                        Took {{ (run.elapsedMillis / 1000).toFixed(1) }}s.
                    </template>
                </span>
            </div>

            <!--
                The objective is a RELATIVE score with no absolute scale — two
                proposals for the same term measured 430 and 33,955 — so it is
                said as a comparable quantity rather than a bare number, and
                pointed at the one place a comparison exists.
            -->
            <div
                v-if="run?.objective !== null && run?.objective !== undefined"
                class="rev_fact"
            >
                <span class="rev_fact-label">Score</span>
                <span class="rev_fact-value">
                    {{ run.objective.toLocaleString() }} — lower is better, and only
                    comparable with other proposals for the same term.
                    <NuxtLink
                        class="rev_link"
                        to="/schedule/proposals"
                    >Compare proposals</NuxtLink>
                </span>
            </div>
        </div>

        <!--
            A removal means the solver REFUSED to place that Session — the one
            destructive part of applying — so it gets named, not counted.
        -->
        <details
            v-if="deletedByOffering.length"
            class="rev_deleted"
            open
        >
            <summary>
                <Icon
                    name="material-symbols:delete-outline"
                    aria-hidden="true"
                />
                {{ plan.deleted }} session{{ plan.deleted === 1 ? '' : 's' }} will be removed
            </summary>
            <ul>
                <li
                    v-for="row in deletedByOffering"
                    :key="row.offeringId"
                >
                    <strong>{{ row.count }}</strong> from
                    {{ row.code ? `${row.code} · ${row.title}` : row.title }}
                </li>
            </ul>
            <p class="rev_panel-note">
                The solver could not place these. Applying deletes them rather than
                leaving them where the solver rejected them.
            </p>
        </details>
    </section>
</template>

<script setup lang="ts">
import { STRUCTURAL_CONSTRAINT_TYPES, constraintTypeLabel } from '#shared/constraintTypes';
import { terminationSentence } from '~/composables/generationReview';
import type { ReviewPreview } from '~/composables/generationReview';

const props = defineProps<{
    plan: NonNullable<ReviewPreview['plan']>;
    violations: ReviewPreview['violations'];
    deletedByOffering: ReviewPreview['deletedByOffering'];
    run: ReviewPreview['run'];
}>();

/**
 * Derived, not written out. This label read "3 structural rules" for the whole
 * of Stage 7 after `no_double_booking_person` made it four — a user-facing
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

const currentTypes = computed(() => toRows(props.violations.current.byType));
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

    &_heading {
        font-size: var(--font-size-lg);
        color: $content2;
    }

    /**
     * Screen-reader-only, and NOT display:none — the numeral needs a spoken
     * label because its meaning lives in the panel around it, which a linear
     * reading order does not deliver.
     */
    &_sr {
        position: absolute;

        overflow: hidden;

        width: 1px;
        height: 1px;

        white-space: nowrap;

        clip-path: inset(50%);
    }

    // Leads the two readings rather than trailing them, at reading weight
    // rather than as a footnote: it is the instruction for how to read both.
    &_incomparable {
        font-size: var(--font-size-md);
        color: $content6;
    }

    &_state {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
    }

    &_panel {
        padding: var(--space-6);
        border-left: var(--space-1) solid $surface5;
        border-radius: var(--radius-lg);
        background: $surface1;

        // Warn-and-allow, made visible. A residual hard violation is the whole
        // reason this screen can be applied at all, and it used to render in the
        // same near-black as a clean result.
        &--flagged {
            border-left-color: $error600;
            background: varToRgba('error600', 0.08);
        }
    }

    &_panel-title {
        display: flex;
        gap: var(--space-3);
        align-items: center;

        font-size: var(--font-size-xs);
        font-weight: 600;
        color: $content6;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_panel-icon {
        width: 15px;
        height: 15px;
        color: $error600;
    }

    &_count {
        font-size: var(--font-size-2xl);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: $content1;

        .rev_panel--flagged & { color: $error700; }
    }

    &_panel-note {
        font-size: var(--font-size-sm);
        color: $content6;
    }

    &_types {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        margin-top: var(--space-4);

        font-size: var(--font-size-sm);
        color: $content2;
        list-style: none;

        &--inline {
            flex-direction: row;
            flex-wrap: wrap;
            gap: var(--space-2) var(--space-5);
            margin-top: var(--space-3);
        }

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

    &_types-none {
        margin-top: var(--space-4);
        font-size: var(--font-size-sm);
        color: $content6;
    }

    &_unmappable {
        margin-top: var(--space-4);
        padding-top: var(--space-4);
        border-top: 1px solid $surface5;

        font-size: var(--font-size-sm);
        color: $content6;
    }

    // Deliberately not a card: a second panel is a second numeral, and a second
    // numeral is the delta this screen refuses to draw.
    &_current {
        padding-left: var(--space-6);
        border-left: 1px solid $surface5;
    }

    &_current-line {
        font-size: var(--font-size-md);
        font-variant-numeric: tabular-nums;
        color: $content6;

        strong { color: $content2; }
    }

    &_facts {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);

        padding: var(--space-6);
        border-radius: var(--radius-lg);

        background: $surface1;
    }

    &_fact {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: baseline;
    }

    &_fact-label {
        min-width: 104px;

        font-size: var(--font-size-xs);
        font-weight: 600;
        color: $content6;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_fact-value {
        font-size: var(--font-size-md);
        font-variant-numeric: tabular-nums;
        color: $content2;
    }

    &_link {
        color: $primary700;
        text-decoration: underline;
        text-underline-offset: 2px;
    }

    // A removal is the one destructive part of applying, so it is the one count
    // that carries state colour in the otherwise neutral facts row.
    &_destructive {
        color: $error700;
    }

    &_deleted {
        padding: var(--space-6);
        border-left: var(--space-1) solid $error600;
        border-radius: var(--radius-lg);
        background: varToRgba('error600', 0.08);

        summary {
            cursor: pointer;

            display: flex;
            gap: var(--space-3);
            align-items: center;

            font-size: var(--font-size-md);
            font-weight: 600;
            font-variant-numeric: tabular-nums;
            color: $content1;

            svg {
                width: 16px;
                height: 16px;
                color: $error700;
            }
        }

        ul {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);

            margin: var(--space-4) 0;

            font-size: var(--font-size-sm);
            font-variant-numeric: tabular-nums;
            color: $content2;
            list-style: none;
        }
    }

    // Wide enough for two columns, the panel and its footing sit side by side —
    // still not symmetrical, because they are not peers.
    @include pc() {
        &_state {
            display: grid;
            grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
            align-items: start;
        }
    }
}
</style>
