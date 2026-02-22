# Histórico de Performance — Load Tests

Arquivo de acompanhamento da evolução dos tempos de resposta sob carga.
Cada entrada representa uma rodada de teste com k6.

---

## Formato

| Campo | Descrição |
|---|---|
| Data | Data do teste |
| SIGNATURE_KEY | Chave usada no teste |
| VUs | Número de usuários virtuais |
| Duração | Duração da rodada |
| Otimizações ativas | O que estava ligado naquele momento |

---

## Resultados

### 2026-02-21 — Baseline (sem otimizações)
- **SIGNATURE_KEY:** `797207f8-df06-417b-8677-e80b311dfdcf`
- **VUs:** 200 | **Duração:** 2m

| Endpoint | avg | p(90) | p(95) | Threshold | Status |
|---|---|---|---|---|---|
| getAddresses | — | — | **10.81s** | p(95)<1000ms | ✗ |
| getHouses | — | — | **5.65s** | p(95)<1500ms | ✗ |
| getSignature | — | — | — | p(95)<500ms | — |
| getTerritoryBlocks | — | — | — | p(95)<1000ms | — |
| toggleHouse | — | — | — | p(95)<1500ms | — |
| http_req_failed | — | — | — | rate<0.01 | ✓ |

**Otimizações ativas:** nenhuma  
**Observações:** `syncGhostHouses` rodando em toda leitura sem cache. Sem índices no banco.

---

### 2026-02-21 — Após índices no banco
- **SIGNATURE_KEY:** `797207f8-df06-417b-8677-e80b311dfdcf`
- **VUs:** 200 | **Duração:** 2m

| Endpoint | avg | p(90) | p(95) | Threshold | Status |
|---|---|---|---|---|---|
| getAddresses | — | — | **5.32s** | p(95)<1000ms | ✗ |
| getHouses | — | — | **4.99s** | p(95)<1500ms | ✗ |
| getSignature | — | — | — | p(95)<500ms | — |
| getTerritoryBlocks | — | — | — | p(95)<1000ms | — |
| toggleHouse | — | — | — | p(95)<1500ms | — |
| http_req_failed | — | — | — | rate<0.01 | ✓ |

**Otimizações ativas:** índices no banco (7 índices em `house`, `round`, `territory_block`, `territory_block_address`)  
**Observações:** redução de ~50% em `getAddresses`. `syncGhostHouses` ainda sem cache.

---

### 2026-02-21 — Após cache em memória + índices
- **SIGNATURE_KEY:** `c6b85860-76b2-4b0e-a8a4-66afc68d926c`
- **VUs:** 200 | **Duração:** 2m

| Endpoint | avg | p(90) | p(95) | Threshold | Status |
|---|---|---|---|---|---|
| getAddresses | 2.17s | 3.10s | **3.29s** | p(95)<1000ms | ✗ |
| getHouses | 2.02s | 2.91s | **3.17s** | p(95)<1500ms | ✗ |
| getSignature | 205ms | 205ms | **205ms** | p(95)<500ms | ✓ |
| getTerritoryBlocks | 213ms | 213ms | **213ms** | p(95)<1000ms | ✓ |
| toggleHouse | 2.35s | 3.08s | **3.28s** | p(95)<1500ms | ✗ |
| http_req_failed | — | — | **0.00%** | rate<0.01 | ✓ |

**Estatísticas gerais:**
- `http_req_duration` avg=2.3s | med=2.48s | max=3.63s | p(95)=3.28s
- Total requests: 6.638 | Taxa: 44 req/s
- Iterações completas: 627 | Interrompidas: 15
- WS sessions: 642 | msgs recebidas: 2.569

**Otimizações ativas:**
- Índices no banco (7 índices)  
- Cache `@nestjs/cache-manager` global (`max: 1000`)
- `getAddresses` cacheado 5min
- `getHouses` cacheado 30s
- `syncGhostHouses` cacheado 24h (flag de bloco estável com `didWork`)
- `updateHouse` paralelizado com `Promise.all`
- `getTerritoryBlockDetails` com único `findFirst` + `include`

**Observações:** `toggleHouse` (PATCH) e `getAddresses`/`getHouses` ainda acima do threshold. `toggleHouse` é escrita sem cache — indica contensão no banco sob 200 VUs. `getSignature` e `getTerritoryBlocks` já dentro do esperado.

---

### 2026-02-21 — 300 VUs (cache + índices)
- **SIGNATURE_KEY:** `c6b85860-76b2-4b0e-a8a4-66afc68d926c`
- **VUs:** 300 | **Duração:** 2m

| Endpoint | avg | p(90) | p(95) | Threshold | Status |
|---|---|---|---|---|---|
| getAddresses | 2.28s | 3.82s | **3.99s** | p(95)<1000ms | ✗ |
| getHouses | 2.56s | 3.89s | **4.07s** | p(95)<1500ms | ✗ |
| getSignature | 189ms | 189ms | **189ms** | p(95)<500ms | ✓ |
| getTerritoryBlocks | 207ms | 207ms | **207ms** | p(95)<1000ms | ✓ |
| toggleHouse | 2.96s | 3.97s | **4.10s** | p(95)<1500ms | ✗ |
| http_req_failed | — | — | **2.46%** | rate<0.01 | ✗ |

