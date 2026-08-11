-- Identidade derivada do JWT `id` (signature UUID). Inicialmente substitute para user_id INTEGER.
ALTER TABLE "street_presence" ADD COLUMN "identity_key" VARCHAR(128) NOT NULL DEFAULT '__placeholder__';

ALTER TABLE "street_presence" ALTER COLUMN "identity_key" DROP DEFAULT;

-- user_id deixa de ser obrigatório: identidade pode ser signature-only.
ALTER TABLE "street_presence" ALTER COLUMN "user_id" DROP NOT NULL;

-- getCount usa DISTINCT identity_key. Índice composto cobre a query.
CREATE INDEX "street_presence_street_key_identity_key_idx" ON "street_presence"("street_key", "identity_key");
