-- ---------------------------------------------------------------------------
-- Calendry — the whole schema, in one migration
-- ---------------------------------------------------------------------------
--
-- Squashed from the 32 migrations that built it, pre-1.0. Nothing is deployed
-- from that history and no database exists that needs replaying onto, so the
-- history was cost without a reader: a bisect through DDL nobody will run.
--
-- ASSEMBLED BY CONCATENATION, NOT REGENERATED, and that distinction is the
-- whole reason this file is safe. `prisma migrate diff` / `migrate dev` emit
-- DDL derived from `schema.prisma`, which cannot express the RLS policies,
-- triggers, functions and partial indexes below — so a regenerated "initial"
-- migration silently DROPS every one of them. Every table still exists, every
-- test still passes, and tenant isolation is gone. See CLAUDE.md,
-- § "Database & migrations".
--
-- So this is the exact statement sequence Postgres already executed, in the
-- order it executed it. It is a REPLAY, which is why some columns are added
-- and later altered rather than declared once: that is evidence the file was
-- not hand-tidied, and hand-tidying is precisely how a policy goes missing.
--
-- Verified by dumping the schema before and after a full reset and diffing the
-- two — see the commit that introduced it.
--
-- Rebuild with `bun run db-reset`. Never `prisma migrate dev`.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- from 20260812000000_init_taxonomy
-- ===========================================================================
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "calendar_period_kind" AS ENUM ('HOLIDAY', 'BREAK', 'EXAM');

-- CreateEnum
CREATE TYPE "generation_source" AS ENUM ('SOLVER', 'MANUAL_BASELINE', 'IMPORT');

-- CreateEnum
CREATE TYPE "generation_status" AS ENUM ('PENDING', 'RUNNING', 'READY', 'APPLIED', 'FAILED', 'SUPERSEDED', 'INFEASIBLE');

-- CreateEnum
CREATE TYPE "session_event_type" AS ENUM ('CREATE', 'MOVE', 'SWAP', 'DELETE', 'LOCK', 'UNLOCK', 'APPLY_GENERATION');

-- CreateEnum
CREATE TYPE "constraint_severity" AS ENUM ('HARD', 'SOFT');

