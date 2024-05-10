/*
  Warnings:

  - You are about to drop the column `congregation_id` on the `address` table. All the data in the column will be lost.
  - You are about to drop the column `congregation_id` on the `block` table. All the data in the column will be lost.
  - You are about to drop the column `congregation_id` on the `house` table. All the data in the column will be lost.
  - You are about to drop the column `congregation_id` on the `round` table. All the data in the column will be lost.
  - You are about to drop the column `congregation_id` on the `signature` table. All the data in the column will be lost.
  - You are about to drop the column `congregation_id` on the `territory` table. All the data in the column will be lost.
  - You are about to drop the column `congregation_id` on the `territory_block` table. All the data in the column will be lost.
  - You are about to drop the column `congregation_id` on the `territory_overseer` table. All the data in the column will be lost.
  - You are about to drop the column `congregation_id` on the `type` table. All the data in the column will be lost.
  - You are about to drop the column `congregation_id` on the `user` table. All the data in the column will be lost.
  - You are about to drop the `congregation` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `tenant_id` to the `address` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenant_id` to the `block` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenant_id` to the `house` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenant_id` to the `round` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenant_id` to the `signature` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenant_id` to the `territory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenant_id` to the `territory_block` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenant_id` to the `territory_overseer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenant_id` to the `type` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenant_id` to the `user` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "address" DROP CONSTRAINT "address_congregation_id_fkey";

-- DropForeignKey
ALTER TABLE "block" DROP CONSTRAINT "block_congregation_id_fkey";

-- DropForeignKey
ALTER TABLE "house" DROP CONSTRAINT "house_congregation_id_fkey";

-- DropForeignKey
ALTER TABLE "round" DROP CONSTRAINT "round_congregation_id_fkey";

-- DropForeignKey
ALTER TABLE "signature" DROP CONSTRAINT "signature_congregation_id_fkey";

-- DropForeignKey
ALTER TABLE "territory" DROP CONSTRAINT "territory_congregation_id_fkey";

-- DropForeignKey
ALTER TABLE "territory_block" DROP CONSTRAINT "territory_block_congregation_id_fkey";

-- DropForeignKey
ALTER TABLE "territory_overseer" DROP CONSTRAINT "territory_overseer_congregation_id_fkey";

-- DropForeignKey
ALTER TABLE "type" DROP CONSTRAINT "type_congregation_id_fkey";

-- DropForeignKey
ALTER TABLE "user" DROP CONSTRAINT "user_congregation_id_fkey";

-- AlterTable
ALTER TABLE "address" DROP COLUMN "congregation_id",
ADD COLUMN     "tenant_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "block" DROP COLUMN "congregation_id",
ADD COLUMN     "tenant_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "house" DROP COLUMN "congregation_id",
ADD COLUMN     "tenant_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "round" DROP COLUMN "congregation_id",
ADD COLUMN     "tenant_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "signature" DROP COLUMN "congregation_id",
ADD COLUMN     "tenant_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "territory" DROP COLUMN "congregation_id",
ADD COLUMN     "tenant_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "territory_block" DROP COLUMN "congregation_id",
ADD COLUMN     "tenant_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "territory_overseer" DROP COLUMN "congregation_id",
ADD COLUMN     "tenant_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "type" DROP COLUMN "congregation_id",
ADD COLUMN     "tenant_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "user" DROP COLUMN "congregation_id",
ADD COLUMN     "tenant_id" INTEGER NOT NULL;

-- DropTable
DROP TABLE "congregation";

-- CreateTable
CREATE TABLE "multi_tenancy" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "multi_tenancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "multi_tenancy_id_key" ON "multi_tenancy"("id");

-- AddForeignKey
ALTER TABLE "address" ADD CONSTRAINT "address_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "type" ADD CONSTRAINT "type_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block" ADD CONSTRAINT "block_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house" ADD CONSTRAINT "house_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory" ADD CONSTRAINT "territory_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_block" ADD CONSTRAINT "territory_block_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_overseer" ADD CONSTRAINT "territory_overseer_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round" ADD CONSTRAINT "round_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature" ADD CONSTRAINT "signature_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
