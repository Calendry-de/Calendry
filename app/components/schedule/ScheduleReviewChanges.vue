<template>
    <div class="rchg">
        <!--
            THE EMPTY CASE, which had no rendering at all and left the section as
            a heading, a view switch, and roughly six hundred pixels of nothing
            above one grey sentence. A no-op proposal is not an edge case here —
            it is what a re-run of an already-solved term produces — so this is
            the state the page shows most often.
        -->
        <p
            v-if="!rows.length"
            class="rchg_none"
        >
            <Icon
                name="material-symbols:check-circle-outline"
                aria-hidden="true"
            />
            <span>
                This proposal changes nothing. Every offering in the term is
                reproduced exactly where it already sits.
            </span>
        </p>

        <!--
            One row per Offering something happens to, destructive first.

            NOT A TABLE, though it is tabular. A `<table>` would be right if the
            columns were the point, but the row is: each one is a complete
            sentence about one Offering, and the counts are its evidence. An
            ordered list of rows keeps the row as the unit a screen reader
            announces, and lets the whole row carry the drill-in action.
        -->
        <ol
            v-if="rows.length"
            class="rchg_list"
        >
            <li
                v-for="row in rows"
                :key="row.offeringId"
                class="rchg_row"
                :class="{ 'rchg_row--destructive': row.deleted > 0 }"
            >
                <div class="rchg_head">
                    <h3 class="rchg_title">
                        <span
                            v-if="row.code"
                            class="rchg_code"
                        >{{ row.code }}</span>
                        <!--
                            An Offering the caller cannot read has no name here
                            rather than a 36-character UUID. A truncated id is
                            not "visibly wrong", it is unreadable.
                        -->
                        <span>{{ row.title ?? 'An offering you cannot view' }}</span>
                    </h3>

                    <!--
                        THE COLLATERAL MARK. The plan reports `movedCollateral`
                        as one term-level integer — the sharpest warning on the
                        old screen, and the only one with nothing to click.
                        Scope is per-Offering, so this is where it becomes a
                        fact about something nameable.
                    -->
                    <span
                        v-if="row.outOfScope"
                        class="rchg_flag"
                    >
                        <Icon
                            name="material-symbols:info-outline"
                            aria-hidden="true"
                        />
                        not in what you asked for
                    </span>
                </div>

                <p class="rchg_counts">
                    <span
                        v-for="part in countsFor(row)"
                        :key="part.label"
                        class="rchg_count"
                        :class="`rchg_count--${part.kind}`"
                    >
                        <strong>{{ part.value }}</strong> {{ part.label }}
                    </span>
                </p>

                <div class="rchg_foot">
                    <span class="rchg_weeks">{{ weekLabel(row.weeks) }}</span>

                    <button
                        type="button"
                        class="rchg_open"
                        @click="emit('show', row)"
                    >
                        Show in the grid
                        <Icon
                            name="material-symbols:arrow-forward"
                            aria-hidden="true"
                        />
                    </button>
                </div>
            </li>
        </ol>

        <!--
            The unchanged majority as ONE number.

            The old grid rendered every reproduced session as a chip whose most
            prominent word was "UNCHANGED" — 142 of them on a proposal that
            changed nothing, a wall of type carrying no information. What a
            reviewer needs from that set is its size.
        -->
        <p
            v-if="untouchedOfferings > 0 && rows.length"
            class="rchg_untouched"
        >
            {{ untouchedOfferings }}
            other offering{{ untouchedOfferings === 1 ? '' : 's' }}
            {{ untouchedOfferings === 1 ? 'is' : 'are' }} reproduced exactly as
            {{ untouchedOfferings === 1 ? 'it stands' : 'they stand' }}.
        </p>
    </div>
</template>

<script setup lang="ts">
import type { OfferingChange } from '~/composables/generationReview';

/**
 * The review page's primary evidence: what this proposal does, by Offering.
 *
 * WHY BY OFFERING AND NOT BY SLOT. The week grid answers "what is in week 4".
 * It cannot answer "what does this proposal do", because a proposal that moves
 * 187 of 260 Sessions spreads those moves across a nineteen-week term and the
 * grid shows one week — auditing it meant thirteen `<select>` interactions,
 * which is a search, not a review. Grouping by Offering matches the unit a
 * department head actually owns and the unit `scopeOfferingIds` is defined in.
 *
 * Aggregated on the SERVER (`preview.get.ts`), because `placements` arrives one
 * week at a time and no client ever holds the whole term.
 */
defineProps<{
    rows: OfferingChange[];
    untouchedOfferings: number;
}>();

const emit = defineEmits<{ show: [OfferingChange] }>();

/**
 * Only the counts that are non-zero, in a fixed order.
 *
 * Rendering `0 added · 0 moved · 142 unchanged · 0 removed` is how the old
 * facts row read on a no-op proposal: four numbers, three of them zero, and the
 * reader has to subtract to learn nothing happened. A row states what happened
 * and stays quiet about what did not.
 */
