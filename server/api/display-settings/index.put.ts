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
