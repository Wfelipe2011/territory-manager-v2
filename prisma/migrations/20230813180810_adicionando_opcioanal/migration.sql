-- DropForeignKey
ALTER TABLE "socket" DROP CONSTRAINT "socket_signature_key_fkey";

-- AlterTable
ALTER TABLE "socket" ALTER COLUMN "signature_key" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "socket" ADD CONSTRAINT "socket_signature_key_fkey" FOREIGN KEY ("signature_key") REFERENCES "signature"("key") ON DELETE SET NULL ON UPDATE CASCADE;

