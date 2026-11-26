-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('pending', 'sent', 'success', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "CommandChannel" AS ENUM ('push', 'pull');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "created_in_app" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dev_privilege" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN     "device_password" VARCHAR(8);

-- AlterTable
ALTER TABLE "zk_devices" ADD COLUMN     "operlog_stamp" VARCHAR(32);

-- CreateTable
CREATE TABLE "device_commands" (
    "id" SERIAL NOT NULL,
    "device_id" INTEGER NOT NULL,
    "channel" "CommandChannel" NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "command" TEXT NOT NULL,
    "payload" JSONB,
    "emp_code" VARCHAR(32),
    "status" "CommandStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(0),
    "return_code" INTEGER,
    "result" TEXT,
    "created_by" VARCHAR(64),
    "created_at" TIMESTAMP(0) NOT NULL,
    "sent_at" TIMESTAMP(0),
    "completed_at" TIMESTAMP(0),

    CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biometric_templates" (
    "id" SERIAL NOT NULL,
    "emp_code" VARCHAR(32) NOT NULL,
    "bio_type" SMALLINT NOT NULL,
    "bio_index" SMALLINT NOT NULL,
    "sub_index" SMALLINT NOT NULL DEFAULT 0,
    "format" VARCHAR(16) NOT NULL,
    "fields" JSONB NOT NULL,
    "tmp_key" VARCHAR(8) NOT NULL DEFAULT 'TMP',
    "template" TEXT NOT NULL,
    "source_sn" VARCHAR(64),
    "created_at" TIMESTAMP(0) NOT NULL,
    "updated_at" TIMESTAMP(0) NOT NULL,

    CONSTRAINT "biometric_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_commands_device_id_status_id_idx" ON "device_commands"("device_id", "status", "id");

-- CreateIndex
CREATE INDEX "device_commands_emp_code_id_idx" ON "device_commands"("emp_code", "id");

-- CreateIndex
CREATE INDEX "device_commands_status_next_attempt_at_idx" ON "device_commands"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "device_commands_created_at_idx" ON "device_commands"("created_at");

-- CreateIndex
CREATE INDEX "biometric_templates_emp_code_idx" ON "biometric_templates"("emp_code");

-- CreateIndex
CREATE UNIQUE INDEX "biometric_templates_emp_code_bio_type_bio_index_sub_index_key" ON "biometric_templates"("emp_code", "bio_type", "bio_index", "sub_index");

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "zk_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
