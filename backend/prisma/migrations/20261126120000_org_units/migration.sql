-- CreateEnum
CREATE TYPE "OrgUnitKind" AS ENUM ('department', 'area', 'position');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN "position_id" INTEGER,
ADD COLUMN "area_ids" JSONB;

-- CreateTable
CREATE TABLE "org_units" (
    "id" SERIAL NOT NULL,
    "kind" "OrgUnitKind" NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "parent_id" INTEGER,
    "created_at" TIMESTAMP(0) NOT NULL,
    "updated_at" TIMESTAMP(0) NOT NULL,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_units_kind_idx" ON "org_units"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "org_units_kind_code_key" ON "org_units"("kind", "code");