function countsFor(row: OfferingChange) {
    const parts: { kind: string; value: number; label: string }[] = [];

    if (row.deleted > 0) {
        parts.push({ kind: 'deleted', value: row.deleted, label: 'removed' });
    }

    if (row.created > 0) {
        parts.push({ kind: 'created', value: row.created, label: 'added' });
    }

    if (row.moved > 0) {
        parts.push({ kind: 'moved', value: row.moved, label: 'moved' });
    }

    // Unchanged rides along only when the Offering ALSO changed — it is the
    // denominator that makes "3 moved" readable ("3 moved, 9 left alone").
    if (row.unchanged > 0) {
        parts.push({ kind: 'unchanged', value: row.unchanged, label: 'left alone' });
    }

    return parts;
}

/**
 * "week 4" / "weeks 4 and 6" / "weeks 4–9" / "9 weeks, from 2".
 *
 * A run of consecutive weeks is stated as a range because that is what it is;
 * a scatter is stated as a count plus its start, because listing eleven week
 * numbers is not something anybody reads.
 */
function weekLabel(weeks: number[]): string {
    if (!weeks.length) {
        return '';
    }

    const first = weeks[0]!;

    if (weeks.length === 1) {
        return `week ${first}`;
    }

    const last = weeks[weeks.length - 1]!;
    const consecutive = last - first + 1 === weeks.length;

    if (consecutive) {
        return `weeks ${first}–${last}`;
    }

    if (weeks.length === 2) {
        return `weeks ${first} and ${last}`;
    }

    return `${weeks.length} weeks, from ${first}`;
}
</script>

<style scoped lang="scss">
.rchg {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);

    &_list {
        display: flex;
        flex-direction: column;

        /*
         * HAIRLINES, NOT CARDS. Panels on this page were `background: $surface1`
         * against a `$surface1` body — the same value in both themes, so every
         * card rendered at zero contrast and the page read as loose text with
         * one stray rule. Rows separated by a single hairline need no fill to
         * be structure, which is the honest fix at page scope; retiring
         * `$surface1`-on-`$surface1` across the app is a token change and its
         * own piece of work.
         */
        gap: 0;

        /*
         * The UA's `padding-inline-start: 40px` survived, so the change list —
         * the evidence this whole redesign is built around — was the one block on
         * the page not sharing its left edge. Its own sibling `<p>` sat at 32px
         * while the rows started at 72px.
         */
        margin: 0;
        padding: 0;

        list-style: none;
    }

    &_row {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);

        padding: var(--space-6) 0;
        border-bottom: 1px solid $surface5;

        &:first-child { border-top: 1px solid $surface5; }

        // The one destructive state, carried on the gutter the diff vocabulary
        // already owns everywhere else on this surface.
        &--destructive {
            padding-left: var(--space-6);
            border-left: var(--space-1) solid $error600;
        }
    }

    &_head {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3) var(--space-5);
        align-items: baseline;
        justify-content: space-between;
    }

    &_title {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: baseline;

        font-size: var(--font-size-md);
        font-weight: 600;
        color: $content1;
    }

    // The code is the handle a timetabler recognises before the title.
    &_code {
        font-variant-numeric: tabular-nums;
        color: $content6;
    }

    &_flag {
        display: inline-flex;
        gap: var(--space-3);
        align-items: center;

        font-size: var(--font-size-xs);
        color: $warning800;

        .iconify {
            flex: none;
            width: 14px;
            height: 14px;
        }
    }

    &_counts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3) var(--space-6);

        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content6;
    }

    &_count {
        strong {
            font-weight: 600;
            color: $content2;
        }

        /*
         * Colour is spent on the two states with consequences, exactly as the
         * grid's chips do it — a proposal typically moves almost everything, so
         * tinting moves would flood the list and leave removals nothing.
         */
        &--deleted strong { color: $error700; }
        &--created strong { color: $success700; }
    }

    &_foot {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4) var(--space-5);
        align-items: center;
        justify-content: space-between;
    }

    // `$content6`, not `$surface7`: the week label is each row's only locator
    // and measured 2.1:1 at 11px. The app-wide habit of `$surface7` as metadata
    // text (34 sites, sanctioned by DESIGN.md's token role) is its own change.
    &_weeks {
        font-size: var(--font-size-xs);
        font-variant-numeric: tabular-nums;
        color: $content6;
    }

    &_open {
        cursor: pointer;

        display: inline-flex;
        gap: var(--space-3);
        align-items: center;

        // 44px of target on a control that reads as inline text, the same
        // treatment the back link and Refresh use.
        min-height: 44px;
        margin: calc(var(--space-5) * -1) 0;
        padding: var(--space-5) 0;
        border: 0;

        font-family: inherit;
        font-size: var(--font-size-sm);
        color: $primary700;

        background: none;

        .iconify {
            flex: none;
            width: 14px;
            height: 14px;
        }

        @include hover() {
            &:hover {
                text-decoration: underline;
                text-underline-offset: 2px;
            }
        }
    }

    /*
     * A LINE, not a panel. Filling a box to hold one sentence rebuilt the
     * furniture this redesign removed from the violation card, and the state band
     * above already carries the page's one filled statement.
     */
    &_none {
        display: flex;
        gap: var(--space-4);
        align-items: center;

        max-width: var(--review-measure, 78ch);

        font-size: var(--font-size-md);
        line-height: var(--leading-prose);
        color: $content6;

        .iconify {
            flex: none;
            width: 18px;
            height: 18px;
            color: $success700;
        }
    }

    &_untouched {
        font-size: var(--font-size-sm);
        color: $content6;
    }
}
</style>
