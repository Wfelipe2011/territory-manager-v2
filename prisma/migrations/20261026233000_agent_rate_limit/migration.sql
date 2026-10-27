CREATE TABLE "agent_rate_limit" ("key" TEXT PRIMARY KEY, "count" INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "agent_rate_limit_expiresAt_idx" ON "agent_rate_limit"("expiresAt");
