<template>
    <StaffPanel
        :title="t('staff.audit.heading')"
        :lead="t('staff.audit.lead')"
    >
        <template #aside>
            <p
                class="audit_total"
                aria-live="polite"
            >{{ pending ? t('staff.audit.loading') : t('staff.audit.total', { count: total }, total) }}</p>
        </template>

        <!--
            FILTERS FIRST, in one row. Each is its own control bound to a
            query ref, so the URL carries the whole view: a staff member can
            paste "every denied cross-tenant attempt against tenant X" to a
            colleague. Changing any filter returns to the first page, since a
            page offset into a different result set means nothing.
        -->
        <form
            class="audit_filters"
            @submit.prevent="applySearch"
        >
            <label class="audit_field">
                <span class="audit_label">{{ t('staff.audit.filter.action') }}</span>
                <select
                    class="audit_control"
                    :value="filters.action"
                    @change="setFilter('action', ($event.target as HTMLSelectElement).value)"
                >
                    <option
                        :selected="!filters.action"
                        value=""
                    >{{ t('staff.audit.filter.anyAction') }}</option>
                    <option
                        v-for="action in actions"
                        :key="action"
                        :selected="action === filters.action"
                        :value="action"
                    >{{ action }}</option>
                </select>
            </label>

            <label class="audit_field">
                <span class="audit_label">{{ t('staff.audit.filter.outcome') }}</span>
                <select
                    class="audit_control"
                    :value="filters.outcome"
                    @change="setFilter('outcome', ($event.target as HTMLSelectElement).value)"
                >
                    <option
                        :selected="!filters.outcome"
                        value=""
                    >{{ t('staff.audit.filter.anyOutcome') }}</option>
                    <option
                        v-for="outcome in OUTCOMES"
                        :key="outcome"
                        :selected="outcome === filters.outcome"
                        :value="outcome"
                    >{{ t(`staff.audit.outcome.${outcome}`) }}</option>
                </select>
            </label>

            <label class="audit_field">
                <span class="audit_label">{{ t('staff.audit.filter.tenant') }}</span>
                <select
                    class="audit_control"
                    :value="filters.tenantId"
                    @change="setFilter('tenantId', ($event.target as HTMLSelectElement).value)"
                >
                    <option
                        :selected="!filters.tenantId"
                        value=""
                    >{{ t('staff.audit.filter.anyTenant') }}</option>
                    <option
                        v-for="tenant in tenants"
                        :key="tenant.id"
                        :selected="tenant.id === filters.tenantId"
                        :value="tenant.id"
                    >{{ tenant.slug }}</option>
                </select>
            </label>

            <label class="audit_field audit_field--grow">
                <span class="audit_label">{{ t('staff.audit.filter.search') }}</span>
                <div class="audit_search">
                    <input
                        v-model="searchDraft"
                        class="audit_control"
                        type="search"
                        :placeholder="t('staff.audit.filter.searchPlaceholder')"
                        autocomplete="off"
                    >
                    <CommonButton
                        native-type="submit"
                        size="S"
                        type="secondary"
                    >{{ t('staff.audit.filter.apply') }}</CommonButton>
                </div>
            </label>

            <CommonButton
                v-if="anyFilter"
                class="audit_clear"
                size="S"
                type="link"
                @click="clearFilters"
            >{{ t('staff.audit.filter.clear') }}</CommonButton>
        </form>

        <p
            v-if="loadError"
            class="audit_note audit_note--error"
            role="alert"
        >{{ t('staff.audit.loadError') }}</p>

        <!--
            "No rows" and "fetch failed" are DIFFERENT states, rendered
            differently: the empty message only appears on a successful,
            empty answer. CLAUDE.md's whole family of invisible-bug rules
            starts from those two looking the same.
        -->
        <p
            v-else-if="!pending && rows.length === 0"
            class="audit_empty"
        >{{ anyFilter ? t('staff.audit.emptyFiltered') : t('staff.audit.empty') }}</p>

        <div
            v-else
            class="audit_tablewrap"
        >
            <table class="audit_table">
                <thead>
                    <tr>
                        <th scope="col">{{ t('staff.audit.column.when') }}</th>
                        <th scope="col">{{ t('staff.audit.column.outcome') }}</th>
                        <th scope="col">{{ t('staff.audit.column.action') }}</th>
                        <th scope="col">{{ t('staff.audit.column.actor') }}</th>
                        <th scope="col">{{ t('staff.audit.column.target') }}</th>
                        <th scope="col">{{ t('staff.audit.column.tenant') }}</th>
                        <th scope="col"><span class="sr-only">{{ t('staff.audit.column.detail') }}</span></th>
                    </tr>
                </thead>
                <tbody>
                    <template
                        v-for="row in rows"
                        :key="row.id"
                    >
                        <tr :class="{ 'audit_row--open': openId === row.id }">
                            <td class="audit_when">
                                <time :datetime="row.createdAt">{{ formatWhen(row.createdAt) }}</time>
                            </td>
                            <td>
                                <!--
                                    Outcome is never colour alone: the word is
                                    the meaning, the tint and icon are the
                                    glance, matching how violations are drawn.
                                -->
                                <span
                                    class="audit_outcome"
                                    :class="`audit_outcome--${row.outcome.toLowerCase()}`"
                                >
                                    <Icon
                                        :name="OUTCOME_ICON[row.outcome]"
                                        aria-hidden="true"
                                    />
                                    {{ t(`staff.audit.outcome.${row.outcome}`) }}
                                </span>
                            </td>
                            <td class="audit_action"><code>{{ row.action }}</code></td>
                            <td class="audit_text">{{ row.actorLabel ?? t('staff.audit.noActor') }}</td>
                            <td class="audit_text">{{ row.target ?? '–' }}</td>
                            <td class="audit_text">
                                <template v-if="row.tenant">{{ row.tenant.slug }}</template>
                                <span
                                    v-else-if="row.tenantId"
                                    class="audit_erased"
                                    :title="row.tenantId"
                                >{{ t('staff.audit.erasedTenant') }}</span>
                                <template v-else>–</template>
                            </td>
                            <td class="audit_toggle">
                                <CommonButton
                                    v-if="hasDetail(row)"
                                    size="S"
                                    type="transparent"
                                    :aria-expanded="openId === row.id"
                                    :aria-label="t('staff.audit.detailToggle')"
                                    @click="openId = openId === row.id ? null : row.id"
                                >
                                    <Icon
                                        :name="openId === row.id ? 'material-symbols:expand-less' : 'material-symbols:expand-more'"
                                        aria-hidden="true"
                                    />
                                </CommonButton>
                            </td>
                        </tr>
                        <tr
                            v-if="openId === row.id"
                            class="audit_detail"
                        >
                            <td colspan="7">
                                <dl class="audit_dl">
                                    <template
                                        v-for="[key, value] in Object.entries(row.detail)"
                                        :key="key"
                                    >
                                        <dt>{{ key }}</dt>
                                        <dd><code>{{ renderValue(value) }}</code></dd>
                                    </template>
                                    <dt v-if="row.actorPersonId">{{ t('staff.audit.actorPersonId') }}</dt>
                                    <dd v-if="row.actorPersonId"><code>{{ row.actorPersonId }}</code></dd>
                                    <dt v-if="row.actorAccountId">{{ t('staff.audit.actorAccountId') }}</dt>
                                    <dd v-if="row.actorAccountId"><code>{{ row.actorAccountId }}</code></dd>
                                </dl>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div>

        <nav
            v-if="total > PAGE"
            class="audit_pager"
            :aria-label="t('staff.audit.pagerLabel')"
        >
            <CommonButton
                size="S"
                type="secondary"
                :disabled="offset === 0 || pending"
                @click="page(-1)"
            >{{ t('staff.audit.newer') }}</CommonButton>
            <span class="audit_pager-range">{{ t('staff.audit.range', { from: offset + 1, to: Math.min(offset + PAGE, total), total }) }}</span>
            <CommonButton
                size="S"
                type="secondary"
                :disabled="offset + PAGE >= total || pending"
                @click="page(1)"
            >{{ t('staff.audit.older') }}</CommonButton>
        </nav>
    </StaffPanel>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import StaffPanel from '~/components/staff/StaffPanel.vue';
