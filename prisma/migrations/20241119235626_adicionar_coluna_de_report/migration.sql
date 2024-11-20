-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('add', 'remove', 'update');

-- AlterTable
ALTER TABLE "house" ADD COLUMN     "report_type" "ReportType";
