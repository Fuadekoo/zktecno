-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'viewer');

-- CreateEnum
CREATE TYPE "SyncJob" AS ENUM ('devices', 'employees', 'punches');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('startup', 'schedule', 'manual', 'personnel_change', 'range');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('running', 'success', 'failed');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'success', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "full_name" VARCHAR(128),
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'viewer',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0) NOT NULL,
    "updated_at" TIMESTAMP(0) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" INTEGER NOT NULL,
    "emp_code" VARCHAR(32) NOT NULL,
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "department_id" INTEGER,
    "department_name" VARCHAR(128),
    "position_name" VARCHAR(128),
    "area_names" VARCHAR(512),
    "card_no" VARCHAR(32),
    "mobile" VARCHAR(32),
    "email" VARCHAR(128),
    "gender" VARCHAR(8),
    "hire_date" VARCHAR(10),
    "enable_att" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMP(0) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" INTEGER NOT NULL,
    "sn" VARCHAR(64) NOT NULL,
    "alias" VARCHAR(128),
    "ip_address" VARCHAR(64),
    "state" SMALLINT,
    "area_name" VARCHAR(128),
    "fw_ver" VARCHAR(64),
    "last_activity" TIMESTAMP(0),
    "user_count" INTEGER,
    "fp_count" INTEGER,
    "face_count" INTEGER,
    "transaction_count" INTEGER,
    "synced_at" TIMESTAMP(0) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "punches" (
    "id" INTEGER NOT NULL,
    "emp_code" VARCHAR(32) NOT NULL,
    "punch_time" TIMESTAMP(0) NOT NULL,
    "punch_state" VARCHAR(8),
    "verify_type" SMALLINT,
    "work_code" VARCHAR(32),
    "terminal_sn" VARCHAR(64),
    "terminal_alias" VARCHAR(128),
    "area_alias" VARCHAR(128),
    "upload_time" TIMESTAMP(0),
    "sync_run_id" INTEGER,
    "synced_at" TIMESTAMP(0) NOT NULL,

    CONSTRAINT "punches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" SERIAL NOT NULL,
    "job" "SyncJob" NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(0) NOT NULL,
    "finished_at" TIMESTAMP(0),
    "duration_ms" INTEGER,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "removed" INTEGER NOT NULL DEFAULT 0,
    "range_from" TIMESTAMP(0),
    "range_to" TIMESTAMP(0),
    "cursor_at" TIMESTAMP(0),
    "webhooks_queued" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "username" VARCHAR(64),
    "action" VARCHAR(32) NOT NULL,
    "entity" VARCHAR(32) NOT NULL,
    "entity_id" VARCHAR(64),
    "summary" VARCHAR(255),
    "details" JSONB,
    "ip" VARCHAR(64),
    "created_at" TIMESTAMP(0) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "secret" VARCHAR(128) NOT NULL,
    "events" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_delivery_at" TIMESTAMP(0),
    "last_status" "DeliveryStatus",
    "created_at" TIMESTAMP(0) NOT NULL,
    "updated_at" TIMESTAMP(0) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" SERIAL NOT NULL,
    "webhook_id" INTEGER NOT NULL,
    "sync_run_id" INTEGER,
    "event" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(0),
    "response_status" INTEGER,
    "response_body" TEXT,
    "error" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(0) NOT NULL,
    "delivered_at" TIMESTAMP(0),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "employees_emp_code_idx" ON "employees"("emp_code");

-- CreateIndex
CREATE INDEX "employees_department_id_idx" ON "employees"("department_id");

-- CreateIndex
CREATE INDEX "devices_sn_idx" ON "devices"("sn");

-- CreateIndex
CREATE INDEX "punches_punch_time_idx" ON "punches"("punch_time");

-- CreateIndex
CREATE INDEX "punches_emp_code_punch_time_idx" ON "punches"("emp_code", "punch_time");

-- CreateIndex
CREATE INDEX "punches_terminal_sn_punch_time_idx" ON "punches"("terminal_sn", "punch_time");

-- CreateIndex
CREATE INDEX "punches_sync_run_id_idx" ON "punches"("sync_run_id");

-- CreateIndex
CREATE INDEX "sync_runs_job_status_started_at_idx" ON "sync_runs"("job", "status", "started_at");

-- CreateIndex
CREATE INDEX "sync_runs_started_at_idx" ON "sync_runs"("started_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_id_created_at_idx" ON "webhook_deliveries"("webhook_id", "created_at");

-- AddForeignKey
ALTER TABLE "punches" ADD CONSTRAINT "punches_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
