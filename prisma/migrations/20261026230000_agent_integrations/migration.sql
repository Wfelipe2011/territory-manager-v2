CREATE TABLE "agent_oauth_artifact" (
  "key" TEXT PRIMARY KEY, "model" TEXT NOT NULL, "payload" TEXT NOT NULL,
  "grantId" TEXT, "uid" TEXT UNIQUE, "userCode" TEXT UNIQUE, "consumedAt" INTEGER,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "agent_oauth_artifact_grantId_idx" ON "agent_oauth_artifact"("grantId");
CREATE INDEX "agent_oauth_artifact_expiresAt_idx" ON "agent_oauth_artifact"("expiresAt");
CREATE TABLE "agent_connection" (
  "id" TEXT PRIMARY KEY, "userId" INTEGER NOT NULL, "tenantId" INTEGER NOT NULL,
  "clientId" TEXT NOT NULL, "clientName" TEXT NOT NULL, "credentialVersion" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3)
);
CREATE INDEX "agent_connection_tenantId_userId_idx" ON "agent_connection"("tenantId", "userId");
CREATE TABLE "agent_operation" (
  "connectionId" TEXT NOT NULL, "key" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "result" JSONB NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("connectionId", "key")
);
CREATE INDEX "agent_operation_expiresAt_idx" ON "agent_operation"("expiresAt");
CREATE TABLE "agent_audit" (
  "id" SERIAL PRIMARY KEY, "tenantId" INTEGER NOT NULL, "userId" INTEGER NOT NULL,
  "clientId" TEXT NOT NULL, "connectionId" TEXT NOT NULL, "tool" TEXT NOT NULL,
  "recordId" INTEGER, "outcome" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "agent_audit_tenantId_createdAt_idx" ON "agent_audit"("tenantId", "createdAt");
