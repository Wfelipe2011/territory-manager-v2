-- CreateEnum
CREATE TYPE "ThemeMode" AS ENUM ('default', 'campaign', 'letters');

-- AlterTable
ALTER TABLE "round" ADD COLUMN     "mode" "ThemeMode" NOT NULL DEFAULT 'default';
