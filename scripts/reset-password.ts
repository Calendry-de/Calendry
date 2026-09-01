/**
 * Force-resets an Account's password, and — with `--create` — issues one to
 * somebody who is on the roster but has no login yet. Last-resort operator
 * recovery.
 *
 * WHY A CLI AS WELL AS THE MANAGE AREA
 * ------------------------------------
 * `/manage/accounts` can now issue a password, gated on `account.manage` inside
 * one tenant. This stays because it answers to a different authority — whoever
 * holds the database credential — and because that route deliberately refuses a
 * login SHARED with another institution, so that one tenant cannot take over a
 * credential another one also uses. An operator is the right actor for exactly
 * that case, and for the case where nobody can sign in at all.
 *
 * WHY THE APP ROLE, NOT THE OWNER
 * -------------------------------
 * Unlike provisioning, a plain reset needs no ownership. `account`,
 * `account_person` and `auth_session` are the pre-tenant plane with no RLS, so
 * the app role can write them; the one tenant-scoped read (which tenants the
 * account spans) goes through calendry_internal.account_identities(), which the
 * app role may execute. Verified against the live database, not assumed. Using
 * the owner would mean an operator needs credentials that can drop FORCE ROW
 * LEVEL SECURITY just to change a password.
 *
 * `--create` IS THE EXCEPTION, and it is why the connection is chosen rather than
 * fixed: finding a Person by email means READING `person`, which is behind RLS
 * with no tenant context to set out here. So that mode — and only that mode —
 * connects as the owner. The choice is printed, because "which role am I" is not
 * something an operator should have to infer.
 *
 * WHAT `--create` IS FOR
 * ----------------------
 * Creating a Person in the management area does NOT create a login; they are
 * different things (TAXONOMY.md §2 vs §4). So the ordinary shape of "X cannot
 * sign in" is that X exists on the roster and has no Account at all — and this
 * script used to answer that with "No account with email X." and stop, which was
 * true, unhelpful, and left no command that could fix it. With `--create` the
 * Account is created and linked to that Person, and the password is reported the
 * same way a reset's is.
 *
 * It does NOT grant anything. A Person with no AccessRole can sign in and see
 * nothing, so that case is reported loudly rather than quietly fixed — deciding
 * what somebody may do is tenant configuration, not password recovery.
 *
 * TARGETS AN ACCOUNT, NOT A PERSON
 * --------------------------------
 * `account.email` is globally unique; `person.email` is unique only per tenant.
 * One Account spans tenants via account_person, so resetting a tenant+person
 * pair would leave the actual credential untouched everywhere else. That is also
 * why `--create` needs `--tenant` when the same address is on more than one
 * roster: which Person the new credential acts as is a real choice.
 *
 *   bun run reset:password -- --email someone@example.edu [--yes]
 *   bun run reset:password -- --email new.lecturer@example.edu --create [--tenant test]
 */
