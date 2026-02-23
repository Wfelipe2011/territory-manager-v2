#!/usr/bin/env bash
set -e

# ---------------------------------------------------------------------------
# Teste de Carga — Territory Manager
# Uso: ./load-tests/run.sh [SIGNATURE_KEY] [VUs] [DURATION]
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Parâmetros (podem ser env vars ou argumentos posicionais) -------------
SIGNATURE_KEY="${1:-${SIGNATURE_KEY:-}}"
VUS="${2:-${VUS:-}}"
DURATION="${3:-${DURATION:-}}"
API_URL="${API_URL:-http://localhost:3000}"
WS_URL="${WS_URL:-ws://localhost:3000}"
USERNAME="${USERNAME:-k6-load-tester}"

# --- Validação ---------------------------------------------------------------
if [ -z "$SIGNATURE_KEY" ]; then
  echo ""
  echo "❌  SIGNATURE_KEY não informada."
  echo ""
  echo "Uso:"
  echo "  ./load-tests/run.sh <SIGNATURE_KEY> [VUs] [DURATION]"
  echo ""
  echo "Exemplos:"
  echo "  ./load-tests/run.sh c6b85860-76b2-4b0e-a8a4-66afc68d926c"
  echo "  ./load-tests/run.sh c6b85860-76b2-4b0e-a8a4-66afc68d926c 10 2m"
  echo ""
  echo "Ou via env vars:"
  echo "  SIGNATURE_KEY=<uuid> VUS=10 DURATION=2m ./load-tests/run.sh"
  exit 1
fi

# --- Monta args opcionais de sobrescrita de carga ----------------------------
EXTRA_ARGS=()
if [ -n "$VUS" ] && [ -n "$DURATION" ]; then
  EXTRA_ARGS+=(--vus "$VUS" --duration "$DURATION")
  echo "⚙️  Modo manual: ${VUS} VUs por ${DURATION} (sobrescreve os stages do script)"
else
  echo "⚙️  Usando stages definidos em main.js"
fi

# --- Execução ----------------------------------------------------------------
echo ""
echo "🚀  Iniciando teste de carga..."
echo "    API:      $API_URL"
echo "    WS:       $WS_URL"
echo "    Chave:    $SIGNATURE_KEY"
echo ""

k6 run \
  -e SIGNATURE_KEY="$SIGNATURE_KEY" \
  -e API_URL="$API_URL" \
  -e WS_URL="$WS_URL" \
  -e USERNAME="$USERNAME" \
  "${EXTRA_ARGS[@]}" \
  "$SCRIPT_DIR/main.js"
