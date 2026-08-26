import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// dotenv is a HOST convenience, not a runtime dependency, and this used to be a
// static `import "dotenv/config"` — which meant the production image could not
// boot at all. The runner stage carries no application node_modules, so
// `prisma migrate deploy` died on the config's first line with "Cannot find
// module 'dotenv/config'" before it ever reached the database.
//
// In a container the environment is injected by compose; on a host it comes from
// .env and dotenv is present. Optional in exactly the shape that difference has.
// Awaited here rather than at the top of the file so the static imports stay
// first, and resolved before the config object below reads process.env.
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