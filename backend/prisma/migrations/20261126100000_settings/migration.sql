-- CreateEnum
CREATE TYPE "DeviceMode" AS ENUM ('pull', 'push', 'both');

-- CreateTable
CREATE TABLE "zk_devices" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "mode" "DeviceMode" NOT NULL DEFAULT 'pull',
    "ip" VARCHAR(64),
    "port" INTEGER NOT NULL DEFAULT 4370,
    "serial_number" VARCHAR(64),
    "location" VARCHAR(128),
    "timeout_ms" INTEGER NOT NULL DEFAULT 10000,
    "chunk_size" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "model" VARCHAR(100),
    "firmware" VARCHAR(100),
    "last_seen_at" TIMESTAMP(0),
    "created_at" TIMESTAMP(0) NOT NULL,
    "updated_at" TIMESTAMP(0) NOT NULL,

    CONSTRAINT "zk_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(0) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "zk_devices_serial_number_key" ON "zk_devices"("serial_number");
