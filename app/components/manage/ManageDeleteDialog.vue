<template>
    <Teleport to="body">
        <div
            v-if="open"
            class="confirm"
            @mousedown.self="$emit('cancel')"
        >
            <div
                class="confirm_box"
                role="alertdialog"
                aria-modal="true"
                :aria-label="t('manageUi.deleteDialog.aria', { subject })"
            >
                <h2>{{ t('manageUi.deleteDialog.heading', { entity: entityLabel }) }}</h2>

                <!--
                    `<i18n-t>` so the row's own title stays a `<strong>` inside
                    one translatable sentence: German puts the verb elsewhere,
                    and a subject glued to two text nodes cannot be reordered.
                -->
                <i18n-t
                    keypath="manageUi.deleteDialog.body"
                    scope="global"
                    tag="p"
                >
                    <template #subject>
                        <strong>{{ subject }}</strong>
                    </template>
                </i18n-t>

                <p class="confirm_note">
                    {{ t('manageUi.deleteDialog.note') }}
                </p>

                <p
                    v-if="error"
                    class="confirm_error"
                    role="alert"
                >{{ error }}</p>

                <div class="confirm_actions">
                    <CommonButton
                        ref="cancelRef"
                        type="secondary"
                        :disabled="busy"
                        @click="$emit('cancel')"
                    >{{ t('common.action.cancel') }}</CommonButton>
                    <CommonButton
                        type="destructive"
                        :disabled="busy"
                        @click="$emit('confirm')"
                    >{{ busy ? t('common.action.deleting') : t('common.action.delete') }}</CommonButton>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { useT } from '~/composables/i18n';
import { useOverlay } from '~/composables/overlay';

/**
 * Confirmation for an irreversible delete.
 *
 * It claims the keyboard through `useOverlay` for the same reason the command
 * palette does: Escape here must cancel the dialog and nothing else. That the
 * mechanism is shared is the point: a second overlay that invented its own
 * Escape handling is how the schedule's placement mode starts getting cancelled
 * by unrelated dialogs again.
 */
const props = defineProps<{
    open: boolean;
    /** The row's human title, so the dialog names what it is about to destroy. */
    subject: string;
    entityLabel: string;
    busy?: boolean;
    error?: string;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();

const { t } = useT();

const { claim, release } = useOverlay('manage-delete');

watch(() => props.open, (isOpen) => {
    if (isOpen) claim();
    else release();
}, { immediate: true });

function onKey(event: KeyboardEvent) {
    if (props.open && event.key === 'Escape') {
        event.preventDefault();
        emit('cancel');
    }
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped lang="scss">
.confirm {
    position: fixed;
    z-index: 210;
    inset: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    padding: var(--space-6);

    // `black`, not the theme-relative `content0`; see `ScheduleFilterPanel`'s
    // own comment on this exact backdrop rule for why: `content0` flips to
    // near-white in dark mode, turning a dimming scrim into a light wash.
    background: varToRgba('black', 0.45);

    &_box {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);

        width: 100%;
        max-width: 420px;
        padding: var(--space-7);
        border-radius: var(--radius-xl);

        background: $surface1;
        box-shadow: 0 24px 60px varToRgba('black', 0.28);

        h2 {
            margin: 0;
            font-size: var(--font-size-lg);
            font-weight: 680;
            color: $content1;
        }

        p {
            margin: 0;
            font-size: var(--font-size-md);
            line-height: 1.5;
            color: $content5;
        }
    }

    &_note {
        font-size: var(--font-size-sm) !important;
        color: $content7 !important;
    }

    &_error {
        padding: var(--space-4) var(--space-5);
        border-radius: var(--radius-lg);

        font-size: var(--font-size-sm) !important;
        color: $error700 !important;

        background: varToRgba('error500', 0.14);
    }

    &_actions {
        display: flex;
        gap: var(--space-4);
        justify-content: flex-end;
        margin-top: var(--space-3);
    }
}
</style>
