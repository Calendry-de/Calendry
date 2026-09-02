<template>
    <CommonPage :title="t('my.preferences.pageTitle')">
        <!--
            `<i18n-t>`, not a sentence split around its own emphasis: "soft" is
            the word the whole paragraph turns on, and German declines it.
        -->
        <i18n-t
            class="intro"
            keypath="my.preferences.intro"
            scope="global"
            tag="p"
        >
            <template #soft>
                <strong>{{ t('my.preferences.introSoft') }}</strong>
            </template>
        </i18n-t>

        <!--
            ISSUE #3, RESOLVED: the hedge this replaced said "This page cannot
            read the tenant's constraint rows" and left the actual state
            unstated. `/api/me/enforcement` answers the ONE question this page
            needs (is `person_preference_fit` currently on) with a plain
            boolean and no new permission (see that route's own comment for
            why none was needed). Two sentences now, chosen by the same fact
            rather than always saying the same thing regardless of it.

            STILL NOT AN UNCONDITIONAL PROMISE even when true: a preference
            always loses to a hard requirement, so "weighed" is not "granted".
            Verified end to end when this first shipped: `scripts/preference
            -solve-check.ts` scores the same instance solved with and without
            the rule, 7 of 40 placements satisfied against 40 of 40.
        -->
        <p
            class="note"
            role="status"
        >
            <Icon
                name="material-symbols:info-outline"
                aria-hidden="true"
            />
            <i18n-t
                v-if="preferencesWeighed"
                keypath="my.preferences.weighed"
                scope="global"
                tag="span"
            >
                <template #lead>
                    <strong>{{ t('my.preferences.weighedLead') }}</strong>
                </template>
            </i18n-t>
            <i18n-t
                v-else
                keypath="my.preferences.notWeighed"
                scope="global"
                tag="span"
            >
                <template #lead>
                    <strong>{{ t('my.preferences.notWeighedLead') }}</strong>
                </template>
            </i18n-t>
        </p>

        <!--
            THE GUARD ITS SIBLING ALREADY HAD. Without it this page rendered
            "Preferred blocks", its help text, and then nothing, so a tenant
            with no TimeGrid was indistinguishable from a failed fetch, which is
            the exact failure CLAUDE.md names as invisible. `availability.vue`
            carried this branch; this page did not.
        -->
        <p
            v-if="!grid"
            class="note note--warn"
            role="alert"
        >
            <Icon
                name="material-symbols:warning-outline"
                aria-hidden="true"
            />
            <span>{{ t('my.preferences.noGrid') }}</span>
        </p>

        <section class="card">
            <h2>{{ t('my.preferences.head') }}</h2>

            <ManageWeekdayPicker
                v-model="draftDays"
                :help="t('my.preferences.daysHelp')"
                :label="t('my.preferences.daysLabel')"
            />

            <AvailabilityBlockPicker
                v-model="draftBlocks"
                :grid="grid"
                :help="t('my.preferences.blocksHelp')"
                :label="t('my.preferences.blocksLabel')"
            />

            <AvailabilityRoomFeaturePicker
                v-model="draftRoomFeatures"
                :help="t('my.preferences.roomTypesHelp')"
                :label="t('my.preferences.roomTypesLabel')"
                :options="roomFeatureOptions"
            />

            <p
                v-if="error"
                class="note note--error"
                role="alert"
            >{{ error }}</p>

            <p
                v-else-if="saved"
                class="note note--ok"
                role="status"
            >{{ t('my.preferences.saved') }}</p>

            <div class="actions">
                <CommonButton
                    :disabled="busy || !dirty"
                    type="primary"
                    @click="save"
                >{{ busy ? t('common.action.saving') : t('my.preferences.save') }}</CommonButton>

                <CommonButton
                    v-if="dirty"
                    :disabled="busy"
                    type="secondary"
                    @click="seed"
                >{{ t('my.preferences.discard') }}</CommonButton>
            </div>
        </section>
    </CommonPage>
</template>

<script setup lang="ts">
import type { TimeGrid } from '~/composables/schedule';
import AvailabilityBlockPicker from '~/components/availability/AvailabilityBlockPicker.vue';
import AvailabilityRoomFeaturePicker from '~/components/availability/AvailabilityRoomFeaturePicker.vue';
import type { RoomFeatureOption } from '~/components/availability/AvailabilityRoomFeaturePicker.vue';
import ManageWeekdayPicker from '~/components/manage/ManageWeekdayPicker.vue';
import { useT } from '~/composables/i18n';

definePageMeta({ middleware: 'my' });

const { t } = useT();

useHead(() => ({ title: t('my.preferences.pageTitle') }));

interface Payload {
    grid: TimeGrid | null;
    preference: {
        preferredDays: number[];
        preferredBlocks: number[];
        preferredRoomFeatureIds: string[];
    } | null;
    roomFeatureOptions: RoomFeatureOption[];
}

const request = useRequestFetch();