-- CreateTable
CREATE TABLE "federation" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "federation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant" (
    "id" TEXT NOT NULL,
    "federation_id" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "external_ref" TEXT,
    "given_name" TEXT NOT NULL,
    "family_name" TEXT NOT NULL,
    "email" TEXT,
    "timezone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_role" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "parent_group_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "expected_size" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_closure" (
    "ancestor_id" TEXT NOT NULL,
    "descendant_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,

    CONSTRAINT "group_closure_pkey" PRIMARY KEY ("ancestor_id","descendant_id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "federation_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT,
    "ranking" INTEGER NOT NULL DEFAULT 0,
    "is_virtual" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "federation_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_equipment" (
    "room_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "quantity" INTEGER,
    "tenant_id" TEXT,

    CONSTRAINT "room_equipment_pkey" PRIMARY KEY ("room_id","equipment_id")
);

-- CreateTable
CREATE TABLE "time_grid" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "block_length_minutes" INTEGER NOT NULL,
    "blocks_per_day" INTEGER NOT NULL,
    "active_days" INTEGER[],
    "start_hour" INTEGER NOT NULL DEFAULT 8,
    "start_minute" INTEGER NOT NULL DEFAULT 0,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "time_grid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "term" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "time_grid_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_period" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "term_id" TEXT NOT NULL,
    "kind" "calendar_period_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "calendar_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_kind" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "requires_group" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_kind_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offering" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "federation_id" TEXT,
    "term_id" TEXT NOT NULL,
    "kind_id" TEXT NOT NULL,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "duration_blocks" INTEGER NOT NULL DEFAULT 1,
    "required_role_id" TEXT,
    "required_capacity" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "offering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offering_group" (
    "offering_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "offering_group_pkey" PRIMARY KEY ("offering_id","group_id")
);

-- CreateTable
CREATE TABLE "offering_lecturer" (
    "offering_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "role_id" TEXT,

    CONSTRAINT "offering_lecturer_pkey" PRIMARY KEY ("offering_id","person_id")
);

-- CreateTable
CREATE TABLE "offering_equipment" (
    "offering_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "quantity" INTEGER,

    CONSTRAINT "offering_equipment_pkey" PRIMARY KEY ("offering_id","equipment_id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "offering_id" TEXT NOT NULL,
    "term_id" TEXT NOT NULL,
    "kind_id" TEXT NOT NULL,
    "time_grid_id" TEXT,
    "term_week" INTEGER NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "block_index" INTEGER NOT NULL,
    "duration_blocks" INTEGER NOT NULL DEFAULT 1,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "generation_id" TEXT,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_group" (
    "session_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "session_group_pkey" PRIMARY KEY ("session_id","group_id")
);

-- CreateTable
CREATE TABLE "session_person" (
    "session_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "role_id" TEXT,

    CONSTRAINT "session_person_pkey" PRIMARY KEY ("session_id","person_id")
);

-- CreateTable
CREATE TABLE "session_room" (
    "session_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "session_room_pkey" PRIMARY KEY ("session_id","room_id")
);

-- CreateTable
CREATE TABLE "constraint_def" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "severity" "constraint_severity" NOT NULL,
    "weight" INTEGER,
    "params" JSONB NOT NULL DEFAULT '{}',
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "constraint_def_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "constraint_scope" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "constraint_id" TEXT NOT NULL,
    "offering_id" TEXT,
    "kind_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "constraint_scope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "parent_generation_id" TEXT,
    "source" "generation_source" NOT NULL,
    "status" "generation_status" NOT NULL DEFAULT 'PENDING',
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "solver_meta" JSONB,
    "infeasibility_report" JSONB,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(3),

    CONSTRAINT "generation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_event" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "generation_id" TEXT NOT NULL,
    "type" "session_event_type" NOT NULL,
    "session_id" TEXT,
    "counterpart_session_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "actor_person_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "constraint_violation" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "constraint_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "severity" "constraint_severity" NOT NULL,
    "penalty" INTEGER,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "detected_by_event_id" TEXT,
    "generation_id" TEXT,
    "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "constraint_violation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_person" (
    "account_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_person_pkey" PRIMARY KEY ("account_id","person_id")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "active_person_id" TEXT,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,
    "ip_address" TEXT,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "access_role" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "access_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_role_permission" (
    "access_role_id" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "access_role_permission_pkey" PRIMARY KEY ("access_role_id","permission_key")
);

-- CreateTable
CREATE TABLE "person_access_role" (
    "person_id" TEXT NOT NULL,
    "access_role_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_access_role_pkey" PRIMARY KEY ("person_id","access_role_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "federation_slug_key" ON "federation"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE INDEX "tenant_federation_id_idx" ON "tenant"("federation_id");

-- CreateIndex
CREATE INDEX "person_tenant_id_idx" ON "person"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "person_tenant_id_email_key" ON "person"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "person_tenant_id_external_ref_key" ON "person"("tenant_id", "external_ref");

-- CreateIndex
CREATE INDEX "role_tenant_id_idx" ON "role"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_tenant_id_key_key" ON "role"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "person_role_tenant_id_idx" ON "person_role"("tenant_id");

-- CreateIndex
CREATE INDEX "person_role_role_id_idx" ON "person_role"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "person_role_person_id_role_id_key" ON "person_role"("person_id", "role_id");

-- CreateIndex
CREATE INDEX "group_tenant_id_idx" ON "group"("tenant_id");

-- CreateIndex
CREATE INDEX "group_parent_group_id_idx" ON "group"("parent_group_id");

-- CreateIndex
CREATE INDEX "group_closure_descendant_id_idx" ON "group_closure"("descendant_id");

-- CreateIndex
CREATE INDEX "group_closure_tenant_id_idx" ON "group_closure"("tenant_id");

-- CreateIndex
CREATE INDEX "membership_tenant_id_idx" ON "membership"("tenant_id");

-- CreateIndex
CREATE INDEX "membership_group_id_idx" ON "membership"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_person_id_group_id_key" ON "membership"("person_id", "group_id");

-- CreateIndex
CREATE INDEX "room_tenant_id_idx" ON "room"("tenant_id");

-- CreateIndex
CREATE INDEX "room_federation_id_idx" ON "room"("federation_id");

-- CreateIndex
CREATE INDEX "equipment_tenant_id_idx" ON "equipment"("tenant_id");

-- CreateIndex
CREATE INDEX "equipment_federation_id_idx" ON "equipment"("federation_id");

-- CreateIndex
CREATE INDEX "room_equipment_equipment_id_idx" ON "room_equipment"("equipment_id");

-- CreateIndex
CREATE INDEX "room_equipment_tenant_id_idx" ON "room_equipment"("tenant_id");

-- CreateIndex
CREATE INDEX "time_grid_tenant_id_idx" ON "time_grid"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "time_grid_tenant_id_name_key" ON "time_grid"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "term_tenant_id_idx" ON "term"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "term_tenant_id_name_key" ON "term"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "calendar_period_tenant_id_idx" ON "calendar_period"("tenant_id");

-- CreateIndex
CREATE INDEX "calendar_period_term_id_kind_idx" ON "calendar_period"("term_id", "kind");

-- CreateIndex
CREATE INDEX "session_kind_tenant_id_idx" ON "session_kind"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_kind_tenant_id_key_key" ON "session_kind"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "offering_tenant_id_idx" ON "offering"("tenant_id");

-- CreateIndex
CREATE INDEX "offering_federation_id_idx" ON "offering"("federation_id");

-- CreateIndex
CREATE INDEX "offering_term_id_idx" ON "offering"("term_id");

-- CreateIndex
CREATE INDEX "offering_group_group_id_idx" ON "offering_group"("group_id");

-- CreateIndex
CREATE INDEX "offering_group_tenant_id_idx" ON "offering_group"("tenant_id");

-- CreateIndex
CREATE INDEX "offering_lecturer_person_id_idx" ON "offering_lecturer"("person_id");

-- CreateIndex
CREATE INDEX "offering_lecturer_tenant_id_idx" ON "offering_lecturer"("tenant_id");

-- CreateIndex
CREATE INDEX "offering_equipment_equipment_id_idx" ON "offering_equipment"("equipment_id");

-- CreateIndex
CREATE INDEX "offering_equipment_tenant_id_idx" ON "offering_equipment"("tenant_id");

-- CreateIndex
CREATE INDEX "session_tenant_id_idx" ON "session"("tenant_id");

-- CreateIndex
CREATE INDEX "session_offering_id_idx" ON "session"("offering_id");

-- CreateIndex
CREATE INDEX "session_generation_id_idx" ON "session"("generation_id");

-- CreateIndex
CREATE INDEX "session_tenant_id_term_id_term_week_day_of_week_block_index_idx" ON "session"("tenant_id", "term_id", "term_week", "day_of_week", "block_index");

-- CreateIndex
CREATE INDEX "session_group_group_id_idx" ON "session_group"("group_id");

-- CreateIndex
CREATE INDEX "session_group_tenant_id_idx" ON "session_group"("tenant_id");

-- CreateIndex
CREATE INDEX "session_person_person_id_idx" ON "session_person"("person_id");

-- CreateIndex
CREATE INDEX "session_person_tenant_id_idx" ON "session_person"("tenant_id");

-- CreateIndex
CREATE INDEX "session_person_role_id_idx" ON "session_person"("role_id");

-- CreateIndex
CREATE INDEX "session_room_room_id_idx" ON "session_room"("room_id");

-- CreateIndex
CREATE INDEX "session_room_tenant_id_idx" ON "session_room"("tenant_id");

-- CreateIndex
CREATE INDEX "constraint_def_tenant_id_idx" ON "constraint_def"("tenant_id");

-- CreateIndex
CREATE INDEX "constraint_def_tenant_id_is_enabled_idx" ON "constraint_def"("tenant_id", "is_enabled");

-- CreateIndex
CREATE INDEX "constraint_scope_tenant_id_idx" ON "constraint_scope"("tenant_id");

-- CreateIndex
CREATE INDEX "constraint_scope_offering_id_idx" ON "constraint_scope"("offering_id");

-- CreateIndex
CREATE INDEX "constraint_scope_kind_id_idx" ON "constraint_scope"("kind_id");

-- CreateIndex
CREATE UNIQUE INDEX "constraint_scope_constraint_id_offering_id_kind_id_key" ON "constraint_scope"("constraint_id", "offering_id", "kind_id");

-- CreateIndex
CREATE INDEX "generation_tenant_id_idx" ON "generation"("tenant_id");

-- CreateIndex
CREATE INDEX "generation_parent_generation_id_idx" ON "generation"("parent_generation_id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_tenant_id_version_key" ON "generation"("tenant_id", "version");

-- CreateIndex
CREATE INDEX "session_event_tenant_id_seq_idx" ON "session_event"("tenant_id", "seq");

-- CreateIndex
CREATE INDEX "session_event_generation_id_idx" ON "session_event"("generation_id");

-- CreateIndex
CREATE INDEX "session_event_session_id_idx" ON "session_event"("session_id");

-- CreateIndex
CREATE INDEX "constraint_violation_tenant_id_severity_idx" ON "constraint_violation"("tenant_id", "severity");

-- CreateIndex
CREATE INDEX "constraint_violation_session_id_idx" ON "constraint_violation"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "constraint_violation_constraint_id_session_id_key" ON "constraint_violation"("constraint_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_email_key" ON "account"("email");

-- CreateIndex
CREATE UNIQUE INDEX "account_person_person_id_key" ON "account_person"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_token_hash_key" ON "auth_session"("token_hash");

-- CreateIndex
CREATE INDEX "auth_session_account_id_idx" ON "auth_session"("account_id");

-- CreateIndex
CREATE INDEX "auth_session_active_person_id_idx" ON "auth_session"("active_person_id");

-- CreateIndex
CREATE INDEX "permission_category_idx" ON "permission"("category");

-- CreateIndex
CREATE INDEX "access_role_tenant_id_idx" ON "access_role"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "access_role_tenant_id_key_key" ON "access_role"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "access_role_permission_permission_key_idx" ON "access_role_permission"("permission_key");

-- CreateIndex
CREATE INDEX "access_role_permission_tenant_id_idx" ON "access_role_permission"("tenant_id");

-- CreateIndex
CREATE INDEX "person_access_role_access_role_id_idx" ON "person_access_role"("access_role_id");

-- CreateIndex
CREATE INDEX "person_access_role_tenant_id_idx" ON "person_access_role"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_federation_id_fkey" FOREIGN KEY ("federation_id") REFERENCES "federation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person" ADD CONSTRAINT "person_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_role" ADD CONSTRAINT "person_role_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_role" ADD CONSTRAINT "person_role_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_role" ADD CONSTRAINT "person_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group" ADD CONSTRAINT "group_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group" ADD CONSTRAINT "group_parent_group_id_fkey" FOREIGN KEY ("parent_group_id") REFERENCES "group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_closure" ADD CONSTRAINT "group_closure_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_closure" ADD CONSTRAINT "group_closure_ancestor_id_fkey" FOREIGN KEY ("ancestor_id") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_closure" ADD CONSTRAINT "group_closure_descendant_id_fkey" FOREIGN KEY ("descendant_id") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room" ADD CONSTRAINT "room_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room" ADD CONSTRAINT "room_federation_id_fkey" FOREIGN KEY ("federation_id") REFERENCES "federation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_federation_id_fkey" FOREIGN KEY ("federation_id") REFERENCES "federation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_equipment" ADD CONSTRAINT "room_equipment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_equipment" ADD CONSTRAINT "room_equipment_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_equipment" ADD CONSTRAINT "room_equipment_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_grid" ADD CONSTRAINT "time_grid_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term" ADD CONSTRAINT "term_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term" ADD CONSTRAINT "term_time_grid_id_fkey" FOREIGN KEY ("time_grid_id") REFERENCES "time_grid"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_period" ADD CONSTRAINT "calendar_period_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_period" ADD CONSTRAINT "calendar_period_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_kind" ADD CONSTRAINT "session_kind_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering" ADD CONSTRAINT "offering_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering" ADD CONSTRAINT "offering_federation_id_fkey" FOREIGN KEY ("federation_id") REFERENCES "federation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering" ADD CONSTRAINT "offering_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering" ADD CONSTRAINT "offering_kind_id_fkey" FOREIGN KEY ("kind_id") REFERENCES "session_kind"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering" ADD CONSTRAINT "offering_required_role_id_fkey" FOREIGN KEY ("required_role_id") REFERENCES "role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_group" ADD CONSTRAINT "offering_group_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_group" ADD CONSTRAINT "offering_group_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_group" ADD CONSTRAINT "offering_group_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_lecturer" ADD CONSTRAINT "offering_lecturer_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_lecturer" ADD CONSTRAINT "offering_lecturer_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_lecturer" ADD CONSTRAINT "offering_lecturer_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_lecturer" ADD CONSTRAINT "offering_lecturer_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_equipment" ADD CONSTRAINT "offering_equipment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_equipment" ADD CONSTRAINT "offering_equipment_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_equipment" ADD CONSTRAINT "offering_equipment_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_kind_id_fkey" FOREIGN KEY ("kind_id") REFERENCES "session_kind"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_time_grid_id_fkey" FOREIGN KEY ("time_grid_id") REFERENCES "time_grid"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_group" ADD CONSTRAINT "session_group_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_group" ADD CONSTRAINT "session_group_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_group" ADD CONSTRAINT "session_group_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_person" ADD CONSTRAINT "session_person_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_person" ADD CONSTRAINT "session_person_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_person" ADD CONSTRAINT "session_person_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_person" ADD CONSTRAINT "session_person_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_room" ADD CONSTRAINT "session_room_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_room" ADD CONSTRAINT "session_room_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_room" ADD CONSTRAINT "session_room_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constraint_def" ADD CONSTRAINT "constraint_def_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constraint_scope" ADD CONSTRAINT "constraint_scope_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constraint_scope" ADD CONSTRAINT "constraint_scope_constraint_id_fkey" FOREIGN KEY ("constraint_id") REFERENCES "constraint_def"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constraint_scope" ADD CONSTRAINT "constraint_scope_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constraint_scope" ADD CONSTRAINT "constraint_scope_kind_id_fkey" FOREIGN KEY ("kind_id") REFERENCES "session_kind"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation" ADD CONSTRAINT "generation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation" ADD CONSTRAINT "generation_parent_generation_id_fkey" FOREIGN KEY ("parent_generation_id") REFERENCES "generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation" ADD CONSTRAINT "generation_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_event" ADD CONSTRAINT "session_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_event" ADD CONSTRAINT "session_event_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_event" ADD CONSTRAINT "session_event_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_event" ADD CONSTRAINT "session_event_counterpart_session_id_fkey" FOREIGN KEY ("counterpart_session_id") REFERENCES "session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_event" ADD CONSTRAINT "session_event_actor_person_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constraint_violation" ADD CONSTRAINT "constraint_violation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constraint_violation" ADD CONSTRAINT "constraint_violation_constraint_id_fkey" FOREIGN KEY ("constraint_id") REFERENCES "constraint_def"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constraint_violation" ADD CONSTRAINT "constraint_violation_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constraint_violation" ADD CONSTRAINT "constraint_violation_detected_by_event_id_fkey" FOREIGN KEY ("detected_by_event_id") REFERENCES "session_event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "constraint_violation" ADD CONSTRAINT "constraint_violation_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_person" ADD CONSTRAINT "account_person_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_person" ADD CONSTRAINT "account_person_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_active_person_id_fkey" FOREIGN KEY ("active_person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_role" ADD CONSTRAINT "access_role_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_role_permission" ADD CONSTRAINT "access_role_permission_access_role_id_fkey" FOREIGN KEY ("access_role_id") REFERENCES "access_role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_role_permission" ADD CONSTRAINT "access_role_permission_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permission"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_role_permission" ADD CONSTRAINT "access_role_permission_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_access_role" ADD CONSTRAINT "person_access_role_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_access_role" ADD CONSTRAINT "person_access_role_access_role_id_fkey" FOREIGN KEY ("access_role_id") REFERENCES "access_role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_access_role" ADD CONSTRAINT "person_access_role_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- from 20260812000100_rls_triggers_and_indexes
-- ===========================================================================
-- Pin the target schema before anything else: this file CREATEs the `calendry`
-- schema, which collides with the owner role name in the default search_path.
-- Without this, LANGUAGE sql function bodies (parsed at CREATE time) resolve
-- table names against the wrong schema.
SET search_path = public;

-- Calendry — database-layer invariants that Prisma's schema language cannot express.
--
-- ############################################################################
-- DO NOT REGENERATE THIS FILE. It is hand-written and CANNOT be recreated from
-- prisma/schema.prisma — the schema language cannot express RLS, triggers,
-- SECURITY DEFINER functions or partial indexes. `prisma migrate dev` will
-- happily produce an "equivalent" migration without any of it, leaving a
-- database with every table present and tenant isolation silently absent.
-- To rebuild a dev database, use `prisma migrate reset` (which REPLAYS these
-- files); never delete prisma/migrations and regenerate.
-- ############################################################################
--
-- Everything here is enforced by PostgreSQL, not by application code:
--   1. helper functions for request-scoped tenant context
--   2. the runtime app role (no ownership, DML only)
--   3. row-level security: tenant isolation + the narrow Federation exception
--   4. CHECK constraints, including exactly-one-owner on shared resources
--   5. group_closure maintenance trigger (TAXONOMY.md §6)
--   6. append-only enforcement on generation / session_event (TAXONOMY.md §3)
--   7. partial indexes on the solver's hot paths
--
-- The runtime connection MUST set tenant context per transaction:
--     SET LOCAL calendry.tenant_id = '<tenant uuid>';
--     SET LOCAL calendry.federation_id = '<federation uuid or empty>';
-- With no context set, every policy below evaluates to NULL and the session
-- sees zero rows. Failing closed is deliberate: a forgotten SET LOCAL must
-- leak nothing, not everything.

-- ---------------------------------------------------------------------------
-- 1. Tenant context helpers
-- ---------------------------------------------------------------------------

-- NOT named `calendry`: the database owner role is called `calendry`, and the
-- default search_path is ("$user", public). A schema sharing the role name
-- silently captures every unqualified CREATE — including Prisma's own
-- _prisma_migrations table, which is created before any migration SQL runs.
CREATE SCHEMA IF NOT EXISTS calendry_internal;

-- Ids are TEXT (Prisma uuid(7) maps to TEXT), so these return text, not uuid.
CREATE OR REPLACE FUNCTION calendry_internal.current_tenant_id() RETURNS text
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('calendry.tenant_id', true), '') $$;

CREATE OR REPLACE FUNCTION calendry_internal.current_federation_id() RETURNS text
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('calendry.federation_id', true), '') $$;

COMMENT ON FUNCTION calendry_internal.current_tenant_id() IS
    'Request-scoped tenant. NULL when unset, which makes every RLS policy fail closed.';

-- ---------------------------------------------------------------------------
-- 2. Runtime role
-- ---------------------------------------------------------------------------
-- Created NOLOGIN here so the migration is idempotent and password-free on any
-- database. The compose stack grants LOGIN + password via
-- .config/db-init/01-app-role.sh at cluster init.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calendry_app') THEN
        CREATE ROLE calendry_app NOLOGIN;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public, calendry_internal TO calendry_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO calendry_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO calendry_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA calendry_internal TO calendry_app;

-- The app role must never gain DDL rights, and never own a table — an owner
-- without FORCE would bypass RLS entirely.
REVOKE CREATE ON SCHEMA public FROM calendry_app;

-- History tables are append-only at the privilege level as well as by trigger.
REVOKE UPDATE, DELETE ON TABLE "session_event" FROM calendry_app;
REVOKE DELETE ON TABLE "generation" FROM calendry_app;

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------

-- 3a. Straightforward tenant-scoped tables: tenant_id IS NOT NULL, isolation is
--     a plain equality check. FORCE so that even the table owner obeys.
DO $$
DECLARE
    t text;
    tenant_scoped text[] := ARRAY[
        'person', 'role', 'person_role',
        'group', 'group_closure', 'membership',
        'time_grid', 'term', 'calendar_period', 'session_kind',
        'offering_group', 'offering_lecturer', 'offering_equipment',
        'session', 'session_group', 'session_person', 'session_room',
        'constraint_def', 'constraint_scope',
        'generation', 'session_event', 'constraint_violation',
        -- Authorization is tenant-scoped: an access role belongs to exactly one
        -- institution and must never be visible or assignable across tenants.
        'access_role', 'access_role_permission', 'person_access_role'
    ];
BEGIN
    FOREACH t IN ARRAY tenant_scoped LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I '
            'USING (tenant_id = calendry_internal.current_tenant_id()) '
            'WITH CHECK (tenant_id = calendry_internal.current_tenant_id())', t);
    END LOOP;
END $$;

-- 3b. Federation-ownable resources — the ONE deliberate exception to isolation
--     (TAXONOMY.md §2: a consortium's shared lecture hall, a cross-enrolled
--     elective). Readable when owned by your tenant OR by your federation.
--
--     WITH CHECK is deliberately narrower than USING: a tenant may only write
--     rows it owns outright. Creating or editing federation-owned resources is
--     a privileged path, not something a member tenant does incidentally.
DO $$
DECLARE
    t text;
    shared text[] := ARRAY['room', 'equipment', 'offering'];
BEGIN
    FOREACH t IN ARRAY shared LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_or_federation_read ON %I FOR SELECT '
            'USING (tenant_id = calendry_internal.current_tenant_id() '
            '       OR federation_id = calendry_internal.current_federation_id())', t);
        EXECUTE format(
            'CREATE POLICY tenant_write ON %I FOR ALL '
            'USING (tenant_id = calendry_internal.current_tenant_id()) '
            'WITH CHECK (tenant_id = calendry_internal.current_tenant_id())', t);
    END LOOP;
END $$;

-- 3c. room_equipment inherits its room's ownership: tenant_id is NULL for tags
--     on a federation-owned room.
ALTER TABLE "room_equipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_equipment" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_or_federation_read ON "room_equipment" FOR SELECT
    USING (
        tenant_id = calendry_internal.current_tenant_id()
        OR EXISTS (
            SELECT 1 FROM "room" r
            WHERE r.id = "room_equipment".room_id
              AND r.federation_id = calendry_internal.current_federation_id()
        )
    );

CREATE POLICY tenant_write ON "room_equipment" FOR ALL
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

-- 3d. The organizational tables themselves.
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_self_or_sibling ON "tenant" FOR SELECT
    USING (
        id = calendry_internal.current_tenant_id()
        OR federation_id = calendry_internal.current_federation_id()
    );

CREATE POLICY tenant_self_write ON "tenant" FOR ALL
    USING (id = calendry_internal.current_tenant_id())
    WITH CHECK (id = calendry_internal.current_tenant_id());

ALTER TABLE "federation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "federation" FORCE ROW LEVEL SECURITY;

-- Read-only to member tenants; federation administration is a privileged path.
CREATE POLICY federation_member_read ON "federation" FOR SELECT
    USING (id = calendry_internal.current_federation_id());

-- ---------------------------------------------------------------------------
-- 4. CHECK constraints
-- ---------------------------------------------------------------------------

-- Exactly one owner on shared resources. This is what makes the Federation
-- exception narrow and explicit rather than "tenant_id is nullable everywhere".
ALTER TABLE "room" ADD CONSTRAINT room_single_owner
    CHECK ((tenant_id IS NULL) <> (federation_id IS NULL));
ALTER TABLE "equipment" ADD CONSTRAINT equipment_single_owner
    CHECK ((tenant_id IS NULL) <> (federation_id IS NULL));
ALTER TABLE "offering" ADD CONSTRAINT offering_single_owner
    CHECK ((tenant_id IS NULL) <> (federation_id IS NULL));

-- A soft constraint must carry a penalty weight; a hard one must not.
ALTER TABLE "constraint_def" ADD CONSTRAINT constraint_weight_matches_severity
    CHECK (
        (severity = 'HARD' AND weight IS NULL)
        OR (severity = 'SOFT' AND weight IS NOT NULL)
    );

-- An all-NULL scope row would silently read as "applies to everything", which
-- is already expressed by having no scope rows at all.
ALTER TABLE "constraint_scope" ADD CONSTRAINT constraint_scope_not_empty
    CHECK (offering_id IS NOT NULL OR kind_id IS NOT NULL);

-- A group cannot be its own parent. Deeper cycles are caught by trigger.
ALTER TABLE "group" ADD CONSTRAINT group_no_self_parent
    CHECK (parent_group_id IS DISTINCT FROM id);

-- Placement coordinates are grid-relative and must stay in range. Actual
-- bounds resolve against the tenant's TimeGrid; these are the absolute floors.
ALTER TABLE "session" ADD CONSTRAINT session_placement_sane
    CHECK (
        term_week >= 1
        AND day_of_week BETWEEN 1 AND 7
        AND block_index >= 0
        AND duration_blocks >= 1
    );

ALTER TABLE "time_grid" ADD CONSTRAINT time_grid_shape_sane
    CHECK (
        block_length_minutes > 0
        AND blocks_per_day > 0
        AND start_hour BETWEEN 0 AND 23
        AND start_minute BETWEEN 0 AND 59
        AND break_minutes >= 0
    );

ALTER TABLE "term" ADD CONSTRAINT term_dates_ordered
    CHECK (end_date >= start_date);
ALTER TABLE "calendar_period" ADD CONSTRAINT calendar_period_dates_ordered
    CHECK (end_date >= start_date);

ALTER TABLE "offering" ADD CONSTRAINT offering_frequency_positive
    CHECK (frequency >= 1 AND duration_blocks >= 1);

ALTER TABLE "room" ADD CONSTRAINT room_capacity_non_negative
    CHECK (capacity >= 0);

-- ---------------------------------------------------------------------------
-- 5. Nested groups: closure table maintenance (TAXONOMY.md §6, §9.3)
-- ---------------------------------------------------------------------------
-- Write-time recompute. Conflict checks and notification fan-out are
-- read-heavy and both need the full ancestor+descendant set; group trees change
-- rarely. Maintained by trigger so the closure cannot drift when rows are
-- touched outside Prisma.

CREATE OR REPLACE FUNCTION calendry_internal.group_closure_after_insert() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    -- Self-pair at depth 0, so "G and everything conflicting with G" is one lookup.
    INSERT INTO "group_closure" (ancestor_id, descendant_id, tenant_id, depth)
    VALUES (NEW.id, NEW.id, NEW.tenant_id, 0);

    IF NEW.parent_group_id IS NOT NULL THEN
        INSERT INTO "group_closure" (ancestor_id, descendant_id, tenant_id, depth)
        SELECT c.ancestor_id, NEW.id, NEW.tenant_id, c.depth + 1
        FROM "group_closure" c
        WHERE c.descendant_id = NEW.parent_group_id;
    END IF;

    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION calendry_internal.group_closure_before_reparent() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    -- Reject cycles: the new parent must not already be a descendant.
    IF NEW.parent_group_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM "group_closure"
        WHERE ancestor_id = NEW.id
          AND descendant_id = NEW.parent_group_id
    ) THEN
        RAISE EXCEPTION
            'group % cannot be reparented under %: that would create a cycle',
            NEW.id, NEW.parent_group_id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION calendry_internal.group_closure_after_reparent() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    -- Detach the moved subtree from its former ancestors, keeping the pairs
    -- that live entirely inside the subtree.
    DELETE FROM "group_closure"
    WHERE descendant_id IN (
              SELECT descendant_id FROM "group_closure" WHERE ancestor_id = NEW.id
          )
      AND ancestor_id NOT IN (
              SELECT descendant_id FROM "group_closure" WHERE ancestor_id = NEW.id
          );

    -- Reattach: every new ancestor × every node of the moved subtree.
    IF NEW.parent_group_id IS NOT NULL THEN
        INSERT INTO "group_closure" (ancestor_id, descendant_id, tenant_id, depth)
        SELECT sup.ancestor_id, sub.descendant_id, NEW.tenant_id, sup.depth + sub.depth + 1
        FROM "group_closure" sup
        CROSS JOIN "group_closure" sub
        WHERE sup.descendant_id = NEW.parent_group_id
          AND sub.ancestor_id = NEW.id
        ON CONFLICT (ancestor_id, descendant_id) DO NOTHING;
    END IF;

    RETURN NULL;
END $$;

CREATE TRIGGER group_closure_insert
    AFTER INSERT ON "group"
    FOR EACH ROW EXECUTE FUNCTION calendry_internal.group_closure_after_insert();

CREATE TRIGGER group_closure_reparent_guard
    BEFORE UPDATE OF parent_group_id ON "group"
    FOR EACH ROW
    WHEN (NEW.parent_group_id IS DISTINCT FROM OLD.parent_group_id)
    EXECUTE FUNCTION calendry_internal.group_closure_before_reparent();

CREATE TRIGGER group_closure_reparent
    AFTER UPDATE OF parent_group_id ON "group"
    FOR EACH ROW
    WHEN (NEW.parent_group_id IS DISTINCT FROM OLD.parent_group_id)
    EXECUTE FUNCTION calendry_internal.group_closure_after_reparent();

-- ---------------------------------------------------------------------------
-- 6. Append-only history (TAXONOMY.md §3)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION calendry_internal.deny_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION
        '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER session_event_append_only
    BEFORE UPDATE OR DELETE ON "session_event"
    FOR EACH ROW EXECUTE FUNCTION calendry_internal.deny_mutation();

CREATE TRIGGER generation_no_delete
    BEFORE DELETE ON "generation"
    FOR EACH ROW EXECUTE FUNCTION calendry_internal.deny_mutation();

-- A Generation's CONTENT is immutable; its lifecycle is not. status,
-- is_current, applied_at and infeasibility_report legitimately change as a
-- solver run progresses (PENDING → RUNNING → READY → APPLIED). Everything that
-- defines what the snapshot *is* stays frozen.
CREATE OR REPLACE FUNCTION calendry_internal.generation_content_immutable() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.parent_generation_id IS DISTINCT FROM OLD.parent_generation_id
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.solver_meta IS DISTINCT FROM OLD.solver_meta
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
    THEN
        RAISE EXCEPTION
            'generation % is immutable: only status, is_current, applied_at and infeasibility_report may change',
            OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER generation_content_immutable
    BEFORE UPDATE ON "generation"
    FOR EACH ROW EXECUTE FUNCTION calendry_internal.generation_content_immutable();

-- ---------------------------------------------------------------------------
-- 7. Partial indexes on hot paths
-- ---------------------------------------------------------------------------

-- The solver's exclusion query: "give me the unlocked sessions to re-place".
-- A locked Session is never overwritten (TAXONOMY.md §3), so the index only
-- carries the rows the solver can actually touch.
CREATE INDEX session_unlocked_placement_idx
    ON "session" (tenant_id, term_id, term_week, day_of_week, block_index)
    WHERE is_locked = false;

-- Complement: the UI's "what is pinned here" lookup.
CREATE INDEX session_locked_idx
    ON "session" (tenant_id, term_id)
    WHERE is_locked = true;

-- Exactly one current Generation per tenant.
CREATE UNIQUE INDEX generation_one_current_per_tenant
    ON "generation" (tenant_id)
    WHERE is_current = true;

-- The "current violations" view is almost always filtered to unresolved hard
-- breaches first (TAXONOMY.md §3 warn-and-allow).
CREATE INDEX constraint_violation_hard_idx
    ON "constraint_violation" (tenant_id, detected_at DESC)
    WHERE severity = 'HARD';

-- Double-booking checks resolve room/person collisions per placement slot.
CREATE INDEX session_room_conflict_idx ON "session_room" (room_id, session_id);
CREATE INDEX session_person_conflict_idx ON "session_person" (person_id, session_id);

-- Event replay ordering (TAXONOMY.md §3 rollback).
CREATE INDEX session_event_replay_idx
    ON "session_event" (tenant_id, generation_id, created_at, seq);

-- ---------------------------------------------------------------------------
-- 8. Authentication: the pre-tenant data plane (DELIBERATELY WITHOUT RLS)
-- ---------------------------------------------------------------------------
--
-- account, account_person and auth_session carry NO row-level security, and
-- that is the second documented exception to tenant isolation in this system
-- (the first being Federation-owned resources).
--
-- It is structural, not a shortcut: a session must be read BEFORE the tenant is
-- known, because the session is what DETERMINES the tenant. Any policy on these
-- tables would compare against a context that does not exist yet and would
-- therefore reject every login attempt.
--
-- The safety property that replaces RLS here is access shape: these tables are
-- only ever read by primary key or by unique token hash taken from a verified
-- cookie, never by tenant filter, and no route exposes them directly. The token
-- itself is never stored — only its SHA-256 — so read access to this table does
-- not confer the ability to impersonate a session.
--
-- auth_session.active_person_id is what binds a session to a tenant. Everything
-- downstream derives calendry.tenant_id from that Person server-side; the
-- client never supplies a tenant.

COMMENT ON TABLE "account" IS
    'Pre-tenant plane: no RLS by design. Tenant-independent login identity.';
COMMENT ON TABLE "account_person" IS
    'Pre-tenant plane: no RLS by design. Maps one login to its per-tenant Person rows.';
COMMENT ON TABLE "auth_session" IS
    'Pre-tenant plane: no RLS by design. Read before tenant context exists.';

-- Sessions are looked up on every request by token hash, and expired ones are
-- swept in the background.
CREATE INDEX auth_session_active_idx
    ON "auth_session" (expires_at)
    WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 9. Permission catalogue table (STRUCTURE ONLY — no rows)
-- ---------------------------------------------------------------------------
--
-- Migrations are schema-only. The 53 catalogue rows are reference data and are
-- populated by `prisma db seed` (prisma/seeds/reference/permissions.ts), which
-- both container entrypoints run immediately after `migrate deploy`.
--
-- The count is descriptive, not a contract: the catalogue is code
-- (shared/permissions.ts) and grows. It said 46 until Step 14, which is the
-- hazard of writing a number into a file that can never be re-run — this
-- migration is applied everywhere and editing its SQL would be a checksum
-- failure, so only the comment can ever be corrected.
--
-- A freshly migrated database therefore has an EMPTY permission table, and
-- provisioning a tenant against it fails on the access_role_permission foreign
-- key. That is intentional and loud: the alternative is a half-configured
-- system that looks fine until someone is denied an action they should have.

ALTER TABLE "permission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "permission" FORCE ROW LEVEL SECURITY;

-- Readable by everyone, writable by no one at runtime. The seed writes it on
-- the OWNER connection, which bypasses RLS as a superuser; the app role is
-- refused by this policy, which is the intended protection — the runtime must
-- never mutate the set of actions it is authorized against.
CREATE POLICY permission_read_only ON "permission" FOR SELECT USING (true);


-- ---------------------------------------------------------------------------
-- 10. Bridging the two planes: narrow SECURITY DEFINER lookups
-- ---------------------------------------------------------------------------
--
-- Login has a genuine chicken-and-egg problem. Resolving a session requires
-- reading `person` (to learn the tenant), but `person` is behind RLS and RLS
-- needs the tenant that the read is trying to discover. Without a bridge,
-- authentication can never succeed.
--
-- These two functions are that bridge, and they are deliberately the ONLY
-- RLS-bypassing path in the system. Both are SECURITY DEFINER (so they execute
-- as the owner and are not filtered), and both are parameterised solely by a
-- secret the caller must already possess — an account id obtained from a
-- verified session, or a session token hash. Neither accepts a tenant id, so
-- neither can be coaxed into enumerating another tenant's rows.
--
-- search_path is pinned so a malicious schema earlier on the path cannot
-- shadow the tables these functions read.

CREATE OR REPLACE FUNCTION calendry_internal.session_identity(p_token_hash text)
RETURNS TABLE (
    session_id      text,
    account_id      text,
    person_id       text,
    tenant_id       text,
    federation_id   text,
    expires_at      timestamptz,
    revoked_at      timestamptz,
    account_active  boolean,
    person_active   boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $fn$
    SELECT
        s.id, s.account_id, s.active_person_id,
        p.tenant_id, t.federation_id,
        s.expires_at, s.revoked_at,
        a.is_active, COALESCE(p.is_active, false)
    FROM auth_session s
    JOIN account a ON a.id = s.account_id
    LEFT JOIN person p ON p.id = s.active_person_id
    LEFT JOIN tenant t ON t.id = p.tenant_id
    WHERE s.token_hash = p_token_hash
$fn$;

CREATE OR REPLACE FUNCTION calendry_internal.account_identities(p_account_id text)
RETURNS TABLE (
    person_id     text,
    given_name    text,
    family_name   text,
    person_active boolean,
    tenant_id     text,
    tenant_slug   text,
    tenant_name   text,
    federation_id text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $fn$
    SELECT
        p.id, p.given_name, p.family_name, p.is_active,
        t.id, t.slug, t.name, t.federation_id
    FROM account_person ap
    JOIN person p ON p.id = ap.person_id
    JOIN tenant t ON t.id = p.tenant_id
    WHERE ap.account_id = p_account_id
    ORDER BY t.name
$fn$;

-- Not executable by the world; only the runtime role may call them.
REVOKE EXECUTE ON FUNCTION calendry_internal.session_identity(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION calendry_internal.account_identities(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendry_internal.session_identity(text) TO calendry_app;
GRANT EXECUTE ON FUNCTION calendry_internal.account_identities(text) TO calendry_app;


-- ===========================================================================
-- from 20260813190131_init
-- ===========================================================================
-- DropIndex
DROP INDEX "session_event_replay_idx";

-- DropIndex
DROP INDEX "session_person_conflict_idx";

-- DropIndex
DROP INDEX "session_room_conflict_idx";


-- ===========================================================================
-- from 20260814120000_time_grid_single_default
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- At most one default TimeGrid per tenant.
-- ---------------------------------------------------------------------------
--
-- HAND-WRITTEN. Like 20260812000100, this cannot be produced by
-- `prisma migrate diff` — the Prisma schema language cannot express a partial
-- unique index, so a regenerated "equivalent" migration would omit it and the
-- constraint would silently disappear. Do not regenerate.
--
-- WHY THIS IS A CONSTRAINT AND NOT A UI RULE
-- ------------------------------------------
-- `time_grid.is_default` had no uniqueness of any kind, and the schedule view
-- resolves its grid with:
--
--     grids.find(g => g.id === term.timeGridId)
--       ?? grids.find(g => g.isDefault)      <-- takes the FIRST of however many
--       ?? grids[0]
--
-- With two defaults that `find` picks one arbitrarily, by whatever order the
-- API happened to return. The whole timetable would then render against a grid
-- the tenant did not choose, with nothing anywhere reporting a problem — a
-- wrong answer that looks exactly like a right one.
--
-- Step 13 adds a TimeGrid editor with an `is_default` toggle, which makes this
-- state reachable by clicking rather than only by hand-written SQL. Enforcing
-- it in the UI alone would leave the API and the import path free to create it.
--
-- FAILURE MODE IS DELIBERATE AND LOUD
-- -----------------------------------
-- If a database already holds two defaults for one tenant, this migration FAILS
-- and applies nothing, naming the duplicate. That is correct: which of the two
-- is meant is a decision only the operator can make, and silently demoting one
-- would be this file choosing a timetable on their behalf. No data is modified
-- here — that would be a seed's job, not a migration's.

SET search_path = public;

CREATE UNIQUE INDEX time_grid_one_default_per_tenant
    ON "time_grid" (tenant_id)
    WHERE is_default = true;


-- ===========================================================================
-- from 20260816120000_solver_run
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- solver_run — the app's record of one request to calendry-solver.
-- ---------------------------------------------------------------------------
--
-- HAND-WRITTEN. Prisma can generate the table, but not the RLS policy and not
-- the partial unique index that enforces the concurrency rule. A regenerated
-- "equivalent" migration would emit a table with neither, producing a database
-- where the solver surface exists, tenant isolation is silently absent, and two
-- concurrent runs per term are permitted — with every test still passing.
-- Do not regenerate.

SET search_path = public;

-- ---------------------------------------------------------------------------
-- 1. Type and table
-- ---------------------------------------------------------------------------

-- Mirrors calendry.solver.v1.RunStatus plus PENDING, the window between writing
-- the row and StartRun being acknowledged. Deliberately NO
-- "succeeded_with_violations": RunStatus describes the run's lifecycle, not the
-- solution's quality (TAXONOMY.md §3 warn-and-allow, and the proto's own
-- comment). Residual violations belong to the result, not to this column.
CREATE TYPE "solver_run_status" AS ENUM (
    'PENDING', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'CANCELLED', 'FAILED'
);

CREATE TABLE "solver_run" (
    "id"                 TEXT NOT NULL,
    "tenant_id"          TEXT NOT NULL,
    "term_id"            TEXT NOT NULL,

    "external_run_id"    TEXT,
    "status"             "solver_run_status" NOT NULL DEFAULT 'PENDING',
    "scope"              JSONB NOT NULL DEFAULT '{}',

    -- Reproducibility inputs. seed is what the solver reported USING.
    "seed"               BIGINT,
    "max_wall_millis"    INTEGER,
    "max_moves"          BIGINT,

    -- Last GetStatus snapshot; overwritten per poll.
    "progress"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "best_objective"     DOUBLE PRECISION,
    "moves_evaluated"    BIGINT,
    "elapsed_millis"     INTEGER,
    "termination_reason" TEXT,

    "error_detail"       TEXT,

    -- Stage 5 fills this. Nullable and unused until then.
    "generation_id"      TEXT,

    "meta"               JSONB NOT NULL DEFAULT '{}',

    "requested_by_id"    TEXT,
    "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at"         TIMESTAMPTZ(3),
    "finished_at"        TIMESTAMPTZ(3),
    "last_polled_at"     TIMESTAMPTZ(3),

    CONSTRAINT "solver_run_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "solver_run"
    ADD CONSTRAINT "solver_run_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solver_run"
    ADD CONSTRAINT "solver_run_term_id_fkey"
    FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solver_run"
    ADD CONSTRAINT "solver_run_generation_id_fkey"
    FOREIGN KEY ("generation_id") REFERENCES "generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "solver_run"
    ADD CONSTRAINT "solver_run_requested_by_id_fkey"
    FOREIGN KEY ("requested_by_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "solver_run_tenant_id_idx"         ON "solver_run" ("tenant_id");
CREATE INDEX "solver_run_tenant_id_term_id_idx" ON "solver_run" ("tenant_id", "term_id");
CREATE INDEX "solver_run_generation_id_idx"     ON "solver_run" ("generation_id");

-- ---------------------------------------------------------------------------
-- 2. THE CONCURRENCY RULE: one active run per term per tenant
-- ---------------------------------------------------------------------------
--
-- An index rather than an application check, because the alternative is a
-- TOCTOU race: two simultaneous requests both run `findFirst`, both see no
-- active run, and both insert. Here the second INSERT fails with 23505 and the
-- route turns that into a 409 naming the run already in flight.
--
-- PENDING is included on purpose. The row is written BEFORE StartRun is called,
-- precisely so this index can reject a concurrent second attempt during the
-- call — leaving PENDING out would reopen the window it exists to close.
--
-- The corollary the API must honour: a StartRun that fails at the transport
-- level has to resolve its PENDING row to FAILED, or a solver outage would
-- block that term until someone edited the database by hand.
CREATE UNIQUE INDEX "solver_run_one_active_per_term"
    ON "solver_run" ("tenant_id", "term_id")
    WHERE "status" IN ('PENDING', 'QUEUED', 'RUNNING');

-- ---------------------------------------------------------------------------
-- 3. Tenant isolation
-- ---------------------------------------------------------------------------
--
-- Same policy shape as every other tenant-scoped table. Written out rather than
-- added to the array in 20260812000100 because that migration is already
-- applied — this table did not exist when that loop ran.
ALTER TABLE "solver_run" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "solver_run" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "solver_run"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

-- The blanket GRANT in 20260812000100 applied to tables existing at that time.
GRANT SELECT, INSERT, UPDATE, DELETE ON "solver_run" TO calendry_app;


-- ===========================================================================
-- from 20260816130000_solver_run_reference_slot
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- solver_run: record what the run was actually asked, not just what it answered.
-- ---------------------------------------------------------------------------
--
-- reference_slot is derived from "now", so it is the one input that cannot be
-- reconstructed later. Without storing it, "same input, same seed, same move
-- budget produces byte-identical output" becomes quietly false on any replay:
-- the snapshot would be rebuilt against a different present.
--
-- input_hash is a SHA-256 over the serialized SolverInput. It does not make a
-- run replayable on its own — it makes the QUESTION answerable. "Did this run
-- see the same problem as that one?" is otherwise a guess, and two runs that
-- differ for an unnoticed data reason look exactly like solver nondeterminism.

SET search_path = public;

ALTER TABLE "solver_run"
    ADD COLUMN "reference_slot" JSONB,
    ADD COLUMN "input_hash"     TEXT;

-- Cheap way to spot runs solving an identical problem (a re-run after no data
-- change), which is what makes a determinism comparison meaningful.
CREATE INDEX "solver_run_input_hash_idx" ON "solver_run" ("tenant_id", "input_hash");


-- ===========================================================================
-- from 20260816140000_offering_allow_online
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- offering.allow_online — may the solver place this Offering in a virtual Room?
-- ---------------------------------------------------------------------------
--
-- The proto's Offering carries `allow_online`, and the app had no equivalent.
-- Without it the only honest value to send is false, which silently disables
-- online scheduling entirely: the solver would never place anything in a
-- virtual Room, and the three online-related constraints (OnlineOnsiteSameDay,
-- MaxOnlineShare, MinimizeOnline) would be transmitted but could never bind.
--
-- Online delivery is modelled as a virtual Room rather than a flag on the
-- Session (TAXONOMY.md §2), so this is NOT "is this session online" — it is
-- permission for the solver to choose a virtual Room when placing it. An
-- in-person exam should leave it false; a lecture that could run either way
-- sets it true.
--
-- Defaults to false: the conservative direction. A tenant opting an Offering
-- into online delivery is a decision someone makes, not one a migration makes
-- on their behalf.

SET search_path = public;

ALTER TABLE "offering"
    ADD COLUMN "allow_online" BOOLEAN NOT NULL DEFAULT false;


-- ===========================================================================
-- from 20260816150000_solver_run_polling
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- solver_run: polling schedule and captured result.
-- ---------------------------------------------------------------------------
--
-- next_poll_at makes the CADENCE DATA rather than code. It survives a restart,
-- it is queryable when a run looks stuck, and it turns the poller into a
-- "find runs due now" query instead of per-run timers held in memory.
--
-- result captures the solver's SolverOutput the moment a run reaches a terminal
-- state. This is not premature: the solver's run registry is an in-memory map
-- with NO persistence and NO eviction, so a restart loses every result it still
-- holds. If the app waits until someone asks to apply a Generation (Stage 5),
-- the answer may simply be gone. Capturing here makes Stage 5 a pure
-- database→database transform with no solver dependency and no time pressure on
-- human review.

SET search_path = public;

ALTER TABLE "solver_run"
    ADD COLUMN "next_poll_at" TIMESTAMPTZ(3),
    ADD COLUMN "result"       JSONB;

-- The poller's only hot query: active runs whose next poll is due. Partial, so
-- the index stays the size of the in-flight set rather than of all history.
CREATE INDEX "solver_run_due_idx"
    ON "solver_run" ("next_poll_at")
    WHERE "status" IN ('PENDING', 'QUEUED', 'RUNNING');


-- ===========================================================================
-- from 20260816160000_solver_poll_tenant_lookup
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- The THIRD (and only the third) RLS-bypassing function in the system.
-- ---------------------------------------------------------------------------
--
-- WHY ANOTHER ONE EXISTS AT ALL
--
-- The background solver poller runs when nobody is logged in. There is no
-- tenant context, so `calendry_internal.current_tenant_id()` is NULL and the
-- app role sees ZERO rows in both `solver_run` and `tenant` — the fail-closed
-- design working exactly as intended. A job that must advance runs across every
-- tenant therefore cannot see the work it exists to do.
--
-- That is structurally the same class of exception as the two existing
-- functions, not a convenience: `session_identity()` and `account_identities()`
-- exist because a session must be read BEFORE the tenant is known, and this one
-- exists because a background job acts when no tenant is known at all. Both sit
-- outside the tenant-request model by nature.
--
-- WHAT KEEPS THE SURFACE SMALL
--
--   * It returns TENANT IDS ONLY. No run rows, no scopes, no results, no
--     inputs. Everything the poller then does happens inside an ordinary
--     withTenant() transaction under RLS, including the claim and every write.
--   * It takes NO PARAMETERS, so it cannot be steered at a chosen tenant or
--     coaxed into enumerating anything the caller names.
--   * It answers one narrow question — "which tenants have a solver run due
--     right now?" — and returns nothing when the answer is none.
--
-- Do not widen it to return the runs themselves. That was considered and
-- rejected: it would move the atomic claim into SQL and carry run data across
-- the boundary, for a saving of one round trip per tenant per tick.

SET search_path = public;

CREATE OR REPLACE FUNCTION calendry_internal.tenants_with_due_solver_runs()
RETURNS TABLE (tenant_id text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $fn$
    SELECT DISTINCT sr.tenant_id
    FROM solver_run sr
    WHERE sr.status IN ('PENDING', 'QUEUED', 'RUNNING')
      AND (sr.next_poll_at IS NULL OR sr.next_poll_at <= now())
$fn$;

REVOKE ALL ON FUNCTION calendry_internal.tenants_with_due_solver_runs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendry_internal.tenants_with_due_solver_runs() TO calendry_app;


-- ===========================================================================
-- from 20260816170000_violation_offering_scope
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- constraint_violation: allow violations that are not about a single Session.
-- ---------------------------------------------------------------------------
--
-- WHY
--
-- Warn-and-allow says a SUCCEEDED solver run carrying residual hard violations
-- is still an applicable Generation, with the violations surfaced through this
-- table. The case that decision explicitly cited — ExactFrequency, "this
-- Offering needs 6 Sessions and only 4 were placed" — has NO session to point
-- at. Observed verbatim from the solver in Stage 1:
--
--     ExactFrequency  sessions=[]  offerings=[offering-algorithms]
--                     — requires 60 session(s), 40 placed
--
-- With session_id NOT NULL that violation simply could not be recorded, so the
-- schema quietly contradicted the decision.
--
-- TWO CHANGES, AND WHY THE SECOND IS NOT OPTIONAL
--
-- 1. session_id becomes nullable.
-- 2. offering_id is added. Without it "constraint X is violated, no session"
--    is unactionable — the whole content of an ExactFrequency breach is WHICH
--    offering is short.
--
-- THE UNIQUE INDEX NEEDS `NULLS NOT DISTINCT`
--
-- Postgres treats NULLs as distinct in a unique index by default, so
-- (constraint, NULL, offering) would not conflict with itself and every refresh
-- would append another identical row. Postgres 15+ supports NULLS NOT DISTINCT,
-- and this database is 18 — so the upsert key keeps working for both shapes.

SET search_path = public;

ALTER TABLE "constraint_violation"
    ALTER COLUMN "session_id" DROP NOT NULL,
    ADD COLUMN "offering_id" TEXT;

ALTER TABLE "constraint_violation"
    ADD CONSTRAINT "constraint_violation_offering_id_fkey"
    FOREIGN KEY ("offering_id") REFERENCES "offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "constraint_violation_constraint_id_session_id_key";

CREATE UNIQUE INDEX "constraint_violation_constraint_id_session_id_offering_id_key"
    ON "constraint_violation" ("constraint_id", "session_id", "offering_id")
    NULLS NOT DISTINCT;

CREATE INDEX "constraint_violation_offering_id_idx" ON "constraint_violation" ("offering_id");

-- A violation must be about SOMETHING. Both null would be a row that says a
-- constraint is broken and refuses to say where.
ALTER TABLE "constraint_violation"
    ADD CONSTRAINT "constraint_violation_has_subject"
    CHECK ("session_id" IS NOT NULL OR "offering_id" IS NOT NULL);


-- ===========================================================================
-- from 20260816180000_session_event_detach_on_session_delete
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- Letting a Session be deleted without letting its history be rewritten
-- ---------------------------------------------------------------------------
--
-- Two deliberate designs contradicted each other, and the contradiction made
-- deleting a Session impossible:
--
--   * `session_event.session_id` is ON DELETE SET NULL, chosen so that audit
--     rows OUTLIVE the Session they describe (TAXONOMY.md §3 rollback depends
--     on the log being complete).
--   * `session_event_append_only` denied `UPDATE OR DELETE` outright — and the
--     FK's SET NULL *is* an UPDATE.
--
-- So the FK action the schema depends on was rejected by the trigger guarding
-- the same table. Deleting a Session that had ever been created, moved, swapped
-- or locked failed with:
--
--     ERROR: session_event is append-only; UPDATE is not permitted
--     CONTEXT: SQL statement "UPDATE ONLY public.session_event
--                             SET session_id = NULL WHERE ..."
--
-- It went unnoticed because until Stage 5 NOTHING in the codebase ever deleted
-- a Session row — there is no DELETE /api/sessions/:id, and the only deletion
-- is `materializeGeneration()` removing placements the solver declined to make.
--
-- WHAT IS PERMITTED NOW, EXACTLY
--
-- One shape and no other: an UPDATE that only sets `session_id` and/or
-- `counterpart_session_id` from a value to NULL, leaving every other column
-- byte-identical. That is precisely what the FK emits. Everything else — a
-- changed `type`, `payload`, `seq`, `created_at`, an actor rewrite, or
-- REPOINTING either column at a DIFFERENT Session rather than detaching it —
-- still raises, and DELETE is still refused unconditionally.
--
-- The event's CONTENT therefore remains immutable, which is the property §3
-- actually needs. What loosens is only the pointer to a row that no longer
-- exists.
--
-- The alternatives were considered and rejected: ON DELETE CASCADE destroys the
-- audit trail the log exists for, and RESTRICT would forbid deleting a
-- solver-rejected Session at all, contradicting the Stage 5 decision that an
-- Offering's unplaceable Sessions are removed rather than left at placements
-- the solver refused.
--
-- `generation_no_delete` shares this function but is a BEFORE DELETE trigger,
-- so it never reaches the UPDATE branch and is unaffected.

CREATE OR REPLACE FUNCTION calendry_internal.deny_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    -- OLD with exactly the two FK columns NEW claims, and nothing else changed.
    -- If NEW still differs from this, some other column was touched.
    detached public.session_event;
BEGIN
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'session_event' THEN
        detached := OLD;
        detached.session_id := NEW.session_id;
        detached.counterpart_session_id := NEW.counterpart_session_id;

        IF NEW IS NOT DISTINCT FROM detached
           -- Neither column may be REPOINTED; only cleared.
           AND (NEW.session_id IS NULL OR NEW.session_id = OLD.session_id)
           AND (NEW.counterpart_session_id IS NULL
                OR NEW.counterpart_session_id = OLD.counterpart_session_id)
           -- And at least one of them must actually be a detach, so a no-op
           -- UPDATE is still refused rather than quietly accepted.
           AND ((OLD.session_id IS NOT NULL AND NEW.session_id IS NULL)
                OR (OLD.counterpart_session_id IS NOT NULL
                    AND NEW.counterpart_session_id IS NULL))
        THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION
        '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END $$;


-- ===========================================================================
-- from 20260817120000_solver_run_result_recovery
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- Recovering a SUCCEEDED run whose result was never captured
-- ---------------------------------------------------------------------------
--
-- THE BUG. `pollSolverRun()` records a terminal status even when the follow-up
-- `GetStatus(include_result=true)` throws — deliberately, because losing the
-- transition would be worse: the run would look active against a solver that had
-- already finished it, and the one-active-run index would block that term.
--
-- But nothing ever retried the missed capture. The background poller claims only
-- PENDING/QUEUED/RUNNING, and `GET /api/solver/runs/:id` short-circuits on
-- `isTerminal`, so a terminal row with no result was never looked at again. It
-- had no result, therefore no Generation, and no way to ever get one — while
-- `status = 'SUCCEEDED'` said the work had been done.
--
-- Measured in the dev database when this was written: 4 such rows.
--
-- WHAT IS AND IS NOT A TARGET. Only SUCCEEDED promises a result. A CANCELLED run
-- was stopped before producing one and a FAILED run never produced one — both
-- correctly have `result IS NULL` and must never be chased. The same database
-- held 4 CANCELLED and 1 FAILED row in exactly that shape, working as designed.
-- The predicate is therefore written narrowly and names the status explicitly
-- rather than reaching for "terminal".
--
-- WHY NOT A NEW STATUS. `SUCCEEDED` is TRUE: the solver did succeed, and this row
-- is the only record that it did. What failed is this app's capture, which is a
-- different axis. Overwriting the status would destroy the fact and make "did
-- this run succeed?" unanswerable, so the capture outcome gets its own columns.
-- "Result lost" is `status = 'SUCCEEDED' AND result_lost_at IS NOT NULL`.
--
-- NOTE ON THE ONE-ACTIVE-RUN INDEX: nothing here touches it. It is partial on
-- status IN ('PENDING','QUEUED','RUNNING'), so a SUCCEEDED run — with a result,
-- without one, recovered or lost — is already outside it and already frees its
-- term. Keeping `status` unchanged is what preserves that.

ALTER TABLE "solver_run"
    -- How many times the result has been asked for again. Bounded: the solver's
    -- run registry is in-memory with no persistence, so once it restarts the
    -- result is genuinely gone and retrying forever would be a lie told slowly.
    ADD COLUMN "result_recovery_attempts" INTEGER NOT NULL DEFAULT 0,
    -- Set when recovery gives up. Distinct from a FAILED run, and permanent.
    ADD COLUMN "result_lost_at" TIMESTAMPTZ(3);

COMMENT ON COLUMN "solver_run"."result_recovery_attempts" IS
    'Attempts made to re-fetch a SUCCEEDED run''s missing result. Bounded at 5.';
COMMENT ON COLUMN "solver_run"."result_lost_at" IS
    'Set when a SUCCEEDED run''s result could not be recovered. The run still '
    'succeeded — only the capture failed.';

-- Finding the rows quickly without scanning every finished run.
CREATE INDEX "solver_run_result_recovery_idx"
    ON "solver_run" ("next_poll_at")
    WHERE "status" = 'SUCCEEDED'
      AND "result" IS NULL
      AND "result_lost_at" IS NULL;

-- ---------------------------------------------------------------------------
-- Widening the poller's tenant discovery
-- ---------------------------------------------------------------------------
--
-- This is the third RLS-bypassing path in the system (CLAUDE.md documents the
-- other two as the auth plane and this function itself). The widening does not
-- change what makes it acceptable: it still takes NO parameters, so it cannot be
-- steered at a chosen tenant, and it still returns TENANT IDS ONLY — no run
-- rows, no scopes, no inputs, no results. Everything the poller then does
-- happens inside an ordinary withTenant() transaction under RLS.
--
-- It has to move at all because widening only the claim would achieve nothing:
-- the poller never asks about a tenant this function does not name, so a tenant
-- whose only outstanding work is a recovery would never be visited.

CREATE OR REPLACE FUNCTION calendry_internal.tenants_with_due_solver_runs()
    RETURNS TABLE(tenant_id text)
    LANGUAGE sql
    STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $$
    SELECT DISTINCT sr.tenant_id
    FROM solver_run sr
    WHERE (
        -- A run still in flight.
        sr.status IN ('PENDING', 'QUEUED', 'RUNNING')
        AND (sr.next_poll_at IS NULL OR sr.next_poll_at <= now())
    ) OR (
        -- A finished run whose result never arrived.
        sr.status = 'SUCCEEDED'
        AND sr.result IS NULL
        AND sr.result_lost_at IS NULL
        AND sr.external_run_id IS NOT NULL
        AND sr.result_recovery_attempts < 5
        AND (sr.next_poll_at IS NULL OR sr.next_poll_at <= now())
    )
$$;


-- ===========================================================================
-- from 20260818090000_federation_room_occupancy
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- Occupancy of Federation-shared Rooms by OTHER tenants
-- ---------------------------------------------------------------------------
--
-- Stage 3 deliberately excluded federation-owned Rooms from SolverInput because
-- this was unresolved: a member tenant can SEE a shared lecture hall (the RLS
-- read policy widens to the federation) but cannot see the other tenant's
-- Sessions occupying it, because those Sessions are tenant-owned and invisible.
-- Sending the room without its occupancy would be worse than omitting it — the
-- solver would place into hours already taken.
--
-- WHY A FUNCTION AND NOT A LEDGER TABLE
--
-- Occupancy is DERIVABLE from session rows. A ledger duplicates it, and every
-- write path would have to maintain it: move, swap, lock, apply-generation,
-- materializeGeneration's create/move/delete partition, and orphan deletion —
-- six call sites today and more later. This repo already has the evidence for
-- how that ends: `session_event`'s ON DELETE SET NULL was broken for months
-- purely because nothing had ever deleted a Session, so an unexercised path
-- stayed wrong invisibly. A ledger's drift would be exactly that shape, and its
-- symptom would be a subtly wrong solver answer.
--
-- The read happens ONCE per solver-run assembly, not per request, so
-- precomputation buys almost nothing.
--
-- WHY THIS IS AN ACCEPTABLE FOURTH RLS BYPASS
--
-- CLAUDE.md's rule is "not without a comparably strong reason". This keeps every
-- property that made the third one acceptable:
--
--   * NO PARAMETERS. The federation comes from the caller's own session context
--     via current_federation_id(), so it cannot be steered at another
--     federation — the same reasoning that made tenants_with_due_solver_runs()
--     safe.
--   * OCCUPANCY ONLY. No session ids, no tenant ids, no titles, no offering or
--     person references. A member tenant learns WHEN a shared hall is busy,
--     which is exactly what it needs to schedule against it, and nothing about
--     whose event it is.
--   * The caller's own rows are excluded, because those arrive through ordinary
--     RLS already and would otherwise be counted twice.

-- WHY AN ABSOLUTE DATE AND NOT (term_week, day)
--
-- `term_week` is relative to each tenant's OWN term start, and terms are
-- tenant-scoped rows — so tenant A's "week 3" is not tenant B's "week 3", and
-- A's term id never matches B's. Term-relative coordinates are not a shared
-- frame across a Federation. The one frame both tenants agree on is the
-- calendar, so occupancy crosses the boundary as a DATE and each tenant maps it
-- into its own week numbering on arrival.

-- DROP first: `prisma migrate reset` drops only the `public` schema and leaves
-- `calendry_internal` standing, so on a replay this function still exists and a
-- bare CREATE fails with 42723. CREATE OR REPLACE would not help either, since
-- the return type changed during development and that cannot be replaced in
-- place.
DROP FUNCTION IF EXISTS calendry_internal.federation_room_occupancy();

CREATE FUNCTION calendry_internal.federation_room_occupancy()
    RETURNS TABLE(
        room_id text,
        occupied_on date,
        block_index integer,
        duration_blocks integer
    )
    LANGUAGE sql
    STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $$
    SELECT sr.room_id,
           -- Monday of the session's term, plus its week and weekday offsets.
           -- date_trunc('week', ...) is ISO Monday, matching mondayOf() in
           -- solverCalendar.ts, so both sides anchor identically.
           (date_trunc('week', t.start_date::timestamp)::date
                + ((s.term_week - 1) * 7 + (s.day_of_week - 1)) * interval '1 day')::date,
           s.block_index,
           s.duration_blocks
      FROM session s
      JOIN session_room sr ON sr.session_id = s.id
      JOIN room r ON r.id = sr.room_id
      JOIN term t ON t.id = s.term_id
     WHERE r.federation_id IS NOT NULL
       AND r.federation_id = calendry_internal.current_federation_id()
       -- Not the caller's own occupancy: those Sessions are already visible
       -- through normal RLS and are sent as `existingSessions`.
       AND s.tenant_id IS DISTINCT FROM calendry_internal.current_tenant_id()
$$;

COMMENT ON FUNCTION calendry_internal.federation_room_occupancy() IS
    'Occupancy of Federation-shared Rooms by other tenants. Parameterless and '
    'occupancy-only by design: see the migration for why this is an acceptable '
    'RLS bypass.';


-- ===========================================================================
-- from 20260819090000_session_federation_shared
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- Session becomes the third federation-shareable entity
-- ---------------------------------------------------------------------------
--
-- TAXONOMY.md §2 amendment: a genuinely shared event spanning member tenants (a
-- university-wide celebration when Technology and Medicine are separate tenants
-- under one Federation) is ONE event, not a coincidence of two identical events
-- each tenant tracks independently. So `session` gets the same ownership shape
-- `room`, `equipment` and `offering` already have.

ALTER TABLE "session"
    ADD COLUMN "federation_id" TEXT REFERENCES "federation"("id") ON UPDATE CASCADE ON DELETE CASCADE,
    ALTER COLUMN "tenant_id" DROP NOT NULL,
    -- Exactly one owner, enforced by the database rather than by convention —
    -- the same CHECK room/equipment/offering carry.
    ADD CONSTRAINT "session_one_owner" CHECK (num_nonnulls("tenant_id", "federation_id") = 1);

CREATE INDEX "session_federation_id_idx" ON "session" ("federation_id");

-- ---------------------------------------------------------------------------
-- RLS: readable by owner tenant OR federation, writable only by owner tenant
-- ---------------------------------------------------------------------------
--
-- WITH CHECK stays deliberately narrower than USING, matching the convention
-- established for room/offering: a member tenant may READ a shared Session but
-- may not create or edit one. Creating a federation-owned Session is a
-- privileged path, not something a member tenant does incidentally — and no such
-- path exists yet, because federation-level permissions are out of scope
-- (TAXONOMY.md §9.4). This migration makes the schema CAPABLE; it does not open
-- a route.

DROP POLICY IF EXISTS tenant_isolation ON "session";

CREATE POLICY tenant_or_federation_read ON "session" FOR SELECT
    USING (
        "tenant_id" = calendry_internal.current_tenant_id()
        OR "federation_id" = calendry_internal.current_federation_id()
    );

CREATE POLICY tenant_write ON "session" FOR ALL
    USING ("tenant_id" = calendry_internal.current_tenant_id())
    WITH CHECK ("tenant_id" = calendry_internal.current_tenant_id());

-- ---------------------------------------------------------------------------
-- session_room inherits the Session's ownership; the other two DO NOT
-- ---------------------------------------------------------------------------
--
-- THIS IS A DELIBERATE NARROWING OF THE TAXONOMY.md WORDING, and the reason is
-- worth keeping: the amendment said the relation tables should let a shared
-- Session "reference Groups/Persons from either member tenant". Implemented
-- literally that requires widening RLS on `group` and `person` — the two most
-- sensitive tenant-scoped tables in the system — so that Federation membership
-- would imply roster visibility. That is a far larger concession than sharing
-- one `session` row.
--
-- Instead: the SESSION is shared, the PARTICIPANT LINKS stay tenant-private.
-- Each tenant sees the shared event and its OWN groups and people on it, and
-- never the other tenant's. The use case — a university-wide celebration both
-- tenants attach their own cohorts to — is fully served, without either tenant
-- enumerating the other's people.
--
-- `session_room` is the one exception, because WHERE a shared event happens is
-- genuinely shared information. It follows `room_equipment`'s precedent exactly:
-- an EXISTS against the parent row's federation ownership.

DROP POLICY IF EXISTS tenant_isolation ON "session_room";

CREATE POLICY tenant_or_federation_read ON "session_room" FOR SELECT
    USING (
        "tenant_id" = calendry_internal.current_tenant_id()
        OR EXISTS (
            SELECT 1 FROM "session" s
            WHERE s."id" = "session_room"."session_id"
              AND s."federation_id" = calendry_internal.current_federation_id()
        )
    );

CREATE POLICY tenant_write ON "session_room" FOR ALL
    USING ("tenant_id" = calendry_internal.current_tenant_id())
    WITH CHECK ("tenant_id" = calendry_internal.current_tenant_id());

-- session_group and session_person are deliberately NOT touched. They keep the
-- plain `tenant_isolation` policy from 20260812000100, which is what makes the
-- narrowing above real rather than nominal.


-- ===========================================================================
-- from 20260821100000_time_grid_break
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- Named, non-uniform breaks on a TimeGrid
-- ---------------------------------------------------------------------------
--
-- `time_grid.break_minutes` stays exactly as it was: the DEFAULT gap between
-- consecutive blocks, and still the whole story for most grids. This table adds
-- sparse overrides — "45 minutes for lunch after block 3", "Friday's afternoon
-- break is longer" — so a real teaching day can be expressed without inventing
-- a second grid.
--
-- WHY A TABLE AND NOT A JSON COLUMN ON time_grid
--
--  1. The unique index below is the only way to make "one override per
--     (position, day)" a database guarantee. A JSON array can hold two
--     conflicting lunches at block 3 and nothing notices until the timetable
--     renders one of them arbitrarily.
--  2. `day_of_week NULL = every active day` is the same scoping shape
--     `constraint_scope` already uses, and that is a table for the same reason.
--  3. Every tenant-scoped table here carries `tenant_id` under
--     `tenant_isolation`. Tenant data inside a JSON column is data RLS cannot
--     see into, and isolation in this system is enforced at the database layer
--     rather than by application care.
--
-- NOTHING HERE REACHES THE SOLVER. The wire carries block INDICES; a gap's
-- duration changes no index, no adjacency and no conflict. `toWireTimeGrid()`
-- omits break data deliberately and has a test asserting the omission.

CREATE TABLE "time_grid_break" (
    "id"                TEXT NOT NULL,
    "tenant_id"         TEXT NOT NULL,
    "time_grid_id"      TEXT NOT NULL,

    -- The gap FOLLOWS this 0-based block index. A row naming the final block is
    -- inert by design: there is no later block for it to push, and honouring it
    -- would overstate when teaching ends.
    "after_block_index" INTEGER NOT NULL,
    "duration_minutes"  INTEGER NOT NULL,
    "label"             TEXT NOT NULL,

    -- NULL = applies on every active day, unless a day-specific row exists for
    -- the SAME after_block_index. Precedence is resolved per position, so
    -- "same lunch every day, but Friday's afternoon break differs" is one extra
    -- row rather than a duplicated day.
    "day_of_week"       INTEGER,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "time_grid_break_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "time_grid_break" ADD CONSTRAINT "time_grid_break_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "time_grid_break" ADD CONSTRAINT "time_grid_break_time_grid_id_fkey"
    FOREIGN KEY ("time_grid_id") REFERENCES "time_grid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A positive gap only. Zero is spelled by having no row at all, and a negative
-- one would walk blocks backwards.
ALTER TABLE "time_grid_break" ADD CONSTRAINT "time_grid_break_duration_positive"
    CHECK ("duration_minutes" > 0);

-- ISO-8601 weekday, or NULL for universal. Not a free integer: `day_of_week = 0`
-- would silently never match a Session, since sessions use 1..7.
ALTER TABLE "time_grid_break" ADD CONSTRAINT "time_grid_break_day_of_week_iso"
    CHECK ("day_of_week" IS NULL OR ("day_of_week" BETWEEN 1 AND 7));

ALTER TABLE "time_grid_break" ADD CONSTRAINT "time_grid_break_after_block_index_nonneg"
    CHECK ("after_block_index" >= 0);

-- One override per position per day. NULLS NOT DISTINCT so the universal row is
-- itself unique — without it, a grid could hold two "every day" lunches at
-- block 3 and the resolver would pick whichever the planner returned first.
CREATE UNIQUE INDEX "time_grid_break_position_day_key"
    ON "time_grid_break" ("time_grid_id", "after_block_index", "day_of_week") NULLS NOT DISTINCT;

CREATE INDEX "time_grid_break_tenant_id_idx" ON "time_grid_break" ("tenant_id");
CREATE INDEX "time_grid_break_time_grid_id_idx" ON "time_grid_break" ("time_grid_id");

-- Ordinary tenant-scoped isolation, identical to every other tenant table.
ALTER TABLE "time_grid_break" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_grid_break" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "time_grid_break"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "time_grid_break" TO calendry_app;


-- ===========================================================================
-- from 20260822120000_constraint_weight_non_negative
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- A soft constraint's weight may not be negative
-- ---------------------------------------------------------------------------
--
-- `constraint_weight_matches_severity` already lives on this table and enforces
-- the HARD ⇒ NULL / SOFT ⇒ NOT NULL pairing. It says nothing about the VALUE,
-- so `weight = -5` was storable — confirmed against the running API, which
-- returned 201 for exactly that payload.
--
-- WHY A NEGATIVE WEIGHT IS NOT MERELY ODD
--
-- Every soft type in the catalogue declares "minimize". The solver refuses a
-- negative weight for that reason (calendry-solver, convert.rs::soft_instance:
-- "a negative weight would invert it"), but that check sits at the far end of
-- the wire and only fires when someone starts a run. The row is stored long
-- before then, and the tenant sees a rule that looks configured.
--
-- The second effect is worse and is not local to the one rule. The solver
-- derives its hard-violation penalty from the weights themselves:
--
--     hard_penalty = sum(all soft weights) * placements + 1     (problem.rs)
--
-- That sum is what guarantees a hard violation outranks every reachable soft
-- configuration. A negative weight SUBTRACTS from it, so one badly-typed number
-- in an unrelated soft rule erodes the priority guarantee for every hard
-- constraint in the tenant — and with enough negative weight the penalty goes
-- negative, at which point the search is rewarded for breaking hard rules.
--
-- WHY ZERO IS ALLOWED
--
-- Deliberately `>= 0` and not `> 0`, matching the solver rather than the
-- builder's `min` attribute. Zero is meaningful: the constraint is evaluated
-- and its breach count is reported, but it does not steer the search. A floor
-- of 1 would reject a configuration the solver accepts, which is the same
-- builder-stricter-than-API divergence that produced this gap.
--
-- WHY HERE AND NOT ONLY IN ZOD
--
-- The API refinement added alongside this gives the actionable message; this
-- gives the guarantee. `provision-tenant.ts` writes baseline constraints with
-- `tx.constraint.createMany` and never passes through `RESOURCES`, so a check
-- that lives only in the resource schema is one a script can walk around. NOT
-- VALID is not used: every existing row already satisfies this (audited, 10
-- rows, all weights >= 1), so the constraint is validated immediately and the
-- table is known-clean rather than carrying an unchecked remainder.
ALTER TABLE public.constraint_def
    ADD CONSTRAINT constraint_weight_non_negative
    CHECK (weight IS NULL OR weight >= 0);


-- ===========================================================================
-- from 20260822140000_group_term
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- Group ↔ Term: which Terms a Group is available in
-- ---------------------------------------------------------------------------
--
-- Until now `group` had NO relation to `term` at any level — not on the table,
-- not through `membership` (which carries only `created_at`, no validity
-- window), not through `constraint_scope` (which scopes by offering and kind),
-- and not on the wire. The only link was transitive and derived:
-- `group -> offering_group -> offering.term_id`.
--
-- The consequence was visible in two places. `assembleSolverInput` sent EVERY
-- tenant Group for every run — measured at 10 sent, 2 actually referenced — and
-- the Offering editor's Group picker offered all of them regardless of which
-- Term the Offering belonged to, so nothing prevented attaching a 2024 cohort
-- to a 2027 Offering.
--
-- The requirement was already asserting itself through a text field: the demo
-- tenant's cohorts are named "dIT22 S1 4.Semester", because the term had
-- nowhere else to live.
--
-- WHY MANY-TO-MANY AND NOT `group.term_id`
--
-- Per-term ownership was considered and rejected on three grounds:
--
--  1. THE PARENT PROBLEM HAS NO GOOD ANSWER. The tree mixes two lifetimes.
--     "dIT22 S1 4.Semester" is a cohort in one term; its parent "IT Security"
--     is a degree programme that persists indefinitely and is never directly
--     scheduled. Owning a Group by a Term means either permitting a parent in a
--     different Term — which abandons the model — or duplicating the programme
--     node every Term, exploding the tree and destroying the identity of the
--     thing it names.
--  2. MEMBERSHIP HAS NO TERM. `membership` is a plain Person↔Group link.
--     Per-term Groups would mean re-adding every student to a NEW Group object
--     each Term, with historical rows pointing at dead Groups, and "which cohort
--     is this student in" would stop having a stable answer.
--  3. IT INVERTS THE NAME. "dIT22" IS the 2022 intake — the thing that persists
--     as it moves through semesters.
--
-- Many-to-many is also a superset: "belongs to exactly one Term" is one row
-- here. The reversibility argument settled it — choosing M2M and finding
-- everyone uses a single Term is harmless, while choosing ownership and finding
-- cohorts persist is a migration that must merge duplicated Groups and
-- reconcile their memberships.
--
-- NO ROW HERE MEANS "AVAILABLE IN EVERY TERM"
--
-- Fail-OPEN, which is the opposite of this codebase's usual instinct and is
-- deliberate. Three reasons:
--
--  * It preserves existing behaviour exactly, so scoping is opt-in rather than a
--    flag day. Fail-closed would make every existing Group unusable the moment
--    this lands.
--  * A newly created Group is immediately usable, instead of invisible until
--    someone remembers a second step.
--  * It stops correctness depending on the backfill being perfect.
--
-- The backfill itself is NOT here. Migrations create no rows (CLAUDE.md); it
-- lives in `prisma/seeds/` and derives scope from actual
-- `offering_group`/`session_group` usage. A freshly migrated database therefore
-- has no scopes at all — harmless precisely BECAUSE unlinked means universal.

CREATE TABLE "group_term" (
    "group_id"  TEXT NOT NULL,
    "term_id"   TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Composite key: the pair IS the fact, and there is nothing else to say
    -- about it. Same shape as offering_group and session_group.
    CONSTRAINT "group_term_pkey" PRIMARY KEY ("group_id", "term_id")
);

ALTER TABLE "group_term" ADD CONSTRAINT "group_term_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE on term: deleting a Term removes its scoping rows, which correctly
-- widens the affected Groups back to universal rather than leaving them
-- pointing at a Term that no longer exists.
ALTER TABLE "group_term" ADD CONSTRAINT "group_term_term_id_fkey"
    FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_term" ADD CONSTRAINT "group_term_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "group_term_term_id_idx" ON "group_term" ("term_id");
CREATE INDEX "group_term_tenant_id_idx" ON "group_term" ("tenant_id");

-- Ordinary tenant-scoped isolation, identical to every other tenant table.
-- Note both sides are already tenant-scoped, so this cannot be used to link a
-- Group to another tenant's Term: the WITH CHECK pins the row's own tenant_id,
-- and the two foreign keys resolve against tables the same policy governs.
ALTER TABLE "group_term" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "group_term" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "group_term"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "group_term" TO calendry_app;


-- ===========================================================================
-- from 20260823120000_session_offering_optional
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- Offering-less Sessions ("Events")
-- ---------------------------------------------------------------------------
--
-- `session.offering_id` becomes NULLABLE. A Session with no Offering is an
-- EVENT: a placement that exists in its own right rather than as one occurrence
-- of a recurring demand — an exam sitting, a staff gathering, a one-off
-- lecture. See TAXONOMY.md §2, "Offering-less Sessions (Events)".
--
-- WHY THE COLUMN AND NOT A SYNTHETIC OFFERING
--
-- The alternative was a frequency-1 Offering behind every Event, which needs no
-- migration. It was rejected because it puts rows in the DEMAND model that are
-- not demand: the Offering list becomes a mix of "this must happen 12 times"
-- and "this happened once on the 14th", and every solve then has to be told to
-- ignore the second kind. The scope default makes that failure quiet — a run
-- with no explicit `offeringIds` takes EVERY Offering in the term, so a
-- forgotten exclusion means the solver owns the Event.
--
-- WHY THIS IS THE SAFE DIRECTION, NOT THE RISKY ONE
--
-- The delete partition in `planMaterialization()` is:
--
--     !keptIds.has(s.id) && !s.isLocked && inScope.has(s.offeringId)
--
-- `inScope` is a Set of offering ids, so `inScope.has(NULL)` is false and an
-- Event is STRUCTURALLY exempt from being deleted by an apply — it cannot be
-- swept up by a solve that never knew about it. That is a stronger guarantee
-- than the lock flag, which is one UPDATE away from being cleared, and it is
-- the main reason this shape was chosen over the synthetic-Offering one.
--
-- Events are additionally created with `is_locked = true` by default. That is
-- defence in depth, not the primary protection.
--
-- WHAT DOES *NOT* CHANGE
--
--  * Existing rows all keep their offering_id — this only widens what is
--    permitted, so it is a pure relaxation and needs no backfill.
--  * The FK stays, with its ON DELETE CASCADE. A NULL simply does not
--    participate: deleting an Offering still removes its Sessions, and an
--    Event has no Offering to be deleted.
--  * `session.kind_id` stays NOT NULL. What an Event IS remains tenant
--    vocabulary and is still required — an Event with no kind would be
--    unnameable in the UI.
--  * RLS is untouched. Ownership is `tenant_id`/`federation_id`; the Offering
--    was never part of the isolation story.
ALTER TABLE "session" ALTER COLUMN "offering_id" DROP NOT NULL;

COMMENT ON COLUMN "session"."offering_id" IS
    'NULL means this Session is an Event — a placement with no recurring demand '
    'behind it (TAXONOMY.md §2). An Event is in no solve''s scope and is sent to '
    'the solver as immovable occupancy.';

-- The solver's exclusion query gains the Event case. `session_unlocked_placement_idx`
-- already covers (tenant_id, term_id, ...) WHERE is_locked = false; nothing
-- about a NULL offering_id changes which rows that index carries, so no index
-- is added here. (See CLAUDE.md § "Resolved, with the reasoning kept" for why
-- speculative indexes are measured before being created.)


-- ===========================================================================
-- from 20260823140000_constraint_default_rows
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- One DEFAULT Constraint row per catalogue type, per tenant
-- ---------------------------------------------------------------------------
--
-- See TAXONOMY.md §2, `Constraint`. A tenant now holds exactly one row per
-- catalogue type, always present and always visible; additional rows of the
-- same type are kind/offering-scoped variants and carry is_default = false.
--
-- WHY THIS EXISTS, AND IT IS NOT A UI CONVENIENCE
--
-- `refreshViolations()` evaluates ONLY the constraint types the tenant has a
-- row for. A type with no row is therefore a SILENTLY DISABLED rule, not a
-- neutral absence — and that is not hypothetical:
--
--   * `provision-tenant.ts` seeded 3 of the 15 catalogue types.
--   * `no_double_booking_person` was added to the catalogue in Stage 7a and
--     never added to provisioning, so NO tenant had a row for it and the
--     person-clash check has never run in any real tenant.
--   * `tests/violations-person-clash.test.ts` passes because it creates its
--     own constraint row, so the gap was invisible from the test suite.
--
-- Guaranteeing the row exists is what makes "enabled" the only thing that
-- decides whether a rule runs.
--
-- WHY A COLUMN AND NOT "the row with no scopes"
--
-- The natural predicate — at most one UNSCOPED row per (tenant, type) — cannot
-- be an index. Scoping lives in the child table `constraint_scope`, and a
-- partial index predicate may only reference columns of the row being indexed.
--
-- A counting trigger was rejected for the reason Stage 2 recorded about
-- `solver_run_one_active_per_term`: two parallel inserts both pass an
-- application-level count and both land. The rule has to be an index, so the
-- fact it indexes has to be a column. This mirrors
-- `generation_one_current_per_tenant`, which is the same shape.
--
-- BACKFILL WITHOUT WRITING ROWS
--
-- Migrations here are schema-only (CLAUDE.md) — they may not INSERT reference
-- or tenant data. Adding the column with DEFAULT true marks every EXISTING row
-- as its type's default, which is correct because no tenant has more than one
-- row per type (verified before writing this). The default is then flipped to
-- false so future inserts — the scoped variants — are not defaults.
--
-- This is DDL, not a data statement: no INSERT, no UPDATE, and the outcome is
-- a property of the ALTER rather than of a row the migration invented.
--
-- If some database DOES hold two rows of one type, the unique index below
-- fails and the migration aborts. That is the intended behaviour: it is a
-- duplicate that needs a human decision about which row survives, and this
-- project prefers a loud stop to a quiet pick.
ALTER TABLE "constraint_def" ADD COLUMN "is_default" boolean NOT NULL DEFAULT true;
ALTER TABLE "constraint_def" ALTER COLUMN "is_default" SET DEFAULT false;

COMMENT ON COLUMN "constraint_def"."is_default" IS
    'True for the tenant''s single always-present row for this catalogue type. '
    'False for kind/offering-scoped variants. See constraint_one_default_per_type.';

CREATE UNIQUE INDEX constraint_one_default_per_type
    ON "constraint_def" (tenant_id, type) WHERE "is_default";


-- ===========================================================================
-- from 20260824100000_session_title
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- Session.title — a name for an EVENT
-- ---------------------------------------------------------------------------
--
-- `session` had no nameable column at all. Every display site derived its label
-- from the Offering (`session.offering.title`), which an ad-hoc Event does not
-- have — so an Event rendered as the literal string "Untitled session" on the
-- grid, in the inspector and in the off-grid tray, and as an EMPTY STRING in
-- the placement banner, which had no fallback.
--
-- WHOSE NAME THIS IS
--
-- An EVENT's, and only an Event's. An Offering-linked Session keeps deriving
-- its name from its Offering exactly as before: `sessionLabel()` reads this
-- column only when `offering_id IS NULL`, and `POST /api/sessions` REFUSES a
-- title alongside an offering_id rather than storing one nothing will show.
--
-- Storing-and-ignoring was the alternative and was rejected on this project's
-- usual grounds: a column that silently accumulates values no screen renders is
-- indistinguishable from a bug the first time someone looks. If per-occurrence
-- labels for real Sessions are wanted later ("Week 3: guest lecture"), that is a
-- deliberate feature with its own display rule, not a side effect of this one.
--
-- NULLABLE, AND NOT BACKFILLED
--
-- Every existing row is Offering-linked, so NULL is already the correct value
-- for all of them and there is nothing to migrate. The API requires a title only
-- where it means something — when there is no Offering to borrow a name from.
ALTER TABLE "session" ADD COLUMN "title" text;

COMMENT ON COLUMN "session"."title" IS
    'Display name for an EVENT (offering_id IS NULL). Ignored — and refused on '
    'write — when the Session belongs to an Offering, which supplies the name.';


-- ===========================================================================
-- from 20260824140000_session_update_details_event
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- UPDATE_DETAILS — editing what an Event IS, as distinct from where it sits
-- ---------------------------------------------------------------------------
--
-- The log's vocabulary held seven verbs, all about PLACEMENT or lifecycle:
-- CREATE, MOVE, SWAP, DELETE, LOCK, UNLOCK, APPLY_GENERATION. Nothing described
-- changing a Session's title, kind, groups or people, because until Events
-- existed those were never editable — they came from the Offering or from
-- solver output.
--
-- WHY A NAMED VERB AND NOT A GENERIC "UPDATE"
--
-- CLAUDE.md's routing convention: editing operations are explicit verbs on the
-- Session resource, "not generic PATCHes, so the event log can record intent,
-- not just a diff". A row saying UPDATE would push the reader back into the
-- payload to learn what happened; UPDATE_DETAILS says it changed what the event
-- IS, and MOVE already says the other thing.
--
-- ADD VALUE INSIDE A MIGRATION
--
-- Safe here. PostgreSQL forbids USING a new enum value in the same transaction
-- that adds it, not adding one — and this migration only adds. The first row
-- carrying it is written by a later request. (Server is PG 18.1.)
ALTER TYPE "session_event_type" ADD VALUE IF NOT EXISTS 'UPDATE_DETAILS';


-- ===========================================================================
-- from 20260825120000_person_availability
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- Person availability: vetoes (with approval) and soft preferences
-- ---------------------------------------------------------------------------
--
-- WHY THIS EXISTS
--
-- `lecturer_veto` has been a LIVE, enabled, HARD constraint in every tenant
-- since provisioning started creating one default row per catalogue type — and
-- it has never once been able to fire. `Person.blackouts` exists on the wire and
-- the solver implements it (shape 2, unary, slot-keyed), but the app modelled no
-- unavailability at all: `assembleSolverInput` sent `blackouts: []`
-- unconditionally, with a comment saying so.
--
-- So this is not a new capability on the solver side. It is the missing half of
-- one that has been running against an empty set. Nothing in calendry-proto or
-- calendry-solver changes.
--
-- WHY APPROVAL, AND ONLY FOR SELF-DECLARED ROWS
--
-- A veto is HARD. A person who can write one unreviewed can make a term
-- infeasible, and the failure surfaces as unplaced Sessions and ExactFrequency
-- violations with nothing pointing back at the cause. So a self-declared window
-- lands PENDING and is inert until somebody holding `availability.manage_any`
-- approves it.
--
-- An administrator writing one directly is exercising an authority they were
-- granted, so it is written APPROVED with themselves recorded as the decider.
-- Queueing it for approval would mean approving your own authorized action,
-- which is ceremony, not control.
--
-- Deletion needs no approval at any status, because every deletion RELAXES the
-- problem. Approval exists to stop unilateral TIGHTENING.

CREATE TYPE "person_unavailability_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "person_unavailability" (
    "id"        TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,

    -- Mirrors calendry.solver.v1.Unavailability EXACTLY, including its emptiness
    -- convention: an empty array means "every value on that axis". {days:[5]} is
    -- every Friday; {blocks:[0]} is every first block; {} is everything.
    --
    -- NOTE that person_preference below INVERTS this — there an empty array
    -- means "no preference". Two adjacent tables with opposite emptiness
    -- semantics is precisely what a later reader gets wrong, so both say so.
    "days"   INTEGER[] NOT NULL DEFAULT '{}',
    "blocks" INTEGER[] NOT NULL DEFAULT '{}',
    "weeks"  INTEGER[] NOT NULL DEFAULT '{}',

    "reason" TEXT,

    "status" "person_unavailability_status" NOT NULL DEFAULT 'PENDING',

    "created_by_person_id" TEXT,
    "decided_by_person_id" TEXT,
    "decided_at"           TIMESTAMPTZ(3),
    "decision_note"        TEXT,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_unavailability_pkey" PRIMARY KEY ("id")
);

-- The half-decided state is unrepresentable rather than merely unlikely: a row
-- is either awaiting a decision with no timestamp, or decided with one.
--
-- Written against `decided_at` and NOT against `decided_by_person_id`, which is
-- the part that looks like an oversight and is not. The decider is an audit
-- POINTER and is ON DELETE SET NULL — deleting an administrator must not
-- cascade away the decisions they made, exactly as session_event.session_id may
-- be detached. A CHECK naming the pointer would then either be violated by a
-- legitimate person deletion or force RESTRICT on it. The timestamp is a fact
-- and cannot be detached, so it carries the constraint.
ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_decision_complete"
    CHECK (
        (status = 'PENDING'  AND decided_at IS NULL)
        OR
        (status <> 'PENDING' AND decided_at IS NOT NULL)
    );

ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE on the subject: their declared unavailability is meaningless without
-- them, and nothing else references it.
ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL on both audit pointers — see the CHECK above.
ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_created_by_fkey"
    FOREIGN KEY ("created_by_person_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_decided_by_fkey"
    FOREIGN KEY ("decided_by_person_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "person_unavailability_tenant_id_idx" ON "person_unavailability" ("tenant_id");
-- The review queue's own query.
CREATE INDEX "person_unavailability_tenant_id_status_idx" ON "person_unavailability" ("tenant_id", "status");
-- The solver read path: approved rows for a set of people.
CREATE INDEX "person_unavailability_person_id_status_idx" ON "person_unavailability" ("person_id", "status");

-- ---------------------------------------------------------------------------

CREATE TABLE "person_preference" (
    -- The person IS the key. One row per Person by construction, not by a
    -- unique index that could be dropped without anything noticing.
    "person_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    -- EMPTY MEANS NO PREFERENCE — the opposite of person_unavailability above,
    -- where empty means every value.
    "preferred_days"   INTEGER[] NOT NULL DEFAULT '{}',
    "preferred_blocks" INTEGER[] NOT NULL DEFAULT '{}',

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_preference_pkey" PRIMARY KEY ("person_id")
);

ALTER TABLE "person_preference" ADD CONSTRAINT "person_preference_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "person_preference" ADD CONSTRAINT "person_preference_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "person_preference_tenant_id_idx" ON "person_preference" ("tenant_id");

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
--
-- Ordinary tenant isolation, identical to every other tenant-scoped table. NO
-- new RLS exception, and specifically NOT a row-level "own person only" policy.
--
-- Self-scoping is authorization WITHIN a tenant, which has always been the
-- application layer's job here — `requirePermission` is a query, not a policy.
-- Expressing "may write only their own row" in RLS would need a second
-- conditional isolation dimension (a calendry.person_id GUC set on some requests
-- and not others) so the database could tell an administrator editing anyone
-- from a person editing themselves. CLAUDE.md permits exactly four
-- RLS-bypassing/widening paths and requires a comparably strong reason for a
-- fifth; "the route could also have enforced this" is not one.
--
-- What enforces self-scoping instead is route SHAPE: /api/me/* takes no person
-- id, from the URL or the body, so another Person's row is unnameable rather
-- than merely rejected.

ALTER TABLE "person_unavailability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_unavailability" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "person_unavailability"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

ALTER TABLE "person_preference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_preference" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "person_preference"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "person_unavailability" TO calendry_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "person_preference" TO calendry_app;


-- ===========================================================================
-- from 20260825160000_person_unavailability_term
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- Anchor a week-scoped absence to the term whose weeks it counts
-- ---------------------------------------------------------------------------
--
-- WHAT WAS WRONG, MEASURED RATHER THAN REASONED
--
-- `Unavailability.weeks` is documented on the wire as "index into
-- AcademicCalendar.weeks" — and that calendar is built PER SOLVE, for the one
-- term being solved. `person_unavailability` had no term reference, so
-- `approvedBlackoutsFor` sent every approved row to every solve.
--
-- Against the demo tenant, one stored row of `weeks:[2]` was sent unchanged to
-- both terms, where week 2 begins:
--
--     test             week[2] starts 2026-09-07
--     Wintersemester   week[2] starts 2027-10-11
--
-- Thirteen months apart, from one row. For the RECURRING pattern the previous
-- slice shipped (days/blocks, no weeks) this is harmless — a Friday is a Friday
-- in every term. For a date-range absence it is a correctness hole: "I am away
-- the week of 7 September 2026" would also empty a week of the following
-- academic year.
--
-- The previous slice's proposal said the weeks column and its wire mapping were
-- already complete and only the UI was narrowed. That was TRUE — verified with a
-- live solve, which moved placements out of the blacked-out weeks — and it was
-- not the whole story, because nothing had ever written a weeks row and so the
-- ambiguity had never had a chance to be wrong.
--
-- NULL MEANS EVERY TERM
--
-- Which is what the recurring pattern wants and what every existing row means,
-- so this migration needs no backfill and changes no behaviour for them.
-- A term-scoped row applies only to that term's solves.
--
-- Note this is NOT the fail-open choice `group_term` made for its own reasons.
-- The CHECK below removes the case where fail-open would be wrong.

ALTER TABLE "person_unavailability" ADD COLUMN "term_id" TEXT;

-- CASCADE: a term's week indices mean nothing once the term is gone, and a row
-- pointing at a deleted term would be silently inert — the exact failure this
-- whole feature exists to stop. RESTRICT would instead make a term
-- undeletable because somebody once booked a holiday in it.
ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_term_id_fkey"
    FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A week index with no term is the ambiguous state above, and it is now
-- unrepresentable rather than merely discouraged.
--
-- One-directional on purpose. The converse — a term with no weeks — is
-- meaningful: "I do not teach Fridays, but only in Wintersemester" is a
-- perfectly ordinary thing to record, and forbidding it would be this constraint
-- inventing a rule nobody asked for.
ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_weeks_need_a_term"
    CHECK (cardinality(weeks) = 0 OR term_id IS NOT NULL);

-- The solver read path filters `term_id IS NULL OR term_id = <term>`.
CREATE INDEX "person_unavailability_term_id_idx" ON "person_unavailability" ("term_id");


-- ===========================================================================
-- from 20260826120000_person_preference_weight_multiplier
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- Per-person preference weight: a bounded multiplier on the tenant default
-- ---------------------------------------------------------------------------
--
-- `person_preference_fit` carries ONE tenant-wide weight, the same way
-- `lecturer_veto` carries one tenant-wide switch over per-person blackout data.
-- That cannot express "the department head's preference outranks a first-year
-- tutor's", which is a real institutional fact.
--
-- WHY A BOUNDED MULTIPLIER AND NOT A FREE WEIGHT COLUMN
--
-- The solver derives its hard-violation penalty from the weights themselves:
--
--     hard_penalty = sum(all soft weights) * placements + 1     (problem.rs)
--
-- An unbounded per-row weight would make that sum a function of tenant DATA
-- rather than of the constraint configuration — the same erosion of the
-- hard-outranks-soft guarantee that `constraint_weight_non_negative` exists to
-- prevent, with a wider blast radius because any row could contribute. A factor
-- clamped to [0.5, 2.0] keeps this type's contribution to the bound at
-- `tenant_weight * 2.0`: a fixed ceiling, computable from the constraint
-- configuration alone, independent of how many people hold an override.
--
-- A MULTIPLIER rather than an absolute override, because an absolute value
-- silently rots when the tenant changes its default weight: raising it from 5
-- to 20 turns a row meaning "count this person double" into "count them at a
-- fifth", and keeping every override correct would need a data sweep on each
-- config edit.
--
-- WHY HERE AND NOT ONLY IN ZOD
--
-- Same reasoning as `constraint_weight_non_negative`: the administrator write
-- path gives the actionable message, this gives the guarantee.
-- `provision-tenant.ts` and any future backfill write rows with `createMany`
-- and never pass through the resource schema or a route handler, so a check
-- living only in the API is one a script can walk around.
--
-- NOT VALID is not used: the column is new, so every existing row has NULL and
-- satisfies this immediately. The table is known-clean rather than carrying an
-- unchecked remainder.
ALTER TABLE public.person_preference
    ADD COLUMN weight_multiplier DOUBLE PRECISION;

ALTER TABLE public.person_preference
    ADD CONSTRAINT person_preference_weight_multiplier_range
    CHECK (weight_multiplier IS NULL OR (weight_multiplier >= 0.5 AND weight_multiplier <= 2.0));


-- ===========================================================================
-- from 20260827090000_display_colours_and_settings
-- ===========================================================================
-- Display colour, and one place per tenant to say what the schedule highlights.
--
-- HAND-WRITTEN, like every migration here. `prisma migrate dev` diffs against
-- schema.prisma, which cannot express RLS policies, triggers or grants — it
-- would emit a migration that silently DROPS them, leaving every table present
-- and tenant isolation gone with every test still passing (CLAUDE.md).

-- ---------------------------------------------------------------------------
-- 1. Offering carries its own colour.
--
-- Nullable, and deliberately so: null means "inherit", which is what lets the
-- resolution order (offering -> session kind -> default) stay meaningful. A
-- default value here would make every Offering claim a colour it never chose.
-- Mirrors `session_kind.color`, which has worked this way since Step 13.
-- ---------------------------------------------------------------------------
ALTER TABLE "offering" ADD COLUMN "color" TEXT;

-- ---------------------------------------------------------------------------
-- 2. Per-tenant display settings.
--
-- A SINGLETON, keyed by tenant_id as the primary key rather than a surrogate
-- id with a unique index. That is the whole point: "there is at most one row of
-- settings per tenant" is then unrepresentable-otherwise rather than enforced
-- by a constraint somebody could drop. There is no `id` column because a second
-- row is not a thing that should be able to exist.
--
-- Absent row = defaults. Provisioning does not seed one, and the read path
-- falls back — so a tenant that has never opened the page behaves exactly like
-- one that opened it and changed nothing.
-- ---------------------------------------------------------------------------
CREATE TABLE "tenant_display_settings" (
    "tenant_id" TEXT NOT NULL,

    -- Whether a Session in a virtual Room is marked on the schedule at all.
    -- Online delivery is a virtual Room and never a flag on Session
    -- (TAXONOMY.md); this setting decides how that fact is DRAWN, and stores no
    -- second copy of it.
    "highlight_online" BOOLEAN NOT NULL DEFAULT true,
    "online_color" TEXT,

    -- Where a Session's colour comes from when several sources could supply
    -- one. Stored as an ordered list so the tenant states a precedence rather
    -- than the renderer hardcoding one.
    "color_source_order" TEXT[] NOT NULL DEFAULT ARRAY['offering', 'kind']::TEXT[],

    -- The chip colour when nothing else supplies one.
    "default_color" TEXT,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "tenant_display_settings_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "tenant_display_settings"
    ADD CONSTRAINT "tenant_display_settings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant-scoped, so it is isolated at the DB layer like everything else. The
-- app role owns nothing and runs under FORCE ROW LEVEL SECURITY.
ALTER TABLE "tenant_display_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_display_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "tenant_display_settings"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenant_display_settings" TO calendry_app;


-- ===========================================================================
-- from 20260827180000_group_term_availability
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- When a Group is available WITHIN a Term
-- ---------------------------------------------------------------------------
--
-- Some cohorts run the first half of a Term and some the second — a block
-- placement, a late intake, a programme that alternates. Until now that was
-- inexpressible: a Group was either in a Term or not, and every Session
-- attached to it could be placed in any of that Term's weeks.
--
-- ABSENT ROW MEANS THE WHOLE TERM. Fail-open, matching `group_term`'s own
-- choice and for the same reason: scoping is opt-in, so every existing Group
-- keeps working and a newly created one is immediately usable rather than
-- unschedulable until someone remembers a second step. This migration therefore
-- needs no backfill and changes no behaviour for any existing row.
--
-- WHY NOT COLUMNS ON `group_term`, WHICH IS THE OBVIOUS PLACE
--
-- Because `group_term`'s row EXISTENCE already carries meaning, and it is the
-- opposite kind of meaning. No row there means "available in every Term"; a row
-- means "only these Terms". Putting a date range on that table would make
-- setting a range for a Group with no rows create one — silently scoping that
-- Group OUT of every other Term as a side effect of saying when it is busy in
-- this one. A separate table has no such coupling.
--
-- It also keeps intact the standing rule that `group_term` is a VISIBILITY
-- scope and never a scheduling input (see CLAUDE.md). This table is the
-- opposite: it exists precisely to reach the solver.
--
-- ONE WINDOW PER (GROUP, TERM), by primary key rather than by constraint, so a
-- second window is unrepresentable rather than merely rejected. Same shape as
-- `tenant_display_settings` being keyed by `tenant_id` alone. `Unavailability`
-- on the wire could carry several disjoint windows, so this is a deliberate
-- narrowing of what the schema can say, not a limit of what the solver can
-- honour: "available from X to Y" is the request, and a Group away for a
-- fortnight in the middle of a range is a different feature with a different UI.
-- ---------------------------------------------------------------------------
CREATE TABLE "group_term_availability" (
    "group_id"  TEXT NOT NULL,
    "term_id"   TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    -- Both NULLABLE and at least one required (see the CHECK below). One-sided
    -- is a real request — "joins in week 5, runs to the end" — and forcing a
    -- caller to restate the Term's own boundary would store a second copy of it
    -- that goes stale the moment the Term moves.
    "available_from" DATE,
    "available_to"   DATE,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "group_term_availability_pkey" PRIMARY KEY ("group_id", "term_id")
);

-- CASCADE on both, and for the reason `person_unavailability.term_id` uses it: a
-- window whose Term or Group is gone is silently inert, which is the exact
-- failure this feature exists to prevent. RESTRICT would instead make a Term
-- undeletable because somebody once narrowed a cohort inside it.
ALTER TABLE "group_term_availability"
    ADD CONSTRAINT "group_term_availability_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_term_availability"
    ADD CONSTRAINT "group_term_availability_term_id_fkey"
    FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_term_availability"
    ADD CONSTRAINT "group_term_availability_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A row with neither bound says exactly what an ABSENT row says, and two
-- representations of one state is the thing this codebase deletes rows to
-- avoid (`person_preference` deletes when both axes empty, for the same
-- reason). Unrepresentable rather than discouraged.
ALTER TABLE "group_term_availability"
    ADD CONSTRAINT "group_term_availability_needs_a_bound"
    CHECK (available_from IS NOT NULL OR available_to IS NOT NULL);

-- An inverted range is not a narrow window, it is an empty one — which would
-- blacken every week of the Term and make the Group unschedulable, reported as
-- nothing more specific than "no feasible placement".
ALTER TABLE "group_term_availability"
    ADD CONSTRAINT "group_term_availability_ordered"
    CHECK (
        available_from IS NULL
        OR available_to IS NULL
        OR available_from <= available_to
    );

-- Tenant-scoped, isolated at the DB layer like everything else. The app role
-- owns nothing and runs under FORCE ROW LEVEL SECURITY.
ALTER TABLE "group_term_availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "group_term_availability" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "group_term_availability"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "group_term_availability" TO calendry_app;

-- The solve-time read is "every window for this Term", so the term is the
-- leading column of the access path the group_id-first primary key cannot
-- serve.
CREATE INDEX "group_term_availability_term_id_idx" ON "group_term_availability" ("term_id");
CREATE INDEX "group_term_availability_tenant_id_idx" ON "group_term_availability" ("tenant_id");


-- ===========================================================================
-- from 20260828010000_screens
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- Screens: a lobby display is a DEVICE, not a person
-- ---------------------------------------------------------------------------
--
-- A screen in a corridor shows what is happening in the rooms around it. It has
-- no user, cannot be asked to log in, and must keep working when nobody has
-- touched it for a term.
--
-- WHY THIS IS NOT A FOURTH RLS EXCEPTION, which is the thing that would have
-- made it a bad idea. The obvious build is a public unauthenticated read —
-- which would mean either dropping RLS on the tables a board reads, or a policy
-- that answers with no tenant context. Instead a Screen is a CREDENTIAL, with
-- exactly the access shape the auth plane already uses (CLAUDE.md exception 2):
-- resolved only by the unique hash of a secret it presents, never by a tenant
-- filter, through a SECURITY DEFINER function taking the secret alone. Once that
-- returns a tenant, every subsequent read happens inside an ordinary
-- `withTenant()` transaction under the same RLS as any other request.
--
-- So this table IS tenant-scoped and RLS-protected like everything else; only
-- the initial resolution is privileged, and it is privileged in the one way that
-- is already established.
--
-- A Screen holds NO AccessRole and no acting Person, which is what makes the
-- authority question answer itself: `heldPermissions()` throws 403 the moment
-- `actorPersonId` is null, so a screen credential cannot satisfy any permission
-- check anywhere in the app, now or after someone adds a new one. Its authority
-- is exactly its room scope and nothing else.
-- ---------------------------------------------------------------------------
CREATE TABLE "screen" (
    "id"        TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    -- What a human calls it when revoking the right one: "Main entrance",
    -- "B-block corridor".
    "name" TEXT NOT NULL,

    -- SHA-256 of the presented key, never the key itself — the same treatment
    -- `auth_session` gives its token, for the same reason: a leaked database
    -- backup must not hand over working credentials.
    "token_hash" TEXT NOT NULL,

    -- Revocation without deletion, so a screen taken down for a week does not
    -- lose its name and room scope.
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    -- Last successful board fetch. The only way to answer "is that display in
    -- the east corridor actually still working?" without walking there.
    "last_seen_at" TIMESTAMPTZ(3),

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "screen_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "screen"
    ADD CONSTRAINT "screen_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- GLOBALLY unique, not per-tenant: the hash is looked up before any tenant is
-- known, so a collision across tenants would resolve to whichever row came
-- first. Unique here makes that unrepresentable rather than unlikely.
CREATE UNIQUE INDEX "screen_token_hash_key" ON "screen" ("token_hash");
CREATE INDEX "screen_tenant_id_idx" ON "screen" ("tenant_id");

-- ---------------------------------------------------------------------------
-- Which rooms a screen shows. NO ROWS MEANS EVERY ROOM.
-- ---------------------------------------------------------------------------
--
-- Fail-open, matching `group_term` and `group_term_availability`, and for the
-- same reason: a screen created without a scope should show the building rather
-- than a blank wall, which is what a fail-closed reading would produce and which
-- looks identical to a broken display.
--
-- Note this widens nothing. The scope narrows what a screen may see WITHIN its
-- tenant; the tenant boundary is RLS, as always.
-- ---------------------------------------------------------------------------
CREATE TABLE "screen_room" (
    "screen_id" TEXT NOT NULL,
    "room_id"   TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "screen_room_pkey" PRIMARY KEY ("screen_id", "room_id")
);

ALTER TABLE "screen_room"
    ADD CONSTRAINT "screen_room_screen_id_fkey"
    FOREIGN KEY ("screen_id") REFERENCES "screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "screen_room"
    ADD CONSTRAINT "screen_room_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "screen_room"
    ADD CONSTRAINT "screen_room_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "screen_room_room_id_idx" ON "screen_room" ("room_id");
CREATE INDEX "screen_room_tenant_id_idx" ON "screen_room" ("tenant_id");

-- Both tenant-scoped and isolated at the DB layer like everything else.
ALTER TABLE "screen" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "screen" FORCE ROW LEVEL SECURITY;
ALTER TABLE "screen_room" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "screen_room" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "screen"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

CREATE POLICY tenant_isolation ON "screen_room"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "screen" TO calendry_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "screen_room" TO calendry_app;

-- ---------------------------------------------------------------------------
-- Resolve a screen key to its tenant, before any tenant context exists
-- ---------------------------------------------------------------------------
--
-- Deliberately the same shape as `calendry_internal.session_identity()`:
-- SECURITY DEFINER, STABLE, parameterised by the SECRET ALONE and never by a
-- tenant id, so it cannot be used to enumerate or to cross a boundary — the
-- caller must already hold the secret, and what comes back is only the tenant
-- that secret belongs to.
--
-- Returns the row even when inactive, so the app can answer "revoked" instead of
-- "no such screen". A display showing "this screen has been turned off" is
-- fixable by whoever walks past it; one showing nothing is a hardware call.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calendry_internal.screen_identity(p_token_hash text)
RETURNS TABLE (
    screen_id     text,
    tenant_id     text,
    federation_id text,
    name          text,
    is_active     boolean,
    room_ids      text[]
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $fn$
    SELECT
        s.id, s.tenant_id, t.federation_id, s.name, s.is_active,
        -- The room scope comes back in the SAME privileged call rather than a
        -- second one, so "what is this credential" is one question with one
        -- answer. A handler cannot act on a screen whose scope it forgot to
        -- load, because there is no way to obtain the screen without it.
        COALESCE(
            (SELECT array_agg(r.room_id ORDER BY r.room_id)
             FROM screen_room r WHERE r.screen_id = s.id),
            ARRAY[]::text[]
        )
    FROM screen s
    JOIN tenant t ON t.id = s.tenant_id
    WHERE s.token_hash = p_token_hash
$fn$;

REVOKE EXECUTE ON FUNCTION calendry_internal.screen_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendry_internal.screen_identity(text) TO calendry_app;


-- ===========================================================================
-- from 20260828140000_append_only_cascade_from_tenant
-- ===========================================================================
-- Deleting a Tenant was impossible once it had ever produced a Generation.
--
-- WHAT FAILED, AND WHERE IT ACTUALLY FAILED
--
-- `generation` and `session_event` both carry an ON DELETE CASCADE FK to
-- `tenant`, so removing a Tenant emits a DELETE against each. Both tables are
-- guarded by `calendry_internal.deny_mutation()`, which refused every DELETE
-- unconditionally — so the cascade could not fire and the parent DELETE aborted:
--
--     ERROR: generation is append-only; DELETE is not permitted
--     CONTEXT: SQL statement "DELETE FROM ONLY "public"."generation"
--                             WHERE $1 OPERATOR(pg_catalog.=) "tenant_id""
--
-- Note WHICH trigger raised: `generation_no_delete`, not
-- `session_event_append_only`. The generation cascade is reached first, so
-- exempting only `session_event` — the obvious reading, and what the tracked
-- entry said — would have moved the error rather than fixed it. Both share the
-- one function, so both are fixed by one change.
--
-- It went unnoticed because nothing in the application deletes a Tenant: there
-- is no `/api/tenants` at all. The only callers are operator cleanup and the
-- integration suite, and the suite had absorbed it as a workaround —
-- `tests/helpers/seed.ts` DISABLES all three append-only triggers around its
-- teardown. A workaround in the fixture is how a schema defect survives a
-- thousand passing tests.
--
-- THE DISCRIMINATOR, AND WHY IT MATCHES EXACTLY
--
-- A cascade is permitted; a direct DELETE is not. The two are told apart by
-- whether the owning Tenant still exists: the parent row is removed before its
-- FK cascade fires, so during a cascade `OLD.tenant_id` no longer resolves,
-- while a hand-written `DELETE FROM generation WHERE id = ...` runs with the
-- Tenant very much present and is still refused.
--
-- That is an exact match rather than a broad allowance, which is the property
-- CLAUDE.md's "guards must fail loudly or match exactly" rule asks for: there is
-- no state in which this branch both "correctly permits a cascade" and "permits
-- something else because of a bug". Both columns are `NOT NULL`, so the check
-- cannot be satisfied by an absent tenant_id.
--
-- WHAT IS STILL REFUSED
--
--   * DELETE of a `generation` or `session_event` whose Tenant exists — the
--     append-only invariant of TAXONOMY.md §3, unchanged.
--   * Every UPDATE to `session_event` except the existing narrow detach
--     (session_id / counterpart_session_id set to NULL and nothing else).
--   * Every UPDATE to a `generation`'s content, via the separate
--     `generation_content_immutable` trigger, which this does not touch.
--
-- Erasing a Tenant erases its audit trail, which is the point of erasing a
-- Tenant. The alternative — a Tenant that can never be removed — is not a
-- stronger audit guarantee, only an undeletable row.

CREATE OR REPLACE FUNCTION calendry_internal.deny_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    -- OLD with exactly the two FK columns NEW claims, and nothing else changed.
    -- If NEW still differs from this, some other column was touched.
    detached public.session_event;
BEGIN
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'session_event' THEN
        detached := OLD;
        detached.session_id := NEW.session_id;
        detached.counterpart_session_id := NEW.counterpart_session_id;

        IF NEW IS NOT DISTINCT FROM detached
           -- Neither column may be REPOINTED; only cleared.
           AND (NEW.session_id IS NULL OR NEW.session_id = OLD.session_id)
           AND (NEW.counterpart_session_id IS NULL
                OR NEW.counterpart_session_id = OLD.counterpart_session_id)
           -- And at least one of them must actually be a detach, so a no-op
           -- UPDATE is still refused rather than quietly accepted.
           AND ((OLD.session_id IS NOT NULL AND NEW.session_id IS NULL)
                OR (OLD.counterpart_session_id IS NOT NULL
                    AND NEW.counterpart_session_id IS NULL))
        THEN
            RETURN NEW;
        END IF;
    END IF;

    -- A DELETE that is a CASCADE from the owning Tenant. See the header: the
    -- parent row is already gone by the time its cascade fires, and a direct
    -- DELETE is not, so this permits exactly the one case and nothing adjacent.
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (SELECT 1 FROM public.tenant WHERE id = OLD.tenant_id)
    THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION
        '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END $$;

-- ---------------------------------------------------------------------------
-- The same defect on `generation`, and this one is USER-FACING
-- ---------------------------------------------------------------------------
--
-- `generation.created_by_id` is `ON DELETE SET NULL`, and
-- `generation_content_immutable` lists `created_by_id` among the columns that
-- may never change. So the FK action the schema depends on was refused by a
-- trigger on the same table — the third instance of that exact shape, after the
-- `session_event` detach (20260816180000) and the cascades above:
--
--     ERROR: generation <id> is immutable: only status, is_current, applied_at
--            and infeasibility_report may change
--     CONTEXT: SQL statement "UPDATE ONLY "public"."generation"
--                             SET "created_by_id" = NULL WHERE ..."
--
-- Unlike the Tenant case this is reachable from the UI. `/manage/persons`
-- offers delete behind `person.delete`, so removing a departed member of staff
-- who had ever triggered a solver run or applied a Generation failed with a raw
-- database error. Verified against a real row before fixing.
--
-- The exemption is the narrow one, modelled on the `session_event` detach: an
-- UPDATE that nulls `created_by_id` AND CHANGES NOTHING ELSE. Repointing it at
-- a different Person is still refused, and so is nulling it alongside any other
-- edit — a cascade only ever touches that one column, so anything wider is not
-- a cascade. The authorship record degrades to "unknown" rather than becoming a
-- lie, which is what deleting the Person actually means.
--
-- The alternatives are worse in the usual two directions: RESTRICT would make a
-- Person who once ran the solver permanently undeletable, and CASCADE would
-- delete the Generation — a timetable — because somebody left.

CREATE OR REPLACE FUNCTION calendry_internal.generation_content_immutable() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    -- OLD with exactly the one FK column NEW claims, and nothing else changed.
    detached public.generation;
BEGIN
    detached := OLD;
    detached.created_by_id := NEW.created_by_id;

    IF NEW IS NOT DISTINCT FROM detached
       -- Only ever CLEARED, never repointed, and it must actually be a detach
       -- so a no-op cannot slip through this branch.
       AND OLD.created_by_id IS NOT NULL
       AND NEW.created_by_id IS NULL
    THEN
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.parent_generation_id IS DISTINCT FROM OLD.parent_generation_id
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.solver_meta IS DISTINCT FROM OLD.solver_meta
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
    THEN
        RAISE EXCEPTION
            'generation % is immutable: only status, is_current, applied_at and infeasibility_report may change',
            OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END $$;


-- ===========================================================================
-- from 20260829120000_person_preference_room_features
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- Which room types a Person would rather teach in
-- ---------------------------------------------------------------------------
--
-- The second axis of `person_preference`, after the day/block one. A lecturer
-- who works better in a lab, or who would rather not be put in the big raked
-- lecture theatre, has had nowhere to say so.
--
-- The wire carries `Preference.preferred_room_features` as a repeated STRING,
-- matched against `Room.feature_tags`' vocabulary by key — so the assembly maps
-- `equipment_id` to `equipment.key` at the boundary, exactly as
-- `room_equipment` and `offering_equipment` already do.
--
-- WHY A TABLE AND NOT A `TEXT[]` COLUMN ON `person_preference`
--
-- Storing keys inline would mirror `preferred_days`/`preferred_blocks`, which
-- sit on that row as arrays — but those are plain scalars with no entity behind
-- them, so there is nothing for them to reference. Equipment IS an entity, and
-- every other reference to it in this schema is an `equipment_id` with a
-- foreign key. A key array would be the single place that is not, and the
-- failure it buys is the silent kind: renaming an Equipment's key would void
-- every person's preference for it, leaving an inert string that no constraint,
-- no query and no report would ever contradict. The FK below cannot be renamed
-- out from under a preference, and a deleted Equipment takes its preferences
-- with it rather than leaving them pointing nowhere.
--
-- ABSENT ROWS MEAN NO PREFERENCE, the same convention the two array columns
-- already use — empty is "no opinion", never "prefers nothing". So this
-- migration needs no backfill and changes no behaviour for any existing row.
--
-- ON `person_preference` AND NOT ON `person`: the parent row already carries
-- `weight_multiplier`, which is how much this person's preferences count. A
-- room preference without that multiplier would be a preference the tenant
-- cannot weigh, so it belongs to the same row's lifetime — including its
-- deletion, which is why the FK below cascades from the preference and not
-- from the Person.
-- ---------------------------------------------------------------------------
CREATE TABLE "person_preference_room_feature" (
    "person_id"    TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "tenant_id"    TEXT NOT NULL,

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "person_preference_room_feature_pkey" PRIMARY KEY ("person_id", "equipment_id")
);

-- CASCADE from the preference row, so `person_preference`'s existing
-- delete-when-empty discipline keeps working: a caller clearing every axis
-- deletes the parent and these go with it, rather than leaving orphan rows that
-- would make an absent preference and an empty one two different states again.
ALTER TABLE "person_preference_room_feature"
    ADD CONSTRAINT "person_preference_room_feature_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "person_preference"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE, not RESTRICT: an Equipment nobody offers any more should be
-- deletable, and a preference for it is inert the moment no Room carries it.
-- RESTRICT would make retiring a tag impossible because one lecturer once
-- ticked it.
ALTER TABLE "person_preference_room_feature"
    ADD CONSTRAINT "person_preference_room_feature_equipment_id_fkey"
    FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "person_preference_room_feature"
    ADD CONSTRAINT "person_preference_room_feature_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "person_preference_room_feature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_preference_room_feature" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "person_preference_room_feature"
    USING (tenant_id = calendry_internal.current_tenant_id())
    WITH CHECK (tenant_id = calendry_internal.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "person_preference_room_feature" TO calendry_app;

-- The solve-time read is "every preference in this tenant", joined to equipment
-- for the key; the person_id-first primary key serves the per-person read.
CREATE INDEX "person_preference_room_feature_tenant_id_idx" ON "person_preference_room_feature" ("tenant_id");
CREATE INDEX "person_preference_room_feature_equipment_id_idx" ON "person_preference_room_feature" ("equipment_id");


-- ===========================================================================
-- from 20260829140000_offering_scheduling_pattern
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- How an Offering's demand should distribute across the Term
-- ---------------------------------------------------------------------------
--
-- `Offering.frequency` says "this happens 12 times" and nothing about HOW those
-- twelve land. Two institutions mean opposite things by it:
--
--   DISTRIBUTED  a consistent weekly slot for the whole Term ("Mondays at 10,
--                every week"). Widely ASSUMED today and enforced by nothing —
--                the solver may legitimately place each week independently, so
--                a course can land on a different day every week.
--   BLOCK        the whole demand concentrated into a short contiguous window
--                ("all twelve in one fortnight"). Common for modular and
--                professional programmes.
--
-- These are not variations of one rule; they pull in opposite directions.
--
-- A NULLABLE COLUMN, AND NULL IS NOT A THIRD PATTERN. It means the Offering has
-- not been classified, which is every Offering that exists today and the honest
-- state for one nobody has thought about. It maps to the wire's
-- `SCHEDULING_PATTERN_UNSPECIFIED`, which is exactly the same claim. Defaulting
-- to DISTRIBUTED would have been the tempting move — it is what most timetables
-- assume — and it would have written an institution's assumption into every
-- existing row as though somebody had chosen it.
--
-- CLASSIFICATION ONLY, IN THIS MIGRATION. Nothing changes about any solve: this
-- column reaches `Offering.scheduling_pattern` on the wire, and the solver acts
-- on it only through the `DistributedPatternAdherence` / `BlockPatternAdherence`
-- constraint types, which no tenant can enable until they exist in the app's own
-- catalogue. So no timetable moves because of this, and a tenant can classify
-- its Offerings before the rule that reads them is switchable.
--
-- A POSTGRES ENUM, not a text column with a CHECK: the values are FIXED by the
-- proto (`SchedulingPattern`), not tenant vocabulary, and TAXONOMY.md's open/
-- fixed split is what decides that. A new pattern is a schema change in three
-- repos, which is precisely the friction an enum should impose here.
-- ---------------------------------------------------------------------------
CREATE TYPE "scheduling_pattern" AS ENUM ('DISTRIBUTED', 'BLOCK');

ALTER TABLE "offering" ADD COLUMN "scheduling_pattern" "scheduling_pattern";


-- ===========================================================================
-- from 20260829160000_offering_required_room_count
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- How many Rooms one Session of an Offering needs AT ONCE
-- ---------------------------------------------------------------------------
--
-- The app could already record that a Session happens to occupy two Rooms. It
-- could not state that an Offering REQUIRES two — a cohort too large for any
-- single hall, a practical needing two labs in parallel.
--
-- Those are different claims. The first is a fact about a placement that
-- already exists; the second is demand the solver must satisfy when choosing
-- where to put one. Only the second can make a placement ineligible.
--
-- NOT NULL DEFAULT 1, and that is a real difference from its neighbours on this
-- table. `required_capacity` is nullable because NULL means DERIVED, and
-- `scheduling_pattern` because NULL means UNCLASSIFIED — in both cases a third
-- state that is not a value. There is no third state here: every Session
-- occupies at least one Room, so 1 is the answer rather than a stand-in for the
-- absence of one. Every existing row means 1 and always did.
--
-- WHY THE CHECK, AND WHY 4 SPECIFICALLY. `MAX_ADDITIONAL_ROOMS = 3` in the
-- solver's `crates/core/src/solution.rs` fixes a Placement's Room array at 1
-- primary + 3 additional, and `convert.rs` REFUSES an Offering above that with
-- `TooManyRoomsRequired` — refuses, not truncates, because a demand it cannot
-- meet is not something to warn-and-allow.
--
-- So a stored 5 is not a large number, it is a term that cannot be solved: every
-- run FAILS for the whole tenant, with an error naming an Offering somebody
-- edited weeks earlier. The database refusing it is the difference between an
-- input mistake caught at the keystroke and a scheduling outage. `shared/
-- rooms.ts` holds the same 4 for the form and the write schema, so the three
-- agree by construction rather than by memory.
--
-- CAPACITY IS SUMMED ACROSS THE COMBINATION, and that is decided upstream, not
-- here: `Offering.required_room_count` in the proto says so in as many words,
-- and the solver builds Room combinations whose capacities it adds before
-- comparing against `min_capacity`. The alternative reading — each Room must
-- independently hold the whole Group — is a coherent thing for a tenant to
-- want, gives the opposite answer on identical input, and is NOT what this
-- column means. The form says which, rather than leaving it to be discovered
-- from a timetable that looks wrong.
-- ---------------------------------------------------------------------------
ALTER TABLE "offering"
    ADD COLUMN "required_room_count" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "offering"
    ADD CONSTRAINT "offering_required_room_count_within_solver_limit"
    CHECK ("required_room_count" BETWEEN 1 AND 4);


-- ===========================================================================
-- from 20260829180000_session_kind_type
-- ===========================================================================
SET search_path = public;

-- ---------------------------------------------------------------------------
-- What ROLE a Session kind plays, as opposed to what a tenant calls it
-- ---------------------------------------------------------------------------
--
-- `session_kind.key` is OPEN vocabulary: a tenant calls its exams `exam`,
-- `Klausur`, `assessment` or anything else, and TAXONOMY.md's open/fixed split
-- means no logic may assume a particular string. That rule stands. What was
-- missing is the other half of it — a way for a tenant to DECLARE that a kind
-- it named itself is an exam, so a rule can act on the declaration instead of
-- on the name.
--
-- Until now the only mechanism was `ConstraintScope`: a tenant hand-scoped
-- `exam_spacing_same_day` to the right kind and the rule worked. Two problems
-- with that, and the second is the reason this exists:
--
--   * `applies_to_kinds` EMPTY MEANS EVERY KIND on the wire, not none. So
--     forgetting to scope those rules does not disable them — it turns "no two
--     exams in a day" into "no two sessions of any kind in a day", silently, as
--     a live rule on the next solve.
--   * The claim "this kind is our exam kind" was expressed once per rule
--     rather than once per kind, so two rules could disagree and nothing could
--     notice.
--
-- A POSTGRES ENUM, not a text column with a CHECK, for the same reason
-- `scheduling_pattern` is one: the values are FIXED (schema-level), while the
-- kind's `key` and `name` stay tenant vocabulary. This column and that column
-- are the fixed/open split drawn through one table.
--
-- ADMIN IS DELIBERATELY UNREAD. Staff meetings, open days — a kind that is
-- neither taught nor assessed. Nothing acts on it today; it exists so the
-- distinction can be recorded before a rule needs it, and so TEACHING does not
-- have to absorb sessions that are not teaching. An unused enum value costs
-- nothing; retrofitting one onto rows already classified costs a data
-- migration nobody can do correctly after the fact.
--
-- DEFAULT 'TEACHING' for every existing row, then corrected below.
-- ---------------------------------------------------------------------------
CREATE TYPE "session_kind_type" AS ENUM ('TEACHING', 'EXAM', 'ADMIN');

ALTER TABLE "session_kind"
    ADD COLUMN "type" "session_kind_type" NOT NULL DEFAULT 'TEACHING';

-- ---------------------------------------------------------------------------
-- Backfill: the data already knows which kind is the exam kind
-- ---------------------------------------------------------------------------
--
-- THIS IS THE HALF THAT CANNOT BE SKIPPED. `exam_spacing_same_day` and
-- `exam_spacing_window` stop reading `ConstraintScope` in this release and read
-- this column instead. A tenant who had hand-scoped one of them to `Klausur`
-- and is not migrated here would have the rule DERIVE AN EMPTY KIND SET — and
-- since the app refuses to send an empty derived scope rather than let it mean
-- "all kinds", the rule would go quiet on the next solve with nothing on screen
-- having changed.
--
-- That is the failure mode this codebase keeps meeting under different names: a
-- rule that looks configured and no longer fires. It is avoidable here because
-- the answer is already written down — scoping `exam_spacing_*` to a kind IS
-- the statement "this kind is an exam", made in the only place that could hold
-- it before this column existed.
--
-- Deliberately NOT filtered on `is_enabled`: a disabled rule still records the
-- tenant's classification, and inferring from enabled rows only would leave a
-- kind unclassified for having its rule temporarily switched off.
-- ---------------------------------------------------------------------------
UPDATE "session_kind" k
SET "type" = 'EXAM'
WHERE EXISTS (
    SELECT 1
    FROM "constraint_scope" cs
    JOIN "constraint_def" c ON c."id" = cs."constraint_id"
    WHERE cs."kind_id" = k."id"
      AND c."type" IN ('exam_spacing_same_day', 'exam_spacing_window')
);


-- ===========================================================================
-- A constraint may be scoped to ONE TimeGrid
-- ===========================================================================
--
-- Several rules are stated in units the grid defines: a gap between lessons, a
-- cap on consecutive teaching blocks, a daily span. An institution running two
-- grids — a 45-minute academic week and a 60-minute evening one, say — cannot
-- mean the same numbers by them, so a tenant-wide row is wrong for one of the
-- two whichever way it is written.
--
-- A COLUMN, NOT A `constraint_scope` ROW, and the difference is the combination
-- rule. Kind scopes are an OR-set: a rule applies to a Session whose kind is
-- ANY of them, and no rows means every kind. A grid is an AND filter on the
-- rule itself: this rule, on this grid, in addition to whatever kinds it names.
-- Putting both in one table would make a row's meaning depend on which column
-- is set — the `group_term` / `group_term_availability` trap, where one table's
-- row existence carried two incompatible claims.
--
-- NULL MEANS EVERY GRID, matching how every other optional scope here reads,
-- and it is what every existing row means.
--
-- ON DELETE CASCADE, deliberately, and SET NULL would have been the bug. A rule
-- scoped to a deleted grid is a rule about something that no longer exists;
-- nulling it would silently WIDEN it from one grid to all of them, which is the
-- opposite of what its author asked for and invisible until a timetable comes
-- back wrong. Cascading deletes the rule, which is at worst a rule that stops
-- applying — the failure direction this codebase prefers.
--
-- The wire carries nothing for this. `SolverInput.time_grid` is SINGULAR: a run
-- is per-Term and a Term has exactly one grid, so the solver never sees two and
-- has nothing to disambiguate. The filter is applied while assembling — a rule
-- naming a different grid than the run's is simply not sent.
-- ---------------------------------------------------------------------------
ALTER TABLE "constraint_def"
    ADD COLUMN "time_grid_id" TEXT;

ALTER TABLE "constraint_def"
    ADD CONSTRAINT "constraint_def_time_grid_id_fkey"
    FOREIGN KEY ("time_grid_id") REFERENCES "time_grid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "constraint_def_time_grid_id_idx" ON "constraint_def"("time_grid_id");
