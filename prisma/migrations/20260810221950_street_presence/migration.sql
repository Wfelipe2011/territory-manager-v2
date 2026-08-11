-- Street presence — fonte global de presença por usuário na Rua (SSE).
-- Cada conexão SSE registra uma linha. Heartbeat atualiza last_seen_at.
-- Cleanup remove linhas com last_seen_at > 2 min (instante morta sem disconnect).
CREATE TABLE "street_presence" (
    "presence_id"   UUID         NOT NULL,
    "street_key"    TEXT         NOT NULL,
    "user_id"       INTEGER      NOT NULL,
    "connection_id" UUID         NOT NULL,
    "instance_id"   TEXT         NOT NULL,
    "connected_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "street_presence_pkey" PRIMARY KEY ("presence_id")
);

-- Um connection_id só pode estar em UMA rua por vez.
CREATE UNIQUE INDEX "street_presence_connection_id_key" ON "street_presence"("connection_id");

-- getCount(street_key) filtra por último heartbeat — precisa de índice composto.
CREATE INDEX "street_presence_street_key_last_seen_at_idx" ON "street_presence"("street_key", "last_seen_at");

-- Cleanup varre por last_seen_at.
CREATE INDEX "street_presence_last_seen_at_idx" ON "street_presence"("last_seen_at");
