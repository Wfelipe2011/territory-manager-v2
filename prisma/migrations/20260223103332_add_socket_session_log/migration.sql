/*
  Warnings:

  - Added the required column `tenant_id` to the `socket` table without a default value. This is not possible if the table is not empty.

*/
-- Dados de socket são efêmeros (sessões ativas); truncar antes de adicionar coluna obrigatória
TRUNCATE TABLE "socket" RESTART IDENTITY CASCADE;

-- AlterTable
ALTER TABLE "socket" ADD COLUMN     "disconnected_at" TIMESTAMP(3),
ADD COLUMN     "tenant_id" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "socket_created_at_idx" ON "socket"("created_at");

-- CreateIndex
CREATE INDEX "socket_tenant_id_created_at_idx" ON "socket"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "socket" ADD CONSTRAINT "socket_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
