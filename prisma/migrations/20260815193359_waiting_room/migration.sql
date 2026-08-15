-- AlterTable
ALTER TABLE "signature" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'territory',
ADD COLUMN     "revoked_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "group" (
    "id" TEXT NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publisher" (
    "id" TEXT NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "identityKey" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phoneLast4" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publisher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment" (
    "id" TEXT NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "publisherId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "blockId" INTEGER NOT NULL,
    "territoryId" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiting_room_presence" (
    "id" TEXT NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "groupId" TEXT NOT NULL,
    "territoryId" INTEGER,
    "round" INTEGER,
    "identityKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "displayName" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiting_room_presence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_tenantId_idx" ON "group"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "group_tenantId_name_key" ON "group"("tenantId", "name");

-- CreateIndex
CREATE INDEX "publisher_tenantId_idx" ON "publisher"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "publisher_tenantId_identityKey_key" ON "publisher"("tenantId", "identityKey");

-- CreateIndex
CREATE INDEX "assignment_tenantId_idx" ON "assignment"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_publisherId_blockId_key" ON "assignment"("publisherId", "blockId");

-- CreateIndex
CREATE UNIQUE INDEX "waiting_room_presence_groupId_identityKey_key" ON "waiting_room_presence"("groupId", "identityKey");
