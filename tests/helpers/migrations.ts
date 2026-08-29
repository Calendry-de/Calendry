import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'prisma/migrations';

/**
 * Every migration's SQL, concatenated in the order Postgres applies it.
 *
 * READS THE DIRECTORY rather than naming a file, because a test that pins a
 * migration path breaks the moment the history is squashed — which is a
 * routine thing to do before 1.0 and has already happened once. The property
 * such tests actually care about is "this statement is somewhere in the DDL the
 * database was built from", and that survives any number of squashes.
 */
export function migrationSql(): string {
    return readdirSync(ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .map((name) => readFileSync(join(ROOT, name, 'migration.sql'), 'utf8'))
        .join('\n');
}

/**
 * The same, with `--` comments removed.
 *
 * Migrations in this repo explain themselves at length, and that prose names
 * the very tables, columns and flags a test is often asserting about — so a
 * naive search matches the explanation and passes whatever the SQL says. Two
 * assertions were silently vacuous for exactly this reason before the strip
 * existed; both were caught by mutating the statements and watching nothing
 * fail.
 */
export function migrationStatements(): string {
    return migrationSql().replace(/^\s*--.*$/gm, '');
}