import { createInterface } from 'node:readline/promises';
import { hostname, userInfo } from 'node:os';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
// The real hashing path, not a re-implementation. A second copy of the KDF
// drifts silently the moment the original changes.
import { hashPassword } from '../server/utils/auth';
import { randomPassword } from '../shared/password';
import { describeTarget, resolveAppDatabaseUrl, resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';
import { arg, formatUnreachableDatabaseError, isUnreachableDatabaseError } from './lib/cli';

/** One roster entry that could be given this credential. */
interface Candidate {
    id: string;
    given_name: string;
    family_name: string;
    tenant_id: string;
    tenant_slug: string;
    tenant_name: string;
    access_roles: number;
    linked_account: string | null;
}

async function main() {
    const email = arg('email')?.toLowerCase();
    const tenantSlug = arg('tenant');
    const skipConfirm = process.argv.includes('--yes');
    const create = process.argv.includes('--create');

    if (!email) {
        console.error('Missing required --email');
        process.exit(1);
    }

    // See the header: only `--create` has to read `person`, and only that needs
    // to bypass RLS. Announced rather than implied.
    const connectionString = create ? resolveOwnerDatabaseUrl() : resolveAppDatabaseUrl();
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

    try {
        const account = await prisma.account.findUnique({ where: { email } });

        if (!account && !create) {
            /*
             * Unlike the login route, this names the failure. The
             * account-existence oracle protection exists to stop anonymous
             * probing; an operator with database credentials needs to know they
             * mistyped the address — or that the address has no login yet, which
             * is a different problem with a different flag.
             */
            console.error(`\nNo account with email '${email}'.`);
            console.error('If somebody on the roster has that address and simply has no login yet, '
                + 'create one:\n\n  bun run reset:password -- --email '
                + `${email} --create\n`);
            process.exit(1);
        }

        if (account && create) {
            // Not an error: the requested end state is "this address can sign in
            // with a known password", and it is reachable. Saying the flag did
            // nothing is what keeps the report honest.
            console.log('\n--create had nothing to do: that address already has a login. '
                + 'Resetting its password.');
        }

        let personId: string | null = null;
        let created: Candidate | null = null;

        if (!account) {
            /*
             * Every roster entry with this address, in any tenant, with what it
             * already has. One query rather than a scan per tenant, and it
             * reports what it found rather than picking for the operator — the
             * `person.email` uniqueness is PER TENANT, so more than one is
             * ordinary rather than a corruption.
             */
            const candidates = await prisma.$queryRaw<Candidate[]>`
                SELECT p.id,
                       p.given_name,
                       p.family_name,
                       t.id   AS tenant_id,
                       t.slug AS tenant_slug,
                       t.name AS tenant_name,
                       (SELECT count(*)::int FROM person_access_role par WHERE par.person_id = p.id)
                            AS access_roles,
                       (SELECT a.email FROM account_person ap
                          JOIN account a ON a.id = ap.account_id
                         WHERE ap.person_id = p.id)
                            AS linked_account
                  FROM person p
                  JOIN tenant t ON t.id = p.tenant_id
                 WHERE lower(p.email) = ${email}
                   AND p.is_active
                 ORDER BY t.slug
            `;

            const free = candidates.filter((row) => row.linked_account === null);

            if (candidates.length === 0) {
                console.error(`\nNo login and nobody active on any roster with '${email}'.`);
                console.error('There is nothing to attach a credential to. Add the person first '
                    + '(Manage → People, or `bun run create:account`).\n');
                process.exit(1);
            }

            if (free.length === 0) {
                /*
                 * Every match already answers to some other login. Refused rather
                 * than resolved, and it names them: `account_person` is
                 * `@@unique([personId])` on purpose, so there is no correct write
                 * here, and the operator almost certainly wants to reset THAT
                 * address instead.
                 */
                console.error(`\n'${email}' is on ${candidates.length} roster(s), and every one of `
                    + 'those people already answers to a different login:');

                for (const row of candidates) {
                    console.error(`  ${row.tenant_slug}: ${row.given_name} ${row.family_name} → `
                        + `${row.linked_account}`);
                }

                console.error('\nA person answers to exactly one account. Reset the login named '
                    + 'above, or detach it first.\n');
                process.exit(1);
            }

            const selected = tenantSlug
                ? free.find((row) => row.tenant_slug === tenantSlug)
                : free.length === 1
                    ? free[0]
                    : undefined;

            if (tenantSlug && !selected) {
                console.error(`\nNobody with '${email}' in tenant '${tenantSlug}' is free to take a `
                    + 'new login. Candidates: '
                    + `${free.map((row) => row.tenant_slug).join(', ')}\n`);
                process.exit(1);
            }

            if (!selected) {
                // Ambiguity is REPORTED, never resolved by picking the first. The
                // new credential acts as exactly one of these people, and which
                // one is the operator's decision.
                console.error(`\n'${email}' is on ${free.length} rosters with no login. `
                    + 'Name the institution with --tenant:');

                for (const row of free) {
                    console.error(`  --tenant ${row.tenant_slug}   ${row.given_name} `
                        + `${row.family_name} (${row.tenant_name})`);
                }

                console.error('');
                process.exit(1);
            }

            created = selected;
            personId = selected.id;
        }

        // Blast radius, resolved before anything is written so the operator can
        // see what they are about to do.
        const identities = account
            ? await prisma.$queryRaw<{ tenant_slug: string; tenant_name: string }[]>`
                SELECT * FROM calendry_internal.account_identities(${account.id})
            `
            : [];
        const liveSessions = account
            ? await prisma.authSession.count({
                where: { accountId: account.id, revokedAt: null, expiresAt: { gt: new Date() } },
            })
            : 0;

        console.log(`\nDatabase  ${describeTarget(connectionString)} as `
            + `${create ? 'the OWNER (--create reads person, which is behind RLS)' : 'the app role'}`);

        if (created) {
            console.log(`Account   ${email} — NEW, none existed`);
            console.log(`Acts as   ${created.given_name} ${created.family_name} in `
                + `${created.tenant_slug} (${created.tenant_name})`);
            console.log('Effect    new login, one-time password, must be changed at first sign-in');

            if (created.access_roles === 0) {
                // Loud, and deliberately not fixed here. A login that can sign in
                // and see nothing is the most confusing possible outcome, and
                // deciding what somebody may do is tenant configuration.
                console.log('');
                console.log('WARNING   That person holds NO access role, so this login will sign in');
                console.log('          and see nothing. Grant one under Manage → People, or:');
                console.log(`            bun run create:account -- --tenant ${created.tenant_slug} `
                    + `--email ${email} --attach --role <key>`);
            }
        } else {
            console.log(`Account   ${email} (${account?.id})`);
            console.log(`Tenants   ${identities.map((i) => i.tenant_slug).join(', ') || '(none)'}`);
            console.log(`Sessions  ${liveSessions} active — all will be revoked, in every tenant`);
            console.log('Effect    new one-time password, and the account must change it at next login');
        }

        console.log('');

        if (!skipConfirm) {
            // Retyping the address, not y/n: the realistic accident here is
            // resetting the wrong account, which a reflexive "y" does not catch.
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const answer = await rl.question(`Type the email to confirm (${email}): `);

            rl.close();

            if (answer.trim().toLowerCase() !== email) {
                console.error('\nDoes not match. Nothing was changed.\n');
                process.exit(1);
            }
        }

        const newPassword = randomPassword();
        const passwordHash = await hashPassword(newPassword);

        /*
         * One transaction, in both modes. For a reset: setting the password but
         * failing to revoke sessions is worse than doing neither, because the old
         * session keeps working under a password its holder no longer knows. For a
         * creation: an Account with no `account_person` row is invisible to every
         * tenant while its password still works.
         */
        const result = await prisma.$transaction(async (tx) => {
            if (!account) {
                const fresh = await tx.account.create({
                    data: { email, passwordHash, mustChangePassword: true },
                });

                await tx.accountPerson.create({
                    data: { accountId: fresh.id, personId: personId as string },
                });

                return { accountId: fresh.id, revoked: 0 };
            }

            await tx.account.update({
                where: { id: account.id },
                data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() },
            });

            // Sessions hang off account_id, so this reaches every tenant the
            // account acts in — not just the one it was last used in.
            const revoked = await tx.authSession.updateMany({
                where: { accountId: account.id, revokedAt: null },
                data: { revokedAt: new Date() },
            });

            return { accountId: account.id, revoked: revoked.count };
        });

        const record = {
            ts: new Date().toISOString(),
            action: created ? 'account.created_by_reset' : 'account.password_reset',
            accountId: result.accountId,
            email,
            tenants: created ? [created.tenant_slug] : identities.map((i) => i.tenant_slug),
            personId,
            sessionsRevoked: result.revoked,
            mustChangePassword: true,
            operator: `${userInfo().username}@${hostname()}`,
            via: 'cli:reset-password',
        };

        if (created) {
            console.log(`\nLogin created. account=${result.accountId} person=${personId}`);
        } else {
            console.log(`\nReset complete. ${result.revoked} session(s) revoked across `
                + `${identities.length} tenant(s).`);
        }

        console.log(`\n  One-time password: ${newPassword}`);
        console.log('  Shown once. The account must change it at next sign-in.\n');

        // Structured line for redirection into a real log sink. Deliberately not
        // a database table: the operator running this can rewrite any table in
        // this database, so a local audit row is not tamper-evident against the
        // one actor it audits. stdout to an external collector is honest about
        // where the trust boundary actually is.
        console.log(`AUDIT ${JSON.stringify(record)}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (isUnreachableDatabaseError(message)) {
            console.error(formatUnreachableDatabaseError(
                connectionString,
                create ? 'MIGRATION_DATABASE_URL_HOST' : 'DATABASE_URL_HOST',
            ));
        } else {
            console.error(`\nReset failed, nothing was changed: ${message}\n`);
        }

        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

await main();
