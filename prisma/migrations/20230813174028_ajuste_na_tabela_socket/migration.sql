/*
  Warnings:

  - You are about to drop the column `socketId` on the `Socket` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[room]` on the table `Socket` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `room` to the `Socket` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Socket_socketId_key";

-- AlterTable
ALTER TABLE "Socket" DROP COLUMN "socketId",
ADD COLUMN     "count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "room" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Socket_room_key" ON "Socket"("room");
