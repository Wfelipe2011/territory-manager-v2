#!/usr/bin/env bash
set -e

# ---------------------------------------------------------------------------
# Smoke/Teste de Carga — Territory Manager (SSE + REST)
# Uso: ./load-tests/run.sh [SIGNATURE_KEY]
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Parâmetros (podem ser env vars ou argumentos posicionais) -------------
SIGNATURE_KEY="${1:-${SIGNATURE_KEY:-}}"
API_URL="${API_URL:-http://localhost:3000}"
K6_BIN="${K6_BIN:-k6}" # use K6_BIN=/tmp/opencode/k6-sse para o binário custom (xk6-sse)

# --- Validação ---------------------------------------------------------------
if [ -z "$SIGNATURE_KEY" ]; then
  echo ""
  echo "❌  SIGNATURE_KEY não informada."
  echo ""
  echo "Uso:"
  echo "  ./load-tests/run.sh <SIGNATURE_KEY>"
  echo ""
  echo "Exemplos:"
  echo "  ./load-tests/run.sh c6b85860-76b2-4b0e-a8a4-66afc68d926c"
  echo "  API_URL=https://api-hmg.territory-manager.com.br ./load-tests/run.sh <uuid>"
  echo ""
  echo "Ou via env vars:"
  echo "  SIGNATURE_KEY=<uuid> API_URL=<url> ./load-tests/run.sh"
  exit 1
fi

# --- Execução ----------------------------------------------------------------
echo ""
echo "🚀  Iniciando teste de carga (cenários definidos em main.js)..."
echo "    API:      $API_URL"
echo "    Chave:    $SIGNATURE_KEY"
echo "    k6:       $K6_BIN"
echo "    Listeners:${LISTENER_VUS:-1}  Togglers:${TOGGLER_VUS:-1}  Duração:${SSE_DURATION_SECS:-50}s"
echo "    (override via LISTENER_VUS / TOGGLER_VUS / SSE_DURATION_SECS)"
echo ""

"$K6_BIN" run \
  -e SIGNATURE_KEY="$SIGNATURE_KEY" \
  -e API_URL="$API_URL" \
  -e LISTENER_VUS="${LISTENER_VUS:-1}" \
  -e TOGGLER_VUS="${TOGGLER_VUS:-1}" \
  -e SSE_DURATION_SECS="${SSE_DURATION_SECS:-50}" \
  -e ENABLE_SSE="${ENABLE_SSE:-1}" \
  ${K6_ARGS:-} \
  ${OUTPUT_JSON:+--out json="$OUTPUT_JSON"} \
  "$SCRIPT_DIR/main.js"
