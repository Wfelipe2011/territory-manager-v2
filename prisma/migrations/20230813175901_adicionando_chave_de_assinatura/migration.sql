/*
  Warnings:

  - You are about to drop the `Socket` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "Socket";

-- CreateTable
CREATE TABLE "socket" (
    "id" SERIAL NOT NULL,
    "socketId" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signature_key" TEXT NOT NULL,

    CONSTRAINT "socket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "socket_id_key" ON "socket"("id");

-- CreateIndex
CREATE UNIQUE INDEX "socket_socketId_key" ON "socket"("socketId");

-- AddForeignKey
ALTER TABLE "socket" ADD CONSTRAINT "socket_signature_key_fkey" FOREIGN KEY ("signature_key") REFERENCES "signature"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
