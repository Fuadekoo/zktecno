-- AlterEnum
ALTER TYPE "SyncJob" ADD VALUE 'device_punches';

-- CreateEnum
CREATE TYPE "PunchSource" AS ENUM ('biotime', 'device');

-- AlterTable
ALTER TABLE "punches" ADD COLUMN     "source" "PunchSource" NOT NULL DEFAULT 'biotime';
