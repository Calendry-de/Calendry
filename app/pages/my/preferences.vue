<template>
    <CommonPage title="My teaching preferences">
        <p class="intro">
            Days and times you would rather teach. Unlike unavailability, a preference is a
            <strong>soft</strong> wish — it never blocks a placement, so it needs no approval
            and takes effect as soon as you save it.
        </p>

        <!--
            STAGE 7, 2026-08-27: this replaced "Recorded, not yet used by the
            scheduler", which was true until the solver gained its evaluator
            (calendry-solver 41f6227) and this app flipped the constraint's
            wireField. Verified end to end before the sentence changed —
            `scripts/preference-solve-check.ts` scores the same instance solved
            with and without the rule, and the stated preferences went from 7 of
            40 placements satisfied to 40 of 40.

            IT IS NOT AN UNCONDITIONAL PROMISE, and that is deliberate.
            `person_preference_fit` is off by default and each institution
            chooses whether to enable it, so "the timetable weighs these" would
            be false wherever it is switched off — the same class of untrue
            reassurance the old disclaimer existed to prevent, just pointing the
            other way. This page cannot read the tenant's constraint rows
            (`constraint.read` is an administrator's key), so it names the
            dependency rather than guessing at it. Resolving the real state
            needs a decision about what a lecturer may see of their
            institution's configuration — tracked on the project board.
        -->
        <p
            class="note"
            role="status"
        >
            <Icon
                name="material-symbols:info-outline"
                aria-hidden="true"
            />
            <span>
                <strong>The scheduler can weigh these.</strong>
                Preferences are saved, visible to administrators, and read by the timetable
                generator, which tries to place your sessions on the days and blocks you
                choose. Whether it does is an institution setting, and a preference always
                loses to a hard requirement — so treat it as a wish that is now heard, not a
                guarantee.
            </span>
        </p>

        <!--
            THE GUARD ITS SIBLING ALREADY HAD. Without it this page rendered
            "Preferred blocks", its help text, and then nothing — so a tenant
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
            <span>
                This institution has no time grid configured, so blocks cannot be shown.
                An administrator has to create one first. Day preferences below still work.
            </span>
        </p>

        <section class="card">
            <h2>Your preferences</h2>

            <ManageWeekdayPicker
                v-model="draftDays"
                help="Leave everything unticked if you have no day preference."
                label="Preferred days"
            />

            <AvailabilityBlockPicker
                v-model="draftBlocks"
                :grid="grid"
                help="Leave everything unticked if you have no preference about the time of day."
                label="Preferred blocks"
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
            >Saved.</p>

            <div class="actions">
                <CommonButton
                    :disabled="busy || !dirty"
                    type="primary"
                    @click="save"
                >{{ busy ? 'Saving…' : 'Save preferences' }}</CommonButton>

                <CommonButton
                    v-if="dirty"
                    :disabled="busy"
                    type="secondary"
                    @click="seed"
                >Discard changes</CommonButton>
            </div>
        </section>
    </CommonPage>
</template>

<script setup lang="ts">
import type { TimeGrid } from '~/composables/schedule';
import AvailabilityBlockPicker from '~/components/availability/AvailabilityBlockPicker.vue';
import ManageWeekdayPicker from '~/components/manage/ManageWeekdayPicker.vue';

definePageMeta({ middleware: 'my' });

useHead({ title: 'My teaching preferences' });

interface Payload {
    grid: TimeGrid | null;
    preference: { preferredDays: number[]; preferredBlocks: number[] } | null;
}

const request = useRequestFetch();

const { data, refresh } = await useAsyncData(
    'my:preferences',
    () => request<Payload>('/api/me/availability'),
);

const grid = computed(() => data.value?.grid ?? null);

const draftDays = ref<number[]>([]);
const draftBlocks = ref<number[]>([]);
const pristine = ref('');
const busy = ref(false);
const saved = ref(false);
const error = ref('');

function seed() {
    draftDays.value = [...(data.value?.preference?.preferredDays ?? [])];
    draftBlocks.value = [...(data.value?.preference?.preferredBlocks ?? [])];
    pristine.value = JSON.stringify([draftDays.value, draftBlocks.value]);
    saved.value = false;
    error.value = '';
}

/*
 * Seeded from the AWAITED data, not from a watcher. Vue does not flush watchers
 * during SSR, so a `watch(..., { immediate: true })` would run once on the
 * server with nothing fetched and render empty controls over real preferences —
 * the failure CLAUDE.md records from Step 13. The watcher below is for later
 * client-side refreshes only.
 */
seed();
watch(data, seed);

const dirty = computed(() => JSON.stringify([draftDays.value, draftBlocks.value]) !== pristine.value);

/*
 * "Saved." is about the last write, so it stops being true the moment there are
 * unsaved changes again. It used to persist beside a dirty form, which reads as
 * "your current state is saved" — the one thing it does not mean.
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
            body: { preferredDays: draftDays.value, preferredBlocks: draftBlocks.value },
        });

        await refresh();
        saved.value = true;
    } catch (cause) {
        error.value = (cause as { statusMessage?: string }).statusMessage ?? 'Could not save that.';
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

    // `.iconify`, not `svg` — `Icon` renders a span, so the old rule matched
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
     * `$surface1` — 1.00:1, measured, in both themes — so the fill and the
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
     * draws nothing (measured 1.00:1) — and a horizontal padding on an
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
