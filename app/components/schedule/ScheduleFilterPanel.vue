<template>
    <Teleport to="body">
        <!--
            `v-show`, NOT `v-if`, and both halves of that matter.

            THE ACCESSIBILITY HALF: the toolbar's toggle carries
            `aria-controls="schedule-filters-panel"` alongside its
            `aria-expanded`. Under `v-if` that id referred to nothing at all
            until the panel was first opened, so a collapsed disclosure
            announced that it controlled a region that did not exist. A
            disclosure's controlled region has to BE there, hidden; that is
            what `aria-expanded="false"` means.

            THE HONESTY HALF: the filters' gating rule ("a filter exists when
            it has more than one option, never because of a permission") is
            only observable if the options are in the rendered document.
            Under `v-if` the panel's markup was absent from server-rendered
            HTML for EVERY caller, which made "this page does not offer a room
            filter" true of a page that offers nothing to anybody: exactly the
            "no data and broken render look identical" failure this codebase
            keeps re-learning. `tests/schedule-scope.test.ts` reads those
            options out of the SSR'd page and pairs every absence with the
            admin's copy; that pairing only means something while the markup
            is really there.

            Cost is one hidden select group per schedule render; the fields
            themselves are still gated by `showGroupFilter` and friends, so a
            caller with nothing to narrow still ships nothing to narrow it
            with.
        -->
        <div
            v-show="open"
            class="fpanel"
            @click.self="close"
        >
            <div
                id="schedule-filters-panel"
                ref="panelRef"
                class="fpanel_sheet"
                role="dialog"
                aria-modal="true"
                :aria-label="t('schedule.filters.dialogLabel')"
                @keydown.esc.prevent="close"
                @keydown.tab="trapFocus"
            >
                <header class="fpanel_head">
                    <span class="fpanel_title">{{ t('schedule.filters.title') }}</span>
                    <button
                        ref="closeRef"
                        class="fpanel_close"
                        type="button"
                        :aria-label="t('schedule.filters.close')"
                        @click="close"
                    >
                        <Icon
                            name="material-symbols:close"
                            aria-hidden="true"
                        />
                    </button>
                </header>

                <ScheduleMiniMonth
                    v-if="term"
                    :term="term"
                    :week="weekModel"
                    :total-weeks="totalWeeks"
                    @select-week="weekModel = $event"
                />

                <div class="fpanel_fields">
                    <label
                        v-if="showGroupFilter"
                        class="fpanel_field"
                    >
                        <span>{{ t('schedule.filters.group') }}</span>
                        <select
                            v-model="groupIdModel"
                            class="fpanel_select"
                            :title="selectedName(groups, groupIdModel, t('schedule.filters.allGroups'))"
                        >
                            <option
                                value=""
                                :selected="!groupIdModel"
                            >{{ t('schedule.filters.allGroups') }}</option>
                            <option
                                v-for="group in groups"
                                :key="group.id"
                                :value="group.id"
                                :selected="group.id === groupIdModel"
                            >{{ group.name }}</option>
                        </select>
                    </label>

                    <label
                        v-if="groupIdModel"
                        class="fpanel_check"
                    >
                        <input
                            v-model="includeNestedModel"
                            type="checkbox"
                        >
                        <span>{{ t('schedule.filters.includeNested') }}</span>
                    </label>

                    <label
                        v-if="showRoomFilter"
                        class="fpanel_field"
                    >
                        <span>{{ t('schedule.filters.room') }}</span>
                        <select
                            v-model="roomIdModel"
                            class="fpanel_select"
                            :title="selectedName(rooms, roomIdModel, t('schedule.filters.allRooms'))"
                        >
                            <option
                                value=""
                                :selected="!roomIdModel"
                            >{{ t('schedule.filters.allRooms') }}</option>
                            <option
                                v-for="room in rooms"
                                :key="room.id"
                                :value="room.id"
                                :selected="room.id === roomIdModel"
                            >{{ room.name }}</option>
                        </select>
                    </label>

                    <label
                        v-if="showPersonFilter"
                        class="fpanel_field"
                    >
                        <span>{{ t('schedule.filters.person') }}</span>
                        <select
                            v-model="personIdModel"
                            class="fpanel_select"
                            :title="selectedName(people, personIdModel, t('schedule.filters.anyone'))"
                        >
                            <option
                                value=""
                                :selected="!personIdModel"
                            >{{ t('schedule.filters.anyone') }}</option>
                            <option
                                v-for="person in people"
                                :key="person.id"
                                :value="person.id"
                                :selected="person.id === personIdModel"
                            >{{ person.name }}</option>
                        </select>
                    </label>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import type { NamedRow, Term } from '~/composables/schedule';
import { useOverlay } from '~/composables/overlay';
import { useT } from '~/composables/i18n';
import ScheduleMiniMonth from './ScheduleMiniMonth.vue';

