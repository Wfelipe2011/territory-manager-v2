-- AlterTable
ALTER TABLE "house" ADD COLUMN     "territory_block_address_id" INTEGER;

-- CreateTable
CREATE TABLE "territory_block_address" (
    "id" SERIAL NOT NULL,
    "territory_block_id" INTEGER NOT NULL,
    "address_id" INTEGER NOT NULL,
    "tenant_id" INTEGER NOT NULL,

    CONSTRAINT "territory_block_address_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "territory_block_address_id_key" ON "territory_block_address"("id");

-- CreateIndex
CREATE UNIQUE INDEX "territory_block_address_territory_block_id_address_id_key" ON "territory_block_address"("territory_block_id", "address_id");

-- AddForeignKey
ALTER TABLE "house" ADD CONSTRAINT "house_territory_block_address_id_fkey" FOREIGN KEY ("territory_block_address_id") REFERENCES "territory_block_address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_block_address" ADD CONSTRAINT "territory_block_address_territory_block_id_fkey" FOREIGN KEY ("territory_block_id") REFERENCES "territory_block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_block_address" ADD CONSTRAINT "territory_block_address_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_block_address" ADD CONSTRAINT "territory_block_address_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
