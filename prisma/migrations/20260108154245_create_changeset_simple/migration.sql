-- CreateTable
CREATE TABLE "ChangeSet" (
    "idString" TEXT NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "batchId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeSet_pkey" PRIMARY KEY ("idString")
);

-- CreateIndex
CREATE INDEX "ChangeSet_tenantId_idx" ON "ChangeSet"("tenantId");