const { data, refresh } = await useAsyncData(
    'my:preferences',
    async () => {
        const [payload, enforcement] = await Promise.all([
            request<Payload>('/api/me/availability'),
            /*
             * NEEDS NO PERMISSION (see the route's own comment), so it cannot
             * fail this wave for anyone who reached `/api/me/availability`
             * (availability.manage_own) here. Not wrapped in a `.catch()`
             * fallback the way `ManageGroupAvailability`'s tolerant fetch is:
             * that one guards against a caller who genuinely may not hold
             * `constraint.read`, which does not apply here at all.
             */
            request<{ preferencesWeighed: boolean }>('/api/me/enforcement'),
        ]);

        return { ...payload, preferencesWeighed: enforcement.preferencesWeighed };
    },
);

const grid = computed(() => data.value?.grid ?? null);
const roomFeatureOptions = computed(() => data.value?.roomFeatureOptions ?? []);
const preferencesWeighed = computed(() => data.value?.preferencesWeighed ?? false);

const draftDays = ref<number[]>([]);
const draftBlocks = ref<number[]>([]);
const draftRoomFeatures = ref<string[]>([]);
const pristine = ref('');
const busy = ref(false);
const saved = ref(false);
const error = ref('');

function snapshot() {
    return JSON.stringify([draftDays.value, draftBlocks.value, draftRoomFeatures.value]);
}

function seed() {
    draftDays.value = [...(data.value?.preference?.preferredDays ?? [])];
    draftBlocks.value = [...(data.value?.preference?.preferredBlocks ?? [])];
    draftRoomFeatures.value = [...(data.value?.preference?.preferredRoomFeatureIds ?? [])];
    pristine.value = snapshot();
    saved.value = false;
    error.value = '';
}

/*
 * Seeded from the AWAITED data, not from a watcher. Vue does not flush watchers
 * during SSR, so a `watch(..., { immediate: true })` would run once on the
 * server with nothing fetched and render empty controls over real preferences,
 * the failure CLAUDE.md records from Step 13. The watcher below is for later
 * client-side refreshes only.
 */
seed();
watch(data, seed);

const dirty = computed(() => snapshot() !== pristine.value);

/*
 * "Saved." is about the last write, so it stops being true the moment there are
 * unsaved changes again. It used to persist beside a dirty form, which reads as
 * "your current state is saved", the one thing it does not mean.
 */
watch(dirty, (isDirty) => {
    if (isDirty) {
        saved.value = false;
    }
});

async function save() {
    busy.value = true;
    error.value = '';
    saved.value = false;

    try {
        await request('/api/me/preferences', {
            method: 'PUT',
            /*
             * ALL THREE AXES, EVERY TIME. The PUT replaces the whole preference
             * state, so a body omitting an axis clears it, which is why this
             * sends the room types even when the list is empty rather than
             * conditionally.
             */
            body: {
                preferredDays: draftDays.value,
                preferredBlocks: draftBlocks.value,
                preferredRoomFeatureIds: draftRoomFeatures.value,
            },
        });

        await refresh();
        saved.value = true;
    } catch (cause) {
        error.value = serverErrorMessage(cause) ?? t('my.preferences.saveError');
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped lang="scss">
.intro,
.note {
    max-width: 68ch;
    margin: 0;

    font-size: var(--font-size-sm);
    line-height: 1.6;
    color: $content7;
}

.note {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;

    // `.iconify`, not `svg`: `Icon` renders a span, so the old rule matched
    // nothing and the glyph stayed shrinkable inside this flex row.
    > .iconify {
        flex: none;
        width: 16px;
        height: 16px;
    }

    &--warn {
        // The single most important sentence on this page was also its least
        // legible text, at 3.73:1. See `warning800` in `utils/styles.ts`.
        color: $warning800;
    }

    &--error {
        font-weight: 600;
        color: $error700;
    }

    &--ok {
        color: $success700;
    }
}

/* Same 620px form column as `availability.vue`, `ManageEntityForm` and
 * `ManageRelationsPanel`, so the two /my pages share one measure. */
.card {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);

    /*
     * NO GROUND, and that is the resolution rather than a compromise.
     *
     * This carried `background: $surface1` on a page ground that is also
     * `$surface1` (1.00:1, measured, in both themes), so the fill and the
     * radius drew literally nothing. No adjacent surface step can fix it
     * either: `surface0` is 1.04:1 from the ground and `surface2` is 1.05:1, so
     * a visible card is simply not available in this palette.
     *
     * Rather than leave a fill that lies, the grouping is carried by what
     * actually works here: the section rhythm and the heading. Restore a fill
     * only alongside a palette that has a real raised surface to spend.
     */
    max-width: 620px;

    /*
     * Vertical inset only. `$surface1` is the body's own ground, so this box
     * draws nothing (measured 1.00:1), and a horizontal padding on an
     * invisible container is just an unexplained 16px indent: it put this
     * card's content at x=288 while the page's own prose sat at x=272. The
     * section is grouped by rhythm instead. Restore the horizontal inset in the
     * same change that gives the card a real ground, not before; note that the
     * palette's adjacent surface steps measure ~1.09:1 and its strongest
     * hairline 1.20:1, so "visible card" is a colour-system decision, not a
     * token swap.
     */
    padding: var(--space-6) 0;

    h2 {
        margin: 0;
        font-size: var(--font-size-md);
        font-weight: 680;
        color: $content2;
    }
}

.actions {
    display: flex;
    gap: var(--space-3);
}
</style>
