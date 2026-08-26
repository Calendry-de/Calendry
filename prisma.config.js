import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Optional: the runtime image has no application node_modules, so a static
// import here made `prisma migrate deploy` fail before reaching the database.
// A container gets its environment from compose; a host has .env and dotenv.
try {
  await import("dotenv/config");
} catch {
  // No dotenv, so no .env to load — the environment is already populated.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Migrations are schema-only; reference data arrives via seed.
    //
    // `prisma migrate reset` and `migrate dev` run this automatically, so a
    // rebuilt dev database is never left without its permission catalogue.
    // `migrate deploy` deliberately does NOT — production calls `prisma db seed`
    // explicitly, which both container entrypoints do.
    seed: "bun run prisma/seed.ts",
  },
  datasource: {
    // Migrations run as the OWNER role, not the runtime role. The runtime role
    // (DATABASE_URL) is deliberately powerless to create or alter tables, and
    // is subject to FORCE ROW LEVEL SECURITY — see the RLS migration.
    //
    // Same host-vs-container selection as scripts/lib/ownerDatabaseUrl.ts, which
    // carries the full explanation. Duplicated rather than imported because this
    // config is loaded by the Prisma CLI before any TypeScript is available.
    url: existsSync("/.dockerenv")
      ? (process.env.MIGRATION_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL_HOST)
      : (process.env.MIGRATION_DATABASE_URL_HOST ?? process.env.MIGRATION_DATABASE_URL),
  },
});