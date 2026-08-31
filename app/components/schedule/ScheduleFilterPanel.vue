<template>
    <Teleport to="body">
        <div
            v-if="open"
            class="fpanel"
            @click.self="close"
        >
            <div
                id="schedule-filters-panel"
                ref="panelRef"
                class="fpanel_sheet"
                role="dialog"
                aria-modal="true"
                aria-label="Filters"
                @keydown.esc.prevent="close"
                @keydown.tab="trapFocus"
            >
                <header class="fpanel_head">
                    <span class="fpanel_title">Filters</span>
                    <button
                        ref="closeRef"
                        class="fpanel_close"
                        type="button"
                        aria-label="Close filters"
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
                    <label class="fpanel_field">
                        <span>Term</span>
                        <select
                            v-model="termIdModel"
                            class="fpanel_select"
                            :title="selectedName(terms, termIdModel || (terms[0]?.id ?? ''), '')"
                        >
                            <option
                                v-for="t in terms"
                                :key="t.id"
                                :value="t.id"
                                :selected="t.id === (termIdModel || terms[0]?.id)"
                            >{{ t.name }}</option>
                        </select>
                    </label>

                    <label
                        v-if="showGroupFilter"
                        class="fpanel_field"
                    >
                        <span>Group</span>
                        <select
                            v-model="groupIdModel"
                            class="fpanel_select"
                            :title="selectedName(groups, groupIdModel, 'All groups')"
                        >
                            <option value="">All groups</option>
                            <option
                                v-for="group in groups"
                                :key="group.id"
                                :value="group.id"
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
                        <span>Include nested</span>
                    </label>

                    <label
                        v-if="showRoomFilter"
                        class="fpanel_field"
                    >
                        <span>Room</span>
                        <select
                            v-model="roomIdModel"
                            class="fpanel_select"
                            :title="selectedName(rooms, roomIdModel, 'All rooms')"
                        >
                            <option value="">All rooms</option>
                            <option
                                v-for="room in rooms"
                                :key="room.id"
                                :value="room.id"
                            >{{ room.name }}</option>
                        </select>
                    </label>

                    <label
                        v-if="showPersonFilter"
                        class="fpanel_field"
                    >
                        <span>Person</span>
                        <select
                            v-model="personIdModel"
                            class="fpanel_select"
                            :title="selectedName(people, personIdModel, 'Anyone')"
                        >
                            <option value="">Anyone</option>
                            <option
                                v-for="person in people"
                                :key="person.id"
                                :value="person.id"
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
import ScheduleMiniMonth from './ScheduleMiniMonth.vue';

/**
 * Term/Group/Room/Person, moved here verbatim from `ScheduleToolbar` — same
 * gating rule ("a filter exists when it has something to choose between"),
 * same models, just laid out vertically in a panel instead of a horizontal
 * row. A toggleable overlay rather than a permanent sidebar column: see the
 * comment on `.schedule_side` in `schedule/index.vue` for why a fixed
 * reservation was removed once already and should not come back here.
 */
const props = defineProps<{
    terms: Term[];
    groups: NamedRow[];
    rooms: NamedRow[];
    people: NamedRow[];
    term: Term | null;
    totalWeeks: number;
}>();

const open = defineModel<boolean>('open', { required: true });
const termIdModel = defineModel<string>('termId', { required: true });
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

    background: varToRgba('content0', 0.45);

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
        box-shadow: 24px 0 60px varToRgba('content0', 0.28);
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