import { useT } from '~/composables/i18n';
import { useViewerLocale } from '~/composables/locale';

/**
 * The audit log (issue #78), read for the first time. Staff-only and
 * cross-tenant, which is the one context in which "every row" is honest: a
 * staff session is never in a tenant, and the table itself carries no RLS
 * because a denied cross-tenant attempt is about more than one tenant.
 *
 * Owns exactly one boundary: `GET /api/staff/audit-log` and the URL query
 * that addresses a view of it. The tenant list for the filter comes from the
 * page, which already holds it.
 */
export interface AuditRow {
    id: string;
    action: string;
    outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
    actorPersonId: string | null;
    actorAccountId: string | null;
    actorLabel: string | null;
    target: string | null;
    tenantId: string | null;
    tenant: { slug: string; name: string } | null;
    detail: Record<string, unknown>;
    createdAt: string;
}

interface AuditPage { rows: AuditRow[]; total: number; actions: string[] }

defineProps<{
    tenants: { id: string; slug: string }[];
}>();

const { t } = useT();
const locale = useViewerLocale();
const route = useRoute();
const router = useRouter();
const request = useRequestFetch();

const PAGE = 50;
const OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED'] as const;
const OUTCOME_ICON: Record<AuditRow['outcome'], string> = {
    SUCCESS: 'material-symbols:check-circle-outline',
    FAILURE: 'material-symbols:error-outline',
    DENIED: 'material-symbols:block',
};

