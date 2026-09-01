/**
 * Adds a Person + Account to an EXISTING tenant, with an access role.
 *
 * WHY THIS EXISTS
 * ---------------
 * `provision:tenant` creates a tenant and its first admin. There was nothing to
 * add a *second* account to a tenant that already exists, so it kept being done
 * by hand-written SQL — which is exactly how `vic@demo.local` came to be a
 * tracked cleanup item in CLAUDE.md, and why verification work kept borrowing
 * (and resetting) the real admin's credential.
 *
 * WHY A CLI AS WELL AS THE MANAGE AREA
 * ------------------------------------
 * `/manage/accounts` now issues logins over HTTP, gated on `account.manage`
 * inside one tenant. This stays because it answers to a different authority —
 * whoever holds the database credential — and is the only path that works before
 * a tenant has anybody who can sign in, which is every tenant's first minute and
 * every locked-out tenant's worst one. It is also the only path that can create
 * the Person and the login together.
 *
 * WHY THE OWNER CONNECTION
 * ------------------------
 * `person` and `person_access_role` are tenant-scoped under RLS, and this runs
 * outside any request so there is no tenant context to set. `account` and
 * `account_person` are the pre-tenant plane with no RLS at all. The owner
 * bypasses both concerns in one transaction.
 *
 * AN EXISTING ACCOUNT IS REUSED, NOT DUPLICATED. `account.email` is globally
 * unique and one Account can act in several tenants through `account_person` —
 * that is the whole point of a tenant-independent credential. Passing an email
 * that already exists therefore ADDS a tenant to that person rather than
 * creating a second login, and the password is left untouched.
 *
 * AN EXISTING *PERSON* NEEDS `--attach`, AND THAT IS THE POINT OF THE FLAG.
 * Creating a Person in the management area does NOT create a login — they are
 * different things (TAXONOMY.md §2 vs §4) — so the ordinary way to give somebody
 * access is: the roster already has them, and only the credential is missing.
 * Without `--attach` this script used to answer that with "a Person with email X
 * already exists. This script creates; it does not update." and stop, which left
 * no command that could finish the job. With it, every part that already exists
 * is REUSED and every part that is missing is created — the Person, the Account,
 * the `account_person` link, the access-role assignment — and the report says
 * which was which.
 *
 * Still never an UPSERT: nothing existing is modified. A password is not reset, a
 * name is not rewritten, a role is not swapped. The only writes are the rows that
 * were absent.
 *
 *   bun run create:account -- --tenant test --email verify@calendry.local \
 *       --name "Verify Bot" --role tenant-admin
 *   bun run create:account -- --tenant test --email already@on.roster --attach
 */
import { createInterface } from 'node:readline/promises';
import { hostname, userInfo } from 'node:os';
// The real hashing path, never a re-implementation — a second copy of the KDF
// drifts silently the moment the original changes.
import { hashPassword } from '../server/utils/auth';
import { createAccountRow, linkAccountToPerson } from '../server/utils/accountAdmin';
import { randomPassword } from '../shared/password';
import { resolveOwnerDatabaseUrl } from './lib/ownerDatabaseUrl';
import { arg, createOwnerPrisma, formatUnreachableDatabaseError, isUnreachableDatabaseError } from './lib/cli';

