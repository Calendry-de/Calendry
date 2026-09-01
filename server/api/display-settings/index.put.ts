import { z } from 'zod';
import { COLOR_SOURCES, DISPLAY_DEFAULTS } from '../../../shared/sessionColor';
import { isUsableLocale } from '../../../shared/locale';
import { isUsableTimeZone } from '../../../shared/timezone';
import { DEFAULT_TENANT_MODE, TENANT_MODES } from '../../../shared/tenantMode';
import { mapDbErrors } from '../../utils/dbErrors';
import { requirePermission } from '../../utils/requirePermission';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Set how this tenant's schedule is drawn.
 *
 * UPSERT, because the row is a singleton keyed by `tenant_id` and its absence
 * means defaults. A caller who changes one setting on a tenant that has never
 * saved any should not have to know whether a row exists — and there is no
 * create/update distinction to expose when a second row cannot exist.
 *
 * Writing is gated on `tenant.update`. It was `session_kind.update` — an
 * existing permission borrowed on the reasoning that colours already live on
 * Session kinds, chosen because minting one looked disproportionate for a
 * distinction nobody had asked for.
 *
 * WHAT CHANGED THAT: the page acquired a gate of its own (`tenant.read`). The
 * borrowed pairing then described a role that may change this institution's
 * settings and never see the page it changes them on — the asymmetry this
 * codebase treats as a bug wherever else it appears. Once one key had to be
 * minted, the second cost nothing but a line in the same backfill.
 *
 * A CUSTOM ROLE HOLDING `session_kind.update` LOSES THIS WRITE until
 * `tenant.update` is granted. `tenant-admin` is covered by
 * `grant:permissions --all-missing`; anything hand-composed is not, and that is
 * a deploy step, not a runtime concern — CLAUDE.md § "Bootstrap & deploy".
 *
 * Reading accepts `tenant.read` OR `session.read` — see index.get.ts for why
 * that is not the same list.
 */
const schema = z.object({
    highlightOnline: z.boolean().optional(),
    onlineColor: z.string().nullish(),
    /**
     * VALIDATED AGAINST THE KNOWN SOURCES, and deliberately not free-form. An
     * unknown source would be silently skipped by the resolver — a setting that
     * saves, displays, and does nothing, which is the failure mode this codebase
     * keeps writing rules about. Duplicates are rejected for the same reason:
     * the second occurrence can never be reached.
     */
    colorSourceOrder: z.array(z.enum(['offering', 'kind']))
        .refine((list) => new Set(list).size === list.length, 'Each colour source may appear once.')
        .optional(),
    defaultColor: z.string().nullish(),
    /**
     * Issue #17. `null` clears the tenant default (defer to Accept-Language);
     * checked against `Intl` here rather than left to degrade silently at
     * read time — a setting that saves and does nothing is exactly the
     * failure shape `colorSourceOrder`'s own comment above warns about.
     */
    defaultLocale: z.string().nullish()
        .refine((value) => value == null || isUsableLocale(value), 'Not a recognised locale.'),
    /**
     * Issue #8. No `null` here, unlike `defaultLocale`: a mode bias has no
     * "unset" reading distinct from its default, so there is nothing a null
     * could mean that `UNIVERSITY` does not already say.
     */
    mode: z.enum(TENANT_MODES).optional(),
    /**
     * `Tenant.timezone`, not `tenant_display_settings` — a required column
     * with no "unset" state (grid resolution, constraint evaluation and
     * "same day" logic all run in it, TAXONOMY.md §8), so no `null` here
     * either, same reasoning as `mode`. Written separately below since it
     * lives on a different row than the rest of this schema.
     */
    timezone: z.string()
        .refine(isUsableTimeZone, 'Not a recognised timezone.')
        .optional(),
});

export default defineEventHandler(async (event) => {
    /*
     * `readValidatedBody`, not `schema.parse(await readBody(...))`. A bare
     * ZodError reaches h3 as a 500 — an input mistake dressed up as a server
     * fault, which sends the caller looking in the wrong place. The generic
     * resource routes already parse this way for exactly that reason.
     */
    const input = await readValidatedBody(event, schema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        await requirePermission(event, tx, 'tenant.update');

        // Split out before the upsert below — `timezone` is not a column on
        // `tenant_display_settings` and `tx.tenantDisplaySettings.upsert`
        // would reject an unknown field.
        const { timezone, ...displayInput } = input;
        const changesDisplaySettings = Object.keys(displayInput).length > 0;

        return mapDbErrors(async () => {
            /*
             * SKIPPED, not upserted with an empty patch, when the request only
             * touches `timezone`: an unconditional upsert here would CREATE the
             * singleton — stamping every other field with its default — for a
             * caller who asked to change none of them. The GET route's own
             * "absent row means defaults" contract (index.get.ts) would then be
             * lying about this tenant, which never actually saved a display
             * preference.
             */
            const row = changesDisplaySettings
                ? await tx.tenantDisplaySettings.upsert({
                    where: { tenantId: identity.tenantId },
                    create: { tenantId: identity.tenantId, ...displayInput },
                    update: displayInput,
                })
                : await tx.tenantDisplaySettings.findUnique({ where: { tenantId: identity.tenantId } });

            const tenant = timezone === undefined
                ? await tx.tenant.findUniqueOrThrow({ where: { id: identity.tenantId }, select: { timezone: true } })
                : await tx.tenant.update({ where: { id: identity.tenantId }, data: { timezone }, select: { timezone: true } });

            if (!row) {
                return {
                    ...DISPLAY_DEFAULTS, defaultLocale: null, mode: DEFAULT_TENANT_MODE, timezone: tenant.timezone, configured: false,
                };
            }

            return {
                highlightOnline: row.highlightOnline,
                onlineColor: row.onlineColor,
                colorSourceOrder: row.colorSourceOrder,
                defaultColor: row.defaultColor,
                defaultLocale: row.defaultLocale,
                mode: row.mode,
                timezone: tenant.timezone,
                configured: true,
            };
        });
    });
});

/** Exported for the test that pins the accepted source list to the catalogue. */
export const ACCEPTED_COLOR_SOURCES = COLOR_SOURCES;
