/*
  Warnings:

  - A unique constraint covering the columns `[house_id,territory_id,block_id,tenant_id,round_number]` on the table `round` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `block_id` to the `round` table without a default value. This is not possible if the table is not empty.
  - Added the required column `round_number` to the `round` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "house" ADD COLUMN     "observations" TEXT;

-- AlterTable
ALTER TABLE "round" ADD COLUMN     "block_id" INTEGER NOT NULL,
ADD COLUMN     "round_number" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "round_house_id_territory_id_block_id_tenant_id_round_number_key" ON "round"("house_id", "territory_id", "block_id", "tenant_id", "round_number");

-- AddForeignKey
ALTER TABLE "round" ADD CONSTRAINT "round_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

