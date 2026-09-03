<template>
    <StaffPanel :title="t('staff.federations.heading')">
        <template #lead>
            <!--
                `<i18n-t>` rather than a key either side of the `<code>`:
                German reorders clauses, so a sentence split at the CLI name
                is one no translator can fix without editing this template.
            -->
            <i18n-t
                class="feds_lead"
                keypath="staff.federations.cliNote"
                tag="p"
                scope="global"
            >
                <template #cli>
                    <code>provision:federation</code>
                </template>
            </i18n-t>
        </template>

        <template #aside>
            <p class="feds_count">{{ t('staff.federations.count', { count: federations.length }, federations.length) }}</p>
        </template>

        <p
            v-if="listError"
            class="feds_note feds_note--error"
            role="alert"
        >{{ listError }}</p>

        <p
            v-else-if="federations.length === 0"
            class="feds_empty"
        >{{ t('staff.federations.empty') }}</p>

        <ul
            v-else
            class="feds_list"
        >
            <li
                v-for="federation in federations"
                :key="federation.id"
                class="feds_item"
            >
                <div class="feds_item-head">
                    <span class="feds_item-name">{{ federation.name }}</span>
                    <code class="feds_item-slug">{{ federation.slug }}</code>
                    <time
                        class="feds_item-created"
                        :datetime="federation.createdAt"
                    >{{ formatDate(federation.createdAt, locale) }}</time>
                </div>
                <p class="feds_item-members">
                    <span class="feds_item-label">{{ t('staff.federations.column.members') }}</span>
                    <template v-if="federation.tenants.length">
                        <code
                            v-for="member in federation.tenants"
                            :key="member.id"
                            class="feds_member"
                        >{{ member.slug }}</code>
                    </template>
                    <span
                        v-else
                        class="feds_item-none"
                    >{{ t('staff.federations.noMembers') }}</span>
                </p>
            </li>
        </ul>

        <form
            class="feds_form"
            @submit.prevent="createFederation"
        >
            <h3 class="feds_form-title">{{ t('staff.federations.createHeading') }}</h3>

            <div class="feds_form-row">
                <CommonInputText
                    v-model="form.slug"
                    :placeholder="t('common.field.slug')"
                    :disabled="creating"
                    :input-attrs="{ required: true, autocomplete: 'off' }"
                >{{ t('common.field.slug') }}</CommonInputText>

                <CommonInputText
                    v-model="form.name"
                    :placeholder="t('staff.federations.namePlaceholder')"
                    :disabled="creating"
                    :input-attrs="{ required: true }"
                >{{ t('common.field.name') }}</CommonInputText>
            </div>

            <p
                v-if="error"
                class="feds_note feds_note--error"
                role="alert"
            >{{ error }}</p>

            <p
                v-if="info"
                class="feds_note feds_note--success"
                role="status"
            >{{ info }}</p>

            <div>
                <CommonButton
                    native-type="submit"
                    type="primary"
                    :disabled="creating"
                >{{ creating ? t('common.action.creating') : t('staff.federations.submit') }}</CommonButton>
            </div>
        </form>
    </StaffPanel>
</template>

<script setup lang="ts">
import CommonButton from '~/components/common/CommonButton.vue';
import CommonInputText from '~/components/common/CommonInputText.vue';
import StaffPanel from '~/components/staff/StaffPanel.vue';
import { useT } from '~/composables/i18n';
import { useViewerLocale } from '~/composables/locale';
import { formatDate } from '~/utils/formatDate';
import type { StaffFederation } from '~/utils/staff';

/** Federation list and creation, issue #64's UI half, moved out of the page unchanged. */
defineProps<{
    federations: StaffFederation[];
    listError: string;
}>();

const emit = defineEmits<{ refresh: [] }>();

const { t } = useT();
const locale = useViewerLocale();

const form = reactive({ slug: '', name: '' });
const creating = ref(false);
const error = ref('');
const info = ref('');

interface CreateFederationResult {
    federation: { id: string; slug: string; name: string };
    alreadyExisted: boolean;
}

async function createFederation() {
    if (creating.value) {
        return;
    }

    error.value = '';
    info.value = '';
    creating.value = true;

    try {
        const result = await $fetch<CreateFederationResult>('/api/staff/federations', {
            method: 'POST',
            body: { slug: form.slug, name: form.name },
        });

        info.value = result.alreadyExisted
            ? t('staff.federations.alreadyExisted', { slug: result.federation.slug })
            : t('staff.federations.created', { slug: result.federation.slug });

        form.slug = '';
        form.name = '';
        emit('refresh');
    } catch (caught) {
        error.value = serverErrorMessage(caught) ?? t('staff.federations.error');
    } finally {
        creating.value = false;
    }
}
</script>

<style scoped lang="scss">
.feds {
    &_lead {
        margin: 0;
        font-size: var(--font-size-sm);
        line-height: var(--leading-prose);
        color: $content7;

        code { font-size: var(--font-size-xs); }
    }

    &_count {
        margin: 0;
        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: $content7;
    }

    &_list {
        display: flex;
        flex-direction: column;

        margin: 0;
        padding: 0;
        border: 1px solid $surface4;
        border-radius: var(--radius-xl);

        list-style: none;
    }

    &_item {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);

        padding: var(--space-4) var(--space-5);
        border-bottom: 1px solid $surface3;

        &:last-child { border-bottom: none; }

        &-head {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-3);
            align-items: baseline;
        }

        &-name {
            font-size: var(--font-size-md);
            color: $content2;
        }

        &-slug {
            font-size: var(--font-size-xs);
            color: $content7;
        }

        &-created {
            margin-left: auto;
            font-size: var(--font-size-sm);
            font-variant-numeric: tabular-nums;
            color: $content6;
        }

        &-members {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-2);
            align-items: center;

            margin: 0;

            font-size: var(--font-size-sm);
        }

        &-label {
            font-size: var(--font-size-xs);
            font-weight: 650;
            color: $content7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        &-none { color: $content7; }
    }

    &_member {
        padding: 0 var(--space-2);
        border-radius: var(--radius-sm);

        font-size: var(--font-size-xs);
        color: $content3;

        background: $surface3;
    }

    &_form {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);

        padding-top: var(--space-5);
        border-top: 1px solid $surface3;

        &-title {
            margin: 0;

            font-size: var(--font-size-xs);
            font-weight: 650;
            color: $content7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        &-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: var(--space-4);
        }
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

    &_note {
        margin: 0;
        font-size: var(--font-size-sm);

        &--error { color: $error700; }
        &--success { color: $success700; }
    }
}
</style>