async function main() {
    const tenantSlug = arg('tenant');
    const email = arg('email')?.toLowerCase();
    const name = arg('name');
    const roleKey = arg('role') ?? 'tenant-admin';
    const suppliedPassword = arg('password');
    const skipConfirm = process.argv.includes('--yes');
    const attach = process.argv.includes('--attach');

    /*
     * `--name` is required only when a Person may have to be CREATED. With
     * `--attach` against somebody already on the roster it would be ignored, and
     * demanding it would make the common case ask for information the database
     * already holds — the sort of prompt people satisfy by typing anything.
     */
    if (!tenantSlug || !email || (!name && !attach)) {
        console.error(
            '\nUsage: bun run create:account -- --tenant <slug> --email <email> '
            + '[--name "Given Family"] [--role <accessRoleKey>] [--password <pw>] [--attach] [--yes]\n'
            + '\n  --attach  reuse an existing Person and/or Account with this email instead of\n'
            + '            refusing. Creates only the parts that are missing; changes nothing\n'
            + '            that already exists. --name is required without it.\n',
        );
        process.exit(1);
    }

    const connectionString = resolveOwnerDatabaseUrl();
    const prisma = createOwnerPrisma();

    try {
        const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });

        if (!tenant) {
            console.error(`\nNo tenant with slug '${tenantSlug}'.\n`);
            process.exit(1);
        }

        const accessRole = await prisma.accessRole.findFirst({
            where: { tenantId: tenant.id, key: roleKey },
            include: { _count: { select: { permissions: true } } },
        });

        // Named explicitly rather than created: inventing an access role here
        // would mean this script decides what a role may do, which is tenant
        // configuration (and the AccessRole section's job).
        if (!accessRole) {
            const available = await prisma.accessRole.findMany({
                where: { tenantId: tenant.id },
                select: { key: true },
            });

            console.error(`\nNo access role '${roleKey}' in tenant '${tenantSlug}'.`);
            console.error(`Available: ${available.map((r) => r.key).join(', ') || '(none)'}\n`);
            process.exit(1);
        }

        const existingAccount = await prisma.account.findUnique({ where: { email } });
        const existingPerson = await prisma.person.findFirst({
            where: { tenantId: tenant.id, email },
            include: {
                accountLink: { include: { account: { select: { id: true, email: true } } } },
                accessRoles: { where: { accessRoleId: accessRole.id }, select: { personId: true } },
            },
        });

        if (existingPerson && !attach) {
            console.error(`\nA Person with email '${email}' already exists in tenant '${tenantSlug}'.`);

            // Names the command that finishes the job. The version of this
            // message that did not was the whole complaint: the roster had the
            // person, the login was missing, and the tool said no.
            if (existingPerson.accountLink) {
                console.error('They already have a login too. Nothing here is missing — use '
                    + '`bun run reset:password` to issue a new password.\n');
            } else {
                console.error('They have no login yet. Re-run with --attach to create one for '
                    + 'them:\n\n  bun run create:account -- --tenant '
                    + `${tenantSlug} --email ${email} --attach\n`);
            }

            process.exit(1);
        }

        /*
         * A Person answering to a DIFFERENT Account is refused outright, with or
         * without `--attach`. `account_person` is `@@unique([personId])` on
         * purpose — two credentials controlling one tenant identity would make
         * every audit entry ambiguous — so this is not a rule to work around, and
         * the raw unique violation would say nothing about whose login it is.
         */
        if (
            existingPerson?.accountLink
            && existingAccount
            && existingPerson.accountLink.accountId !== existingAccount.id
        ) {
            console.error(`\n'${email}' is on the roster in '${tenantSlug}' but already answers to `
                + `the login '${existingPerson.accountLink.account.email}'. A person answers to `
                + 'exactly one account; detach or delete that login first.\n');
            process.exit(1);
        }

        const linkExists = Boolean(existingPerson?.accountLink);
        const roleExists = (existingPerson?.accessRoles.length ?? 0) > 0;

        /*
         * Nothing to do is reported and NOT treated as failure. It is the honest
         * answer to a re-run — the requested state already holds — and exiting
         * non-zero would make an idempotent provisioning script look broken.
         */
        if (existingPerson && linkExists && roleExists) {
            console.log(`\nNothing to do. '${email}' already has a Person, a login and the `
                + `'${accessRole.key}' role in '${tenantSlug}'.`);
            console.log('\nNothing was changed. To issue a new password: bun run reset:password '
                + `-- --email ${email}\n`);
            console.log(`AUDIT ${JSON.stringify({
                ts: new Date().toISOString(),
                action: 'account.unchanged',
                tenant: tenant.slug,
                email,
                personId: existingPerson.id,
                operator: `${userInfo().username}@${hostname()}`,
                via: 'cli:create-account',
            })}`);

            return;
        }

        /*
         * `--attach` against an email nobody holds still has to CREATE the
         * Person, and a Person with an empty name is a roster entry nothing can
         * identify. Checked here rather than in the usage block above because
         * only now is it known whether one exists.
         */
        if (!existingPerson && !name) {
            console.error(`\nNobody in '${tenantSlug}' has the email '${email}', so a Person has to `
                + 'be created — and that needs --name "Given Family".\n');
            process.exit(1);
        }

        const [givenName, ...rest] = (name ?? '').trim().split(/\s+/);
        const familyName = rest.join(' ') || givenName;

        const password = existingAccount ? null : (suppliedPassword ?? randomPassword());

        console.log(`\nTenant      ${tenant.slug} (${tenant.name})`);
        console.log(`Person      ${existingPerson
            ? `EXISTS — ${existingPerson.givenName} ${existingPerson.familyName} <${email}>, reused`
            : `${givenName} ${familyName} <${email}> — new`}`);
        console.log(`Access role ${accessRole.key} — ${accessRole._count.permissions} permission(s)`
            + `${roleExists ? ', already held' : ''}`);
        console.log(`Account     ${existingAccount
            ? 'EXISTS — this tenant is added to it; the password is NOT changed'
            : 'new'}`);
        console.log(`Link        ${linkExists ? 'already linked' : 'new account_person row'}`);
        console.log('');

        if (!skipConfirm) {
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const answer = await rl.question(`Apply this? Type the tenant slug to confirm (${tenantSlug}): `);

            rl.close();

            if (answer.trim() !== tenantSlug) {
                console.error('\nDoes not match. Nothing was created.\n');
                process.exit(1);
            }
        }

        const passwordHash = password ? await hashPassword(password) : null;

        /*
         * One transaction, and every write is conditional on the row being
         * absent. A Person with no Account, or an Account with no access role, is
         * a half-created login that fails confusingly later — and a partial
         * `--attach` would leave exactly that.
         */
        const created = await prisma.$transaction(async (tx) => {
            const person = existingPerson ?? (await tx.person.create({
                data: { tenantId: tenant.id, givenName, familyName, email },
            }));

            if (!roleExists) {
                await tx.personAccessRole.create({
                    data: { personId: person.id, accessRoleId: accessRole.id, tenantId: tenant.id },
                });
            }

            const account = existingAccount
                ?? (await createAccountRow(tx, {
                    email, passwordHash: passwordHash as string, mustChangePassword: true,
                }));

            if (!linkExists) {
                await linkAccountToPerson(tx, account.id, person.id);
            }

            return { person, account };
        });

        const record = {
            ts: new Date().toISOString(),
            action: 'account.created',
            tenant: tenant.slug,
            email,
            personId: created.person.id,
            accountId: created.account.id,
            accessRole: accessRole.key,
            reusedExistingAccount: Boolean(existingAccount),
            reusedExistingPerson: Boolean(existingPerson),
            grantedRole: !roleExists,
            linkedAccount: !linkExists,
            operator: `${userInfo().username}@${hostname()}`,
            via: 'cli:create-account',
        };

        console.log(`\nDone. person=${created.person.id}`);

        if (password) {
            console.log(`\n  Password: ${password}`);
            console.log('  Shown once, and must be changed at first sign-in. To issue a new one '
                + 'instead: `bun run reset:password`.\n');
        } else if (!linkExists) {
            console.log('\n  No new password: that login already existed and keeps the one it has.\n');
        }

        // Structured line for an external log sink. Deliberately not a database
        // table: the operator running this can rewrite any table here, so a
        // local audit row is not tamper-evident against the one actor it audits.
        console.log(`AUDIT ${JSON.stringify(record)}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (isUnreachableDatabaseError(message)) {
            console.error(formatUnreachableDatabaseError(connectionString));
        } else {
            console.error(`\nCreation failed, nothing was written: ${message}\n`);
        }

        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

await main();
