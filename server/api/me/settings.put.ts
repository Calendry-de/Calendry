import { z } from 'zod';
import { isUsableLocale } from '../../../shared/locale';
import { isUsableTimeZone } from '../../../shared/timezone';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Set (or clear) the signed-in Person's own `locale` (issue #17) and, now,
 * `timezone`. Both `null` clears the field (display/export only), so
 * "unset" is a real, meaningful state, not an error. Self-service, same as
 * the GET: no permission beyond being signed in, because this writes only
 * the caller's own row.
 *
 * `locale` stays REQUIRED (unchanged since issue #17); `timezone` is
 * OPTIONAL: omitting it leaves the stored value untouched, so an existing
 * caller that only ever knew about `locale` keeps working unmodified rather
 * than being forced to start naming a field it has never heard of.
 */
const schema = z.object({
    locale: z.string().nullable()
        .refine((value) => value == null || isUsableLocale(value), 'Not a recognised locale.'),
    timezone: z.string().nullable()
        .refine((value) => value == null || isUsableTimeZone(value), 'Not a recognised timezone.')
        .optional(),
});

export default defineEventHandler(async (event) => {
    const input = await readValidatedBody(event, schema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        if (!identity.actorPersonId) {
            throw createError({ statusCode: 403, statusMessage: 'No acting person on this request.' });
        }

        const person = await tx.person.update({
            where: { id: identity.actorPersonId },
            data: {
                locale: input.locale,
                ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
            },
            select: { locale: true, timezone: true },
        });

        return { locale: person.locale, timezone: person.timezone };
    });
});
