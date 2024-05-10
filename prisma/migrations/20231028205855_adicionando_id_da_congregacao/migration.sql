/*
  Warnings:

  - Added the required column `congregation_id` to the `signature` table without a default value. This is not possible if the table is not empty.
  - Added the required column `congregation_id` to the `territory_overseer` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "signature" ADD COLUMN     "congregation_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "territory_overseer" ADD COLUMN     "congregation_id" INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE "territory_overseer" ADD CONSTRAINT "territory_overseer_congregation_id_fkey" FOREIGN KEY ("congregation_id") REFERENCES "congregation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature" ADD CONSTRAINT "signature_congregation_id_fkey" FOREIGN KEY ("congregation_id") REFERENCES "congregation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
