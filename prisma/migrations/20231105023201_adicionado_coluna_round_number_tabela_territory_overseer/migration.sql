/*
  Warnings:

  - Added the required column `round_number` to the `territory_overseer` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "territory_overseer" ADD COLUMN     "round_number" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "territory_overseer_territory_id_round_number_idx" ON "territory_overseer"("territory_id", "round_number");
