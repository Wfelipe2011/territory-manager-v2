-- CreateIndex
CREATE INDEX "house_tenant_id_idx" ON "house"("tenant_id");

-- CreateIndex
CREATE INDEX "house_territory_id_block_id_address_id_idx" ON "house"("territory_id", "block_id", "address_id");

-- CreateIndex
CREATE INDEX "house_territory_block_address_id_idx" ON "house"("territory_block_address_id");

-- CreateIndex
CREATE INDEX "round_house_id_round_number_idx" ON "round"("house_id", "round_number");

-- CreateIndex
CREATE INDEX "round_tenant_id_idx" ON "round"("tenant_id");

-- CreateIndex
CREATE INDEX "territory_block_tenant_id_idx" ON "territory_block"("tenant_id");

-- CreateIndex
CREATE INDEX "territory_block_address_tenant_id_idx" ON "territory_block_address"("tenant_id");
