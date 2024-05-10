/*
  Warnings:

  - You are about to drop the column `count` on the `Socket` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[socketId]` on the table `Socket` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `socketId` to the `Socket` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Socket_room_key";

-- AlterTable
ALTER TABLE "Socket" DROP COLUMN "count",
ADD COLUMN     "socketId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Socket_socketId_key" ON "Socket"("socketId");
