#!/usr/bin/env bash
set -e

# ---------------------------------------------------------------------------
# Comparativo HMG vs PRD — mesmo perfil de carga nos dois ambientes
# Uso: ./load-tests/compare.sh <SIGNATURE_KEY>   (ou env SIGNATURE_KEY)
# Chaves separadas por ambiente:
#   HMG_SIGNATURE_KEY=<uuid> PRD_SIGNATURE_KEY=<uuid> ./load-tests/compare.sh
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Parâmetros --------------------------------------------------------------
SIGNATURE_KEY="${1:-${SIGNATURE_KEY:-}}"
HMG_SIGNATURE_KEY="${HMG_SIGNATURE_KEY:-$SIGNATURE_KEY}"
PRD_SIGNATURE_KEY="${PRD_SIGNATURE_KEY:-$SIGNATURE_KEY}"
LISTENER_VUS="${LISTENER_VUS:-2}"
TOGGLER_VUS="${TOGGLER_VUS:-3}"
SSE_DURATION_SECS="${SSE_DURATION_SECS:-60}"
K6_BIN="${K6_BIN:-/tmp/opencode/k6-sse}"
RESULTS_DIR="${RESULTS_DIR:-$SCRIPT_DIR/results}"
# PRD ainda não tem SSE — compare roda o listener só na HMG.
# Quando o PRD tiver SSE: PRD_SSE=1
HMG_ENABLE_SSE="${HMG_ENABLE_SSE:-1}"
PRD_ENABLE_SSE="${PRD_ENABLE_SSE:-0}"

# --- Validação ---------------------------------------------------------------
if [ -z "$SIGNATURE_KEY" ] && [ -z "$HMG_SIGNATURE_KEY" ] && [ -z "$PRD_SIGNATURE_KEY" ]; then
  echo "❌  Informe a SIGNATURE_KEY (ou HMG_SIGNATURE_KEY/PRD_SIGNATURE_KEY)."
  echo "    IMPORTANTE: a chave da HMG normalmente NÃO existe no PRD."
  exit 1
fi

mkdir -p "$RESULTS_DIR"

# --- Execução: HMG depois PRD ------------------------------------------------
declare -A ENVS=(
  [HMG]="https://api-hmg.territory-manager.com.br"
  [PRD]="https://api.territory-manager.com.br"
)

declare -A EXIT_CODES=()

for ENV_NAME in HMG PRD; do
  API_URL="${ENVS[$ENV_NAME]}"
  KEY_VAR="${ENV_NAME}_SIGNATURE_KEY"
  KEY="${!KEY_VAR}"
  SSE_FLAG_VAR="${ENV_NAME}_ENABLE_SSE"
  SSE_FLAG="${!SSE_FLAG_VAR}"

  echo ""
  echo "=============================================================="
  echo "🚀  Rodando perfil leve (${LISTENER_VUS}L/${TOGGLER_VUS}T/${SSE_DURATION_SECS}s) em $ENV_NAME"
  echo "    API: $API_URL | SSE: $([ "$SSE_FLAG" = "1" ] && echo 'sim' || echo 'não (REST only)')"
  echo "=============================================================="

  set +e
  API_URL="$API_URL" SIGNATURE_KEY="$KEY" K6_BIN="$K6_BIN" \
  LISTENER_VUS="$LISTENER_VUS" TOGGLER_VUS="$TOGGLER_VUS" \
  SSE_DURATION_SECS="$SSE_DURATION_SECS" ENABLE_SSE="$SSE_FLAG" \
  K6_ARGS="${K6_ARGS:---quiet --log-format raw}" \
  OUTPUT_JSON="$RESULTS_DIR/$ENV_NAME.json" \
  "$SCRIPT_DIR/run.sh"
  EXIT_CODES[$ENV_NAME]=$?
  set -e

  # Validação da chave: 404 vira JSON vazio e o parser avisa
  if [ ! -s "$RESULTS_DIR/$ENV_NAME.json" ]; then
    echo "⚠️  $ENV_NAME: sem saída JSON (chave inválida ou erro no setup?)"
    rm -f "$RESULTS_DIR/$ENV_NAME.json"
  fi
done

# --- Comparação --------------------------------------------------------------
echo ""
echo "=============================================================="
echo "📊  Comparativo HMG vs PRD ($RESULTS_DIR)"
echo "=============================================================="

node "$SCRIPT_DIR/compare-results.js" \
  "$RESULTS_DIR/HMG.json" "$RESULTS_DIR/PRD.json" \
  "HMG" "PRD"

echo ""
# Exit codes k6: 0=ok · 1=thresholds cruzados · 99=script exception · 107=setup error
for ENV_NAME in HMG PRD; do
  CODE="${EXIT_CODES[$ENV_NAME]:-0}"
  case "$CODE" in
    0)  echo "✅  $ENV_NAME: sucesso" ;;
    1)  echo "⚠️  $ENV_NAME: thresholds cruzados" ;;
    99) echo "⚠️  $ENV_NAME: script exception (exit 99)" ;;
    107) echo "❌  $ENV_NAME: falha no setup — chave inválida ou ambiente indisponível (exit 107)" ;;
    *)  echo "⚠️  $ENV_NAME: exit $CODE" ;;
  esac
done
