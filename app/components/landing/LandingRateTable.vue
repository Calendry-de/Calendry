<template>
    <div class="rate">
        <h3 class="rate_title">{{ table.title }}</h3>
        <p class="rate_note">{{ table.note }}</p>

        <div class="rate_scroll">
            <table class="rate_table">
                <thead>
                    <tr>
                        <th scope="col">Tier</th>
                        <th scope="col">{{ table.basisLabel }}</th>
                        <th
                            scope="col"
                            class="rate_numeric"
                        >{{ table.priceLabel }}</th>
                        <th
                            v-if="table.extraLabel"
                            scope="col"
                            class="rate_numeric"
                        >{{ table.extraLabel }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="row in table.rows"
                        :key="row.id"
                    >
                        <th
                            scope="row"
                            class="rate_tier"
                        >{{ row.tier }}</th>
                        <td class="rate_basis">{{ row.basis }}</td>
                        <td class="rate_numeric rate_price">{{ row.price }}</td>
                        <td
                            v-if="table.extraLabel"
                            class="rate_numeric rate_extra"
                        >{{ row.extra ?? '' }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { RateTable } from '~/utils/pricingContent';

/**
 * One rate table.
 *
 * A REAL `<table>`, and this is the one place on these pages where that is the
 * right answer rather than the lazy one. The landing page's rule is that a long
 * list of title-and-body rows should become something else, because those rows
 * are prose pretending to be data. A rate card is the opposite: four bands
 * against three columns, which a reader scans across and down and compares. That
 * is a table, and building it out of `<div>`s would only cost the row and column
 * headers a screen reader needs to announce a cell in context.
 *
 * Hence `<th scope="col">` and `<th scope="row">`: with both, a cell is read as
 * "L, per year, twenty thousand euro" rather than as a bare number.
 *
 * TABULAR NUMERALS on every figure column, which is the same rule every clock
 * time in the schedule follows. Without it the euro amounts shiver out of
 * alignment down the column and stop being comparable at a glance, which is the
 * only reason to put them in a column.
 *
 * It scrolls inside its own container below the desktop band rather than
 * shrinking: a rate card that has wrapped every cell to three lines is no longer
 * scannable, and horizontal scroll on a table is a pattern people know.
 */
defineProps<{
    table: RateTable;
}>();
</script>

<style scoped lang="scss">
.rate {
    @include landingReveal(12px);

    &_title {
        margin: 0 0 $space3;

        font-size: $fontSizeLg;
        font-weight: 700;
        line-height: 1.35;
        color: $content2;
    }

    &_note {
        max-width: 68ch;
        margin: 0 0 $space6;

        font-size: $fontSizeMd;
        line-height: 1.75;
        color: $content6;
    }

    // The card scrolls rather than crushes. The overflow lives on a wrapper
    // rather than on the table itself: `display: block` on a `<table>` makes it
    // shrink to its content, so `width: 100%` is ignored and the columns hug the
    // left of a wide section instead of filling it.
    &_scroll {
        overflow-x: auto;
    }

    &_table {
        border-collapse: collapse;
        width: 100%;

        th,
        td {
            padding: $space5 $space6 $space5 0;
            text-align: left;
            vertical-align: top;
        }

        thead th {
            border-bottom: 1px solid $surface5;

            font-size: $fontSizeXs;
            font-weight: 700;
            color: $content7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            white-space: nowrap;
        }

        // One hairline between rows, never one above AND below: the doubled rule
        // is what makes a long table read as a fence.
        tbody tr + tr th,
        tbody tr + tr td {
            border-top: 1px solid $surface5;
        }
    }

    &_tier {
        font-size: $fontSizeMd;
        font-weight: 700;
        color: $content2;
        white-space: nowrap;
    }

    &_basis {
        min-width: 22ch;
        font-size: $fontSizeMd;
        line-height: 1.6;
        color: $content6;
    }

    &_numeric {
        font-variant-numeric: tabular-nums;
        // Right-aligned and tabular, so the column can be compared by eye.
        text-align: right !important;
        white-space: nowrap;
    }

    &_price {
        font-size: $fontSizeMd;
        font-weight: 700;
        color: $content2;
    }

    &_extra {
        font-size: $fontSizeMd;
        color: $content6;
    }
}
</style>