function param(key: string): string {
    const raw = route.query[key];

    return typeof raw === 'string' ? raw : '';
}

const filters = computed(() => ({
    action: param('a'),
    outcome: param('o'),
    tenantId: param('t'),
    q: param('q'),
}));

const offset = computed(() => {
    const parsed = Number.parseInt(param('offset'), 10);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
});

const anyFilter = computed(() => Object.values(filters.value).some(Boolean));

const asyncData = useAsyncData(
    'staff-audit-log',
    () => request<AuditPage>('/api/staff/audit-log', {
        query: {
            limit: PAGE,
            offset: offset.value,
            ...(filters.value.action ? { action: filters.value.action } : {}),
            ...(filters.value.outcome ? { outcome: filters.value.outcome } : {}),
            ...(filters.value.tenantId ? { tenantId: filters.value.tenantId } : {}),
            ...(filters.value.q ? { q: filters.value.q } : {}),
        },
    }),
    { watch: [filters, offset] },
);

const rows = computed(() => asyncData.data.value?.rows ?? []);
const total = computed(() => asyncData.data.value?.total ?? 0);
const actions = computed(() => asyncData.data.value?.actions ?? []);
const pending = computed(() => asyncData.pending.value);
const loadError = computed(() => Boolean(asyncData.error.value));

const openId = ref<string | null>(null);
const searchDraft = ref(filters.value.q);

watch(() => filters.value.q, (q) => {
    searchDraft.value = q;
});

/** Writes ONE filter into the URL and returns to the first page. */
function setFilter(key: 'action' | 'outcome' | 'tenantId' | 'q', value: string) {
    const short = { action: 'a', outcome: 'o', tenantId: 't', q: 'q' }[key];
    const next: Record<string, string> = {};

    for (const [k, v] of Object.entries(route.query)) {
        if (typeof v === 'string' && v !== '' && k !== short && k !== 'offset') {
            next[k] = v;
        }
    }

    if (value) {
        next[short] = value;
    }

    void router.replace({ query: next });
}

function applySearch() {
    setFilter('q', searchDraft.value.trim());
}

function clearFilters() {
    const tab = param('tab');

    void router.replace({ query: tab ? { tab } : {} });
}

function page(direction: 1 | -1) {
    const nextOffset = Math.max(0, offset.value + direction * PAGE);
    const next: Record<string, string> = {};

    for (const [k, v] of Object.entries(route.query)) {
        if (typeof v === 'string' && v !== '' && k !== 'offset') {
            next[k] = v;
        }
    }

    if (nextOffset > 0) {
        next.offset = String(nextOffset);
    }

    void router.replace({ query: next });
}

function hasDetail(row: AuditRow): boolean {
    return Object.keys(row.detail).length > 0 || row.actorPersonId !== null || row.actorAccountId !== null;
}

function renderValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Date AND time, in the viewer's locale, in the browser's zone: an audit
 * row is a real instant, not a tenant-local grid slot, so the viewer's own
 * clock is the honest frame (the same reasoning `formatDate` gives for
 * choosing UTC for date-only columns does not apply to an instant).
 */
function formatWhen(iso: string): string {
    return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}
</script>

<style scoped lang="scss">
.audit {
    &_total {
        margin: 0;

        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content7;
        white-space: nowrap;
    }

    &_filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4);
        align-items: flex-end;
    }

    &_field {
        display: flex;
        flex: 0 1 200px;
        flex-direction: column;
        gap: var(--space-2);

        min-width: 160px;

        &--grow { flex: 1 1 280px; }
    }

    &_label {
        font-size: var(--font-size-xs);
        font-weight: 650;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_control {
        width: 100%;
        min-height: 36px;
        padding: 0 var(--space-4);
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        font-family: inherit;
        font-size: var(--font-size-sm);
        color: $content3;

        background: $surface1;

        &:focus {
            border-color: $primary500;
            outline: none;
        }
    }

    &_search {
        display: flex;
        gap: var(--space-2);
    }

    &_clear {
        align-self: center;
        margin-bottom: var(--space-2);
    }

    &_note {
        margin: 0;
        font-size: var(--font-size-sm);

        &--error { color: $error700; }
    }

    &_empty {
        margin: 0;
        padding: var(--space-7) var(--space-5);
        border: 1px dashed $surface4;
        border-radius: var(--radius-xl);

        font-size: var(--font-size-sm);
        color: $content7;
        text-align: center;
    }

    &_tablewrap {
        overflow-x: auto;
        border: 1px solid $surface4;
        border-radius: var(--radius-xl);
    }

    &_table {
        border-collapse: collapse;
        width: 100%;
        min-width: 860px;
        font-size: var(--font-size-sm);

        th {
            padding: var(--space-3) var(--space-4);
            border-bottom: 1px solid $surface4;

            font-size: var(--font-size-xs);
            font-weight: 650;
            color: $content7;
            text-align: left;
            text-transform: uppercase;
            letter-spacing: 0.05em;

            background: $surface1;
        }

        td {
            padding: var(--space-3) var(--space-4);
            border-bottom: 1px solid $surface3;
            line-height: var(--leading-tight);
            vertical-align: top;
        }

        tbody tr:last-child td { border-bottom: none; }
        tbody tr:hover td { background: $surface2; }
    }

    &_row--open td { background: $surface2; }

    &_when {
        font-variant-numeric: tabular-nums;
        color: $content6;
        white-space: nowrap;
    }

    &_action code {
        font-size: var(--font-size-xs);
        color: $content3;
    }

    &_text {
        overflow: hidden;

        max-width: 240px;

        color: $content4;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    &_erased {
        font-style: italic;
        color: $content7;
    }

    &_outcome {
        display: inline-flex;
        gap: var(--space-2);
        align-items: center;

        padding: 0 var(--space-3);
        border-radius: var(--radius-sm);

        font-size: var(--font-size-xs);
        font-weight: 650;
        line-height: 22px;
        white-space: nowrap;

        svg {
            width: 14px;
            height: 14px;
        }
        // Tints as FILLS with dark text of the same family: the ramp's
        // mid steps fail as text and pass as backgrounds (Measured-Contrast).
        &--success {
            color: $success700;
            background: varToRgba('success500', 0.16);
        }

        &--failure {
            color: $warning800;
            background: varToRgba('warning500', 0.18);
        }

        &--denied {
            color: $error700;
            background: varToRgba('error500', 0.14);
        }
    }

    &_toggle {
        width: 40px;
        text-align: right;
    }

    &_detail td {
        background: $surface1;
    }

    &_dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--space-2) var(--space-5);
        margin: 0;

        dt {
            font-size: var(--font-size-xs);
            color: $content7;
        }

        dd {
            margin: 0;
            overflow-wrap: anywhere;

            code {
                font-size: var(--font-size-xs);
                color: $content3;
            }
        }
    }

    &_pager {
        display: flex;
        gap: var(--space-4);
        align-items: center;
        justify-content: flex-end;

        &-range {
            font-size: var(--font-size-sm);
            font-variant-numeric: tabular-nums;
            color: $content7;
        }
    }
}
</style>
