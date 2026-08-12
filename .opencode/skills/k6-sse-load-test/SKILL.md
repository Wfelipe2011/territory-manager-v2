---
name: k6-sse-load-test
description: >-
  Testes de carga da API Territory Manager (k6 + xk6-sse). Use when o usuário
  pedir "teste de carga", "load test", "smoke test", "teste de stress",
  "rodar o k6", mencionar SSE/street_changed/presence_changed, thresholds,
  cenários de VUs, ou performance da API em HMG/PROD. Use ONLY when o alvo for
  o repo territory-manager (load-tests/ existente). Não use para outros
  projetos sem adaptar o reference.md.
---

# k6-sse-load-test

Roda e estende os testes de carga k6 (REST + SSE) do `load-tests/` deste repo.

## Workflow

1. **Detectar o binário**: k6 vanilla NÃO suporta SSE. Use o binário custom
   xk6-sse (`phymbert/xk6-sse` v0.1.12) via `K6_BIN=/tmp/opencode/k6-sse`.
   Com `K6_BIN=k6` (default), os cenários SSE falham no `sse.open`.
2. **Escolher o perfil de carga** (env vars, default = smoke):
   | Perfil | `LISTENER_VUS` | `TOGGLER_VUS` | `SSE_DURATION_SECS` |
   |---|---|---|---|
   | smoke | 1 | 1 | 50 |
   | leve | 2 | 3 | 60 |
   | média | 5 | 10 | 180 |
3. **Obter a `SIGNATURE_KEY`** (cada ambiente tem a própria; HMG e PROD usam
   credenciais admin iguais, do `.env`):
   - HMG: `npx tsx scripts/generate-signature-key.ts` (usa `HMG_TERRITORY_ID`/
     `HMG_ROUND_NUMBER`/`HMG_ADMIN_*` do `.env`, base `api-hmg...`).
   - PROD: `npx tsx scripts/generate-signature-key.ts --baseUrl https://api.territory-manager.com.br --territory <id> --round <n>`
     — antes, descobrir território/rodada ativos no PROD:
     `GET /v1/rounds/info` (Bearer admin) → rodada com `endDate: null`; depois
     `GET /v1/territories?round=<n>` → escolher um com `signature.key: null`.
   - Detalhes e passos completos: `reference.md` (seção "Gerar SIGNATURE_KEY").
4. **Rodar**:
   ```bash
   API_URL=https://api-hmg.territory-manager.com.br \
   SIGNATURE_KEY=<uuid> \
   K6_BIN=/tmp/opencode/k6-sse \
   LISTENER_VUS=2 TOGGLER_VUS=3 SSE_DURATION_SECS=60 \
   K6_ARGS="--quiet --log-format raw" \
   ./load-tests/run.sh
   ```
5. **Interpretar resultados** (seção TOTAL RESULTS do k6):
   - `checks_succeeded` deve ser 100% — qualquer check vermelho = investigar
   - `sse_event` = total de eventos SSE entregues aos listeners (street_changed,
     presence_changed, connected, ping) — deve crescer com os toggles
   - `http_req_failed` deve ser 0.00%
   - Todos os thresholds devem passar (`✓`); `✗` indica gargalo por endpoint

## Verificação

- Sucesso = 100% checks + 0% `http_req_failed` + 0 thresholds cruzados.
- IF um run falhar no `setup()` com `Cannot read property ... of undefined`
  THEN conferir se `-e API_URL` aponta para o ambiente certo (default do
  config.js é PROD) e se a SIGNATURE_KEY é válida (GET direto via curl).
- IF o setup do PROD falhar com 404 "Quadra não tem assinatura" THEN
  regenerar as assinaturas de bloco do território (expiram em ~5h) — ver
  `reference.md` → "Assinaturas de bloco".
- IF um listener não receber `street_changed` THEN verificar que listener e
  toggler usam a MESMA rua fixa vinda do `setup()`.

## Regras obrigatórias (lições da sessão)

- **Handlers SSE devem ser leves.** O xk6-sse executa TODOS os handlers JS
  serializados numa única goroutine — trabalho bloqueante (sleeps, toggles,
  `client.close()` pesado) dentro de `connected` faz o loop descartar os
  eventos seguintes. Toggles/houseToggler vivem num cenário separado.
- **Listener e toggler na mesma rua.** O fan-out de `street_changed` só
  alcança quem assina a rua alterada; os dois cenários consomem os mesmos
  `blockId`/`addressId` do `setup()`.
- **Evento vazio é normal**: o stream SSE abre com uma linha em branco que
  chega como evento `name===''` — ignore silenciosamente.
- **Erro do servidor** chega com `name==='error'` e `data` JSON já parseado
  (ex: `{"reason":"Assinatura ausente"}`) — logue e feche o client.
- **SIGNATURE_KEY é `$1` posicional** no `run.sh`. Flags do k6 vão em
  `K6_ARGS`, nunca como argumento posicional (viram a chave e o teste falha).
- **IDs nunca hardcoded**: busque blocos/ruas/casas no `setup()` (getter dinâ
  mico); hardcode gera 400 "Casa não encontrada".
- **`-e API_URL` obrigatório para HMG** — o default do `config.js` é PROD.

## Criar/estender cenários

Passo a passo completo (anatomia dos arquivos, padrões de api.js/main.js,
calibração de thresholds): ver `reference.md`.

## References

- `reference.md` — anatomia do load-tests/ e como criar um novo cenário.
