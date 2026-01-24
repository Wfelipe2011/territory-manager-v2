-- CreateEnum
CREATE TYPE "FinancialEntryType" AS ENUM ('POSITIVE', 'NEGATIVE');

-- CreateTable
CREATE TABLE "financial_entry" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "description" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "cycle" INTEGER NOT NULL,
    "type" "FinancialEntryType" NOT NULL,
    "donor_name" TEXT,
    "external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_entry_id_key" ON "financial_entry"("id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entry_external_id_key" ON "financial_entry"("external_id");

-- CreateIndex
CREATE INDEX "financial_entry_tenant_id_cycle_idx" ON "financial_entry"("tenant_id", "cycle");

-- AddForeignKey
ALTER TABLE "financial_entry" ADD CONSTRAINT "financial_entry_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