**Estatísticas gerais:**
- `http_req_duration` avg=2.84s | med=3.19s | max=5.59s | p(95)=4.09s
- Total requests: 8.038 | Taxa: 53 req/s
- Iterações completas: 814 | Interrompidas: 110
- WS sessions: 824 | msgs recebidas: 3.609
- Checks com falha: 1.87% (199/10635) — `getAddresses` 89% OK, `toggleHouse` 98% OK

**Otimizações ativas:** mesmas do teste anterior (300 VUs)

**Observações:** em 300 VUs o sistema começa a apresentar erros (2.46% de falhas em requests). `getAddresses` começa a retornar erros (10% de falha). Iterações interrompidas saltaram de 15 para 110 — limite prático do sistema está entre 200 e 300 VUs com a configuração atual. `toggleHouse` piora proporcionalmente indicando contenção de escrita no banco.

---

### 2026-02-21 — Teste de Estresse (500 VUs)
- **SIGNATURE_KEY:** *não informada no log*
- **VUs:** 500 | **Duração:** 1m32s

| Endpoint | avg | p(90) | p(95) | Threshold | Status |
|---|---|---|---|---|---|
| getAddresses | 1.23s | 3.19s | **3.43s** | p(95)<1000ms | ✗ |
| getHouses | 2.23s | 3.42s | **3.56s** | p(95)<1500ms | ✗ |
| getSignature | 185ms | 185ms | **185ms** | p(95)<500ms | ✓ |
| getTerritoryBlocks | 194ms | 194ms | **194ms** | p(95)<1000ms | ✓ |
| toggleHouse | 2.54s | 3.39s | **3.49s** | p(95)<1500ms | ✗ |
| http_req_failed | — | — | **9.67%** | rate<0.01 | ✗ |

**Estatísticas gerais:**
- `http_req_duration` avg=2.21s | med=2.59s | max=14.58s | p(95)=3.49s
- Total requests: 4.825 | Taxa: 52 req/s
- Iterações completas: 948 | Interrompidas: 117
- WS sessions: 658 | msgs recebidas: 2.525
- Checks com falha: 7.35% (481/6540) — `getAddresses` 61% OK, `toggleHouse` 98% OK

**Otimizações ativas:** mesmas do teste anterior (cache + índices)

**Observações:** O sistema entrou em colapso com 500 VUs. A taxa de erro de 9.67% é inaceitável para produção. O endpoint `getAddresses` foi o mais afetado (apenas 61% de sucesso), sugerindo que o banco de dados ou o pool de conexões não está aguentando a carga de leitura/escrita combinada. O tempo de resposta de 14.58s (max) indica picos de bloqueio. O limite de escalabilidade vertical foi atingido.

---

### 2026-02-21 — Estabilidade (250 VUs)
- **SIGNATURE_KEY:** *não informada no log*
- **VUs:** 250 | **Duração:** 1m31s

| Endpoint | avg | p(90) | p(95) | Threshold | Status |
|---|---|---|---|---|---|
| getAddresses | 1.57s | 2.69s | **2.76s** | p(95)<1000ms | ✗ |
| getHouses | 1.68s | 2.69s | **2.80s** | p(95)<1500ms | ✗ |
| getSignature | 417ms | 417ms | **417ms** | p(95)<500ms | ✓ |
| getTerritoryBlocks | 197ms | 197ms | **197ms** | p(95)<1000ms | ✓ |
| toggleHouse | 1.88s | 2.72s | **2.87s** | p(95)<1500ms | ✗ |
| http_req_failed | — | — | **0.73%** | rate<0.01 | ✓ |

**Estatísticas gerais:**
- `http_req_duration` avg=1.81s | med=2.08s | max=3.18s | p(95)=2.81s
- Total requests: 4.515 | Taxa: 49 req/s
- Iterações completas: 596 | Interrompidas: 22
- WS sessions: 586 | msgs recebidas: 2.322
- Checks com falha: 0.53% (33/6177) — `getAddresses` 94% OK

**Otimizações ativas:** mesmas do teste anterior (cache + índices)

**Observações:** Esta rodada confirma o "sweet spot" de estabilidade do sistema. Com 250 VUs, a taxa de erro caiu para **0.73%**, voltando a ficar dentro do threshold de segurança (<1%). Curiosamente, os tempos de resposta p(95) foram ligeiramente melhores que nos testes anteriores de 200 VUs (2.8s vs 3.2s), sugerindo uma maior estabilidade do ambiente ou eficiência dos caches após o aquecimento. No entanto, os tempos de latência para leitura de endereços e casas ainda excedem os limites desejados, indicando que a otimização de consultas complexas no Prisma ainda é necessária.
