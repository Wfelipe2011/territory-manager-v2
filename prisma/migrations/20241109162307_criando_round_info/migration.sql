-- CreateTable
CREATE TABLE "round_info" (
    "id" SERIAL NOT NULL,
    "round_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "theme" "ThemeMode" NOT NULL,
    "tenant_id" INTEGER NOT NULL,

    CONSTRAINT "round_info_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "round_info_id_key" ON "round_info"("id");

-- CreateIndex
CREATE UNIQUE INDEX "round_info_tenant_id_round_number_key" ON "round_info"("tenant_id", "round_number");
