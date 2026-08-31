import { z } from 'zod';
import { isUsableLocale } from '../../../shared/locale';
import { withRequestTenant } from '../../utils/tenantDb';

/**
 * Set (or clear) the signed-in Person's own `locale` (issue #17).
 *
 * `null` clears it — defer to the tenant default, then Accept-Language.
 * Self-service, same as the GET: no permission beyond being signed in,
 * because this writes only the caller's own row.
 */
const schema = z.object({
    locale: z.string().nullable()
        .refine((value) => value == null || isUsableLocale(value), 'Not a recognised locale.'),
});

export default defineEventHandler(async (event) => {
    const input = await readValidatedBody(event, schema.parse);

    return withRequestTenant(event, async (tx, identity) => {
        if (!identity.actorPersonId) {
            throw createError({ statusCode: 403, statusMessage: 'No acting person on this request.' });
        }

        const person = await tx.person.update({
            where: { id: identity.actorPersonId },
            data: { locale: input.locale },
            select: { locale: true },
        });

        return { locale: person.locale };
    });
});
