-- CreateTable
CREATE TABLE "parameter" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "tenant_id" INTEGER NOT NULL,

    CONSTRAINT "parameter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parameter_id_key" ON "parameter"("id");

-- CreateIndex
CREATE UNIQUE INDEX "parameter_tenant_id_key_key" ON "parameter"("tenant_id", "key");

-- AddForeignKey
ALTER TABLE "parameter" ADD CONSTRAINT "parameter_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
