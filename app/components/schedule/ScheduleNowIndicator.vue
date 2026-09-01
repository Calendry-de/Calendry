<!--
    The live "now" line (issue #109) — Google Calendar/Outlook's horizontal
    bar across today's column, at the current time.

    A SEPARATE COMPONENT, not inlined into `ScheduleGrid.vue`: it owns its own
    ticking clock (`useTenantNow`) and a positioning calculation that is
    substantial enough on its own — splitting it is `ScheduleGrid.vue`'s own
    "past ~3 responsibilities" rule (CLAUDE.md), and it also means a grid
    render never re-runs just because a minute passed.

    NO NEW GEOMETRY. `perMinute` and the row list come straight from
    `useGridGeometry` in the parent — the same arithmetic `ScheduleSessionChip`
    is positioned with (CLAUDE.md, "Grid geometry": "the single definition of
    block boundaries"). This draws no line a Session's own placement could not
    already draw.
-->
<template>
    <div
        v-if="position"
        class="now-line"
        :style="{ gridRow: position.gridRow, gridColumn: position.gridColumn, marginTop: position.marginTop }"
        aria-hidden="true"
    >
        <span class="now-line_dot" />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { blockAtMinute, blockSpan } from '#shared/timeGrid';
import { isoWeekday, weekIndexOf } from '#shared/academicCalendar';
import type { TimeGrid } from '~/composables/schedule';
import type { GridRow } from '~/composables/gridGeometry';
import { useTenantNow } from '~/composables/tenantNow';

const props = defineProps<{
    grid: TimeGrid;
    /** The UNIVERSAL row list `useGridGeometry` already built for the grid's cells and chips. */
    rows: GridRow[];
    perMinute: number;
    /** Block index → the row's 1-based CSS grid line. */
    lineOf: (blockIndex: number) => number;
    /** The week currently on screen — the line only draws when this IS the week containing today. */
    termWeek: number;
    /** Null before a Term resolves; the line has no "today" to place without it. */
    termStart: string | null;
    tenantTimezone: string;
}>();

const nowLocal = useTenantNow(computed(() => props.tenantTimezone));

interface Position {
    gridRow: string;
    gridColumn: string;
    marginTop: string;
}

/**
 * Null whenever the line has nothing honest to draw: no term, a different
 * week on screen, today is not one of the grid's active days, or "now" falls
 * outside the grid's rendered hours (before the first block or after the
 * last) — never floating above or below the drawn range.
 */
const position = computed<Position | null>(() => {
    if (!props.termStart) {
        return null;
    }

    const today = nowLocal.value.date;
    const todayWeekIndex = weekIndexOf(new Date(props.termStart), today);

    // termWeek is 1-based (see `useScheduleFilters`); weekIndexOf is 0-based.
    if (todayWeekIndex + 1 !== props.termWeek) {
        return null;
    }

    const dayOfWeek = isoWeekday(today);
    const columnIndex = props.grid.activeDays.indexOf(dayOfWeek);

    if (columnIndex === -1) {
        return null;
    }

    const minutes = nowLocal.value.minutes;
    const firstBlockStart = blockSpan(props.grid, 0, dayOfWeek).start;

    if (minutes < firstBlockStart) {
        return null; // Before the grid opens for the day.
    }

    const blockIndex = blockAtMinute(props.grid, minutes, dayOfWeek);

    if (blockIndex >= props.grid.blocksPerDay) {
        return null; // Past the grid's last block.
    }

    const gridColumn = String(columnIndex + 2); // Column 1 is the time gutter.
    const span = blockSpan(props.grid, blockIndex, dayOfWeek);

    if (minutes < span.end) {
        // Inside the block's own teaching time — the exact case
        // `useGridGeometry`'s `bandWithin` positions a Session chip for, so
        // the offset is the same `(minute - blockStart) * perMinute`.
        const line = props.lineOf(blockIndex);

        return {
            gridRow: `${line} / ${line + 1}`,
            gridColumn,
            marginTop: `${Math.max(0, (minutes - span.start) * props.perMinute).toFixed(2)}px`,
        };
    }

    // Inside the (universal) gap after this block — the grid draws only the
    // UNIVERSAL breaks as rows (see `ScheduleGrid.vue`'s "own breaks" note),
    // so the line follows that same simplification rather than inventing a
    // day-specific gap row nothing else on this grid draws either.
    const gapRow = props.rows.find((row) => row.kind === 'gap' && row.index === blockIndex);

    if (!gapRow) {
        return null;
    }

    return {
        gridRow: `${gapRow.line} / ${gapRow.line + 1}`,
        gridColumn,
        marginTop: `${Math.max(0, (minutes - gapRow.from) * props.perMinute).toFixed(2)}px`,
    };
});
</script>

<style scoped lang="scss">
.now-line {
    pointer-events: none;

    position: relative;

    align-self: start;
    justify-self: stretch;

    height: 2px;

    background: $error600;

    &_dot {
        position: absolute;
        top: 50%;
        left: -4px;
        translate: 0 -50%;

        width: 8px;
        height: 8px;
        border-radius: 50%;

        background: $error600;
    }
}
</style>
