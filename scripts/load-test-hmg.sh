#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BASE_URL="https://api-hmg.territory-manager.com.br"

# Carrega .env sem sobrescrever variáveis já exportadas no shell
set -a
source "$ROOT_DIR/.env"
set +a

: "${HMG_ADMIN_EMAIL:?HMG_ADMIN_EMAIL não definido no .env}"
: "${HMG_ADMIN_PASSWORD:?HMG_ADMIN_PASSWORD não definido no .env}"
: "${HMG_TERRITORY_ID:?HMG_TERRITORY_ID não definido no .env}"
: "${HMG_ROUND_NUMBER:?HMG_ROUND_NUMBER não definido no .env}"

echo "[load-test:hmg] gerando SIGNATURE_KEY em $BASE_URL..."
OUTPUT=$(npx tsx "$SCRIPT_DIR/generate-signature-key.ts" \
  --territory "$HMG_TERRITORY_ID" \
  --round "$HMG_ROUND_NUMBER" \
  --email "$HMG_ADMIN_EMAIL" \
  --password "$HMG_ADMIN_PASSWORD")
echo "$OUTPUT"
SIGNATURE_KEY=$(echo "$OUTPUT" | grep -oP 'SIGNATURE_KEY=\K.*')

echo "[load-test:hmg] rodando k6 contra $BASE_URL..."
k6 run \
  -e API_URL="$BASE_URL" \
  -e WS_URL="wss://api-hmg.territory-manager.com.br" \
  -e SIGNATURE_KEY="$SIGNATURE_KEY" \
  "$ROOT_DIR/load-tests/main.js"
