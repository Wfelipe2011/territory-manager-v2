# Reference — load-tests/ (Territory Manager)

Índice:
1. [Anatomia dos arquivos](#anatomia-dos-arquivos)
2. [Como criar um novo cenário](#como-criar-um-novo-cenário)
3. [Gerar SIGNATURE_KEY](#gerar-signature_key)
4. [Thresholds atuais](#thresholds-atuais)
5. [Carga parametrizável](#carga-parametrizável)
6. [Comparativo HMG vs PRD](#comparativo-hmg-vs-prd)

## Anatomia dos arquivos

```
load-tests/
├── config.js   # config central: API_URL, WS_URL, SIGNATURE_KEY, USERNAME via __ENV
├── api.js      # wrappers HTTP por endpoint (tags name: para thresholds)
├── main.js     # setup() + cenários (options.scenarios) + thresholds
└── run.sh      # orquestra o k6 (passa -e para main.js)
```

- **config.js**: `API_URL: __ENV.API_URL || 'https://api.territory-manager.com.br'`
  (default PROD — para HMG SEMPRE passar `-e API_URL`). `makeHeaders(token)`
  monta `Authorization: Bearer` + `Content-Type`.
- **api.js**: um wrapper por endpoint. Cada requisição carrega
  `tags: { name: '<endpoint>' }` — é isso que permite threshold por endpoint
  (`http_req_duration{name:toggleHouse}`). Retorna `res.json()` e roda um
  `check` do status.
- **main.js**: `setup()` roda UMA vez (token → JWT decode → bloco[0] → rua[0]
  → casas visitáveis) e devolve o contexto fixo. `options.scenarios` define
  os executores; `options.thresholds` define os limites.
- **run.sh**: `SIGNATURE_KEY` é `$1` posicional (ou env `SIGNATURE_KEY`).
  Env suportados: `API_URL`, `K6_BIN`, `LISTENER_VUS`, `TOGGLER_VUS`,
  `SSE_DURATION_SECS`, `K6_ARGS` (flags extras do k6).

## Como criar um novo cenário

1. **Wrapper de API** em `api.js` (copie o padrão de `toggleHouse`):
   ```js
   export function novoEndpoint(territoryId, round, token) {
       const res = http.get(`${config.API_URL}/v1/...`, {
           headers: makeHeaders(token),
           tags: { name: 'novoEndpoint' },
       });
       check(res, { 'novoEndpoint status is 200': (r) => r.status === 200 });
       return res.json();
   }
   ```
2. **Threshold** em `main.js` → `options.thresholds`:
   `'http_req_duration{name:novoEndpoint}': ['p(95)<1000']`.
   Regra prática: reads leves <500ms, listagens <1000ms, writes com broadcast
   SSE (toggle) <1500ms, conexão SSE longa <60000ms (mede liveness).
3. **Dados** no `setup()`: nunca hardcode IDs (400 "Casa não encontrada").
   Adicione o retorno ao objeto do setup e consuma nos cenários.
4. **Cenário** em `options.scenarios`:
   ```js
   novoFluxo: {
       executor: 'constant-vus',
       vus: __ENV.NOVO_VUS || 1,
       duration: `${SSE_DURATION_SECS}s`,
       exec: 'novoFluxo',
       startTime: '0s',
   },
   ```
   Para carga parametrizável, leia `__ENV` no topo de `main.js` e exponha a
   env no `run.sh` (padrão de `LISTENER_VUS`).
5. **Padrões obrigatórios**:
   - Handlers SSE leves (só contadores/checks) — o loop de eventos do xk6-sse
     é serial e bloqueia se o handler fizer trabalho pesado.
   - Toggles (trabalho pesado) em cenário SEPARADO do listener.
   - Listener e toggler na MESMA rua fixa do `setup()`.
   - Imports nativos do k6 (`import http from 'k6/http'`); `require()` falha.
   - http do k6 é síncrono — bloqueia a VU (normal em k6).
   - JWT decode sem lib externa: `encoding.b64decode(token.split('.')[1], 'rawstd', 's')`.
   - Helpers existentes: `randomItem(arr)` e `randomBetween(min, max)`.

## Gerar SIGNATURE_KEY

Cada ambiente tem a própria chave (UUID). Script: `scripts/generate-signature-key.ts`
(roda com `npx tsx`, lê `.env` via dotenv). Fluxo interno: `POST /v1/login`
(admin) → `POST /v1/territories/:territoryId/signature` com
`{expirationTime, overseer, round}` → imprime `SIGNATURE_KEY=<uuid>`.

Args: `--territory` · `--round` · `--overseer` (default `k6-load-tester`) ·
`--expiration` (default `2026-12-31`) · `--email` · `--password` ·
`--baseUrl` (default `https://api-hmg.territory-manager.com.br`).

**HMG** (defaults vêm do `.env`: `HMG_TERRITORY_ID`=63, `HMG_ROUND_NUMBER`=22,
`HMG_ADMIN_EMAIL`, `HMG_ADMIN_PASSWORD`):

```bash
npx tsx scripts/generate-signature-key.ts
```

**PROD** — as credenciais admin são as MESMAS; muda a base URL e os IDs, que
precisam ser descobertos (o territory/round da HMG pode não existir no PROD):

1. Login: `POST https://api.territory-manager.com.br/v1/login` → token.
2. Rodada ativa: `GET /v1/rounds/info` (Bearer) → rodada com `endDate: null`
   (ex: 22 — atenção: podem existir várias, ex: 19 e 22).
3. Território livre: `GET /v1/territories?round=<n>` (Bearer) → escolher um
   com `signature.key: null` (senão `POST` falha com "Assinatura já gerada").
4. Gerar:
   ```bash
   npx tsx scripts/generate-signature-key.ts \
     --baseUrl https://api.territory-manager.com.br \
     --territory <id> --round <n>
   ```
5. Validar: `curl https://api.territory-manager.com.br/v1/signature/<key>`
   → deve retornar `{token, roundInfo}`.

Pré-requisito (checado pelo backend): o território precisa ter rodada ativa
(`round.end_date IS NULL`) e não pode ter assinatura de dirigente na rodada.

Chaves atuais (2026-08): HMG = `f5227adc-0f3d-4fe9-a233-320129ee28e4`
(território 63, rodada 22) · PROD = `83c47193-e566-442e-a3e6-0a00d9bc9c1a`
(território 86, rodada 22).

### Assinaturas de bloco (obrigatórias no PROD)

`GET /v1/territories/:t/blocks/:b?round=N` (getAddresses) responde
**404 "Quadra não tem assinatura"** se o bloco não tiver assinatura própria.
No HMG os blocos já tinham; no PROD precisam ser criadas por bloco:

```bash
TOKEN=<admin token>
for b in <blockId1> <blockId2> ...; do
  curl -s -X POST "https://api.territory-manager.com.br/v1/territories/<territoryId>/blocks/$b/signature/<round>" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json'
done
```

ATENÇÃO: assinatura de bloco expira em ~5h (param `SIGNATURE_EXPIRATION_HOURS`,
default 5) e o CRON (`EVERY_10_MINUTES`) apaga as expiradas — runs separados
por mais de 5h exigem regenerá-las. A de território expira só em
2026-12-31 (default do script).

## Thresholds atuais

| Endpoint | Threshold | Motivo |
|---|---|---|
| http_req_duration (global) | p(95)<2000 | limite geral |
| http_req_failed (global) | rate<0.01 | tolerância de falha |
| getSignature | p(95)<500 | rota pública simples |
| getTerritoryBlocks | p(95)<1000 | listagem |
| getAddresses | p(95)<1000 | maior fluxo |
| getHouses | p(95)<1500 | mais dados |
| toggleHouse | p(95)<1500 | PATCH + broadcast SSE |
| sseStreet | p(95)<60000 | conexão longa — mede liveness |

Resultado de referência (leve 2/3/60 na HMG): 400/400 checks, 274 eventos
SSE, `http_req_failed` 0.00%, `toggleHouse` p(95)=240ms.

## Carga parametrizável

`main.js` lê no topo: `LISTENER_VUS`, `TOGGLER_VUS`, `SSE_DURATION_SECS`
(defaults 1/1/50). O toggler dura `SSE_DURATION_SECS - 5` (começa 5s depois
do listener). Perfis: smoke 1/1/50 · leve 2/3/60 · média 5/10/180.

## Comparativo HMG vs PRD

`./load-tests/compare.sh <SIGNATURE_KEY>` roda o MESMO perfil nos dois
ambientes e imprime uma tabela lado a lado. Fluxo:

1. HMG com SSE (`HMG_ENABLE_SSE=1` default).
2. PRD REST-only (`PRD_ENABLE_SSE=0` default — PRD ainda não tem SSE;
   ligue com `PRD_ENABLE_SSE=1` quando tiver).
3. `node compare-results.js` lê `load-tests/results/{HMG,PRD}.json`
   (k6 NDJSON via `--out json`) e agrega: reqs, falhas, duração global
   + por endpoint, eventos SSE, checks.

- Chaves podem ser diferentes por ambiente: `HMG_SIGNATURE_KEY` /
  `PRD_SIGNATURE_KEY` (default: a mesma `SIGNATURE_KEY` posicional).
- Gerar/renovar as chaves: seção [Gerar SIGNATURE_KEY](#gerar-signature_key).
- CUIDADO: a chave da HMG pode NÃO existir no PRD (404 "Assinatura não
  encontrada") — valide com `curl https://api.territory-manager.com.br/v1/signature/<key>`.
- Exit codes k6: 0=ok · 1=thresholds cruzados · 99=script exception ·
  107=setup error (chave inválida / ambiente indisponível).
- `ENABLE_SSE=0` remove o cenário `sseListener` e o threshold `sseStreet`
  (usado para ambientes sem SSE).
- Resultados ficam em `load-tests/results/` (gitignored).
