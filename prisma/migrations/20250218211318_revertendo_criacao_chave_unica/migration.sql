/*
  Warnings:

  - A unique constraint covering the columns `[territory_id,block_id]` on the table `territory_block` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "territory_block_territory_id_block_id_tenant_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "territory_block_territory_id_block_id_key" ON "territory_block"("territory_id", "block_id");
