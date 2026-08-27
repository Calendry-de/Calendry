import { z } from 'zod';
import { COLOR_SOURCES } from '../../../shared/sessionColor';
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
 * Writing is gated on `session_kind.update` — an EXISTING permission, and the
 * closest true sibling: colours already live on Session kinds, and this page is
 * the tenant-wide version of exactly that decision. Whoever may set a kind's
 * colour is whoever should set the standard the kinds fall back to.
 *
 * Minting `display_settings.manage` was the alternative and was rejected on
 * cost: a new permission means editing the catalogue constant AND its migration
 * mirror, then a `grant:permissions` backfill, because the seed deliberately
 * never touches `access_role_permission` — until that backfill runs, every
 * existing tenant-admin 403s on a visible page. That is a lot of moving parts
 * for a distinction nobody asked for.
 *
 * Reading needs only `session.read`: everyone who sees the schedule needs to
 * know how to draw it.
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
        await requirePermission(event, tx, 'session_kind.update');

        return mapDbErrors(async () => {
            const row = await tx.tenantDisplaySettings.upsert({
                where: { tenantId: identity.tenantId },
                create: { tenantId: identity.tenantId, ...input },
                update: input,
            });

            return {
                highlightOnline: row.highlightOnline,
                onlineColor: row.onlineColor,
                colorSourceOrder: row.colorSourceOrder,
                defaultColor: row.defaultColor,
                configured: true,
            };
        });
    });
});

/** Exported for the test that pins the accepted source list to the catalogue. */
export const ACCEPTED_COLOR_SOURCES = COLOR_SOURCES;