/**
 * Group/Room/Person: actual narrowing filters, moved here verbatim from
 * `ScheduleToolbar` (same gating rule: "a filter exists when it has
 * something to choose between", same models), just laid out vertically in a
 * panel instead of a horizontal row. A toggleable overlay rather than a
 * permanent sidebar column: see the comment on `.schedule_side` in
 * `schedule/index.vue` for why a fixed reservation was removed once already
 * and should not come back here.
 *
 * TERM DELIBERATELY LIVES IN `ScheduleToolbar` INSTEAD, not here: it is not
 * a filter (it does not narrow what the caller can already see; it decides
 * WHICH schedule is being looked at), so burying it behind this panel's
 * toggle made the single most-used control on the page a two-click action.
 * `term`/`totalWeeks` stay as props: `ScheduleMiniMonth` still needs the
 * ACTIVE Term's own dates to draw its grid, which is a different fact from
 * "every Term the caller could switch to" (the `terms` array, now owned by
 * the toolbar alone).
 */
const props = defineProps<{
    groups: NamedRow[];
    rooms: NamedRow[];
    people: NamedRow[];
    term: Term | null;
    totalWeeks: number;
}>();

const { t } = useT();

const open = defineModel<boolean>('open', { required: true });
const groupIdModel = defineModel<string>('groupId', { required: true });
const roomIdModel = defineModel<string>('roomId', { required: true });
const personIdModel = defineModel<string>('personId', { required: true });
const includeNestedModel = defineModel<boolean>('includeNested', { required: true });
const weekModel = defineModel<number>('week', { required: true });

const showGroupFilter = computed(() => props.groups.length > 1 || Boolean(groupIdModel.value));
const showRoomFilter = computed(() => props.rooms.length > 1 || Boolean(roomIdModel.value));
const showPersonFilter = computed(() => props.people.length > 1 || Boolean(personIdModel.value));

function selectedName(rows: readonly { id: string; name: string }[], id: string, fallback: string): string {
    return rows.find((row) => row.id === id)?.name ?? fallback;
}

const { claim, release } = useOverlay('schedule-filters');

const panelRef = ref<HTMLElement | null>(null);
const closeRef = ref<HTMLElement | null>(null);
let opener: HTMLElement | null = null;

function close() {
    open.value = false;
}

watch(open, async (isOpen) => {
    if (isOpen) {
        opener = document.activeElement as HTMLElement | null;
        claim();
        document.body.style.overflow = 'hidden';

        await nextTick();
        closeRef.value?.focus();

        return;
    }

    release();
    document.body.style.overflow = '';
    opener?.focus();
    opener = null;
});

onBeforeUnmount(() => {
    document.body.style.overflow = '';
});

function trapFocus(event: KeyboardEvent) {
    const panel = panelRef.value;

    if (!panel) return;

    const focusable = [...panel.querySelectorAll<HTMLElement>('a[href], button, select, input')]
        .filter((el) => !el.hasAttribute('disabled'));

    if (focusable.length === 0) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
    }
}
</script>

<style scoped lang="scss">
.fpanel {
    position: fixed;
    z-index: 210;
    inset: 0;

    display: flex;
    justify-content: flex-start;

    // `black`, NOT `content0`: `content0` is a THEME-RELATIVE text colour,
    // dark mode swaps it to near-white (`app/utils/styles.ts`), so a scrim
    // built from it turned into a light wash instead of a dimming backdrop
    // exactly when the surrounding UI was already dark. A backdrop must dim
    // regardless of theme, which is what the theme-INVARIANT `black`/
    // `blackAlpha*` family is for.
    background: varToRgba('black', 0.45);

    &_sheet {
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-6);

        width: 100%;
        max-width: 340px;
        padding: var(--space-6);
        padding-bottom: max(var(--space-6), env(safe-area-inset-bottom));

        background: $surface1;
        box-shadow: 24px 0 60px varToRgba('black', 0.28);
    }

    &_head {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    &_title {
        font-size: var(--font-size-xs);
        font-weight: 700;
        color: $content7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    &_close {
        cursor: pointer;

        display: flex;
        align-items: center;
        justify-content: center;

        width: 44px;
        height: 44px;
        border: 1px solid $surface4;
        border-radius: var(--radius-lg);

        color: $content4;

        background: $surface0;

        .iconify {
            width: 20px;
            height: 20px;
        }
    }

    &_fields {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
    }

    &_field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        > span {
            font-size: var(--font-size-xs);
            font-weight: 600;
            color: $content7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
    }

    &_select {
        cursor: pointer;

        width: 100%;
        padding: var(--space-3) var(--space-4);
        border: 1px solid $surface5;
        border-radius: var(--radius-md);

        font-family: inherit;
        font-size: var(--font-size-md);
        color: $content5;

        background: $surface0;

        &:focus-visible {
            outline: 2px solid $primary600;
            outline-offset: 1px;
        }
    }

    &_check {
        display: flex;
        gap: var(--space-3);
        align-items: center;

        font-size: var(--font-size-sm);
        color: $content6;

        input { accent-color: $primary500; }
    }
}
</style>
