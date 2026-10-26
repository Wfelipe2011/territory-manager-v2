# Monitoramento da super admin

Frontend: Admin Next.js, `/superadmin`, `/superadmin/congregacoes`,
`/superadmin/saude`. Os templates Handlebars continuam disponíveis como alternativa.
Uso de congregações mantém os contratos de `docs/concurrency-analytics.md`.

## Contrato e autorização

`GET /v1/dashboard/monitoring?period=15m|1h|24h|7d` exige `super_admin` e retorna:
`services` (API, banco e worker), `collection`, `summary`, `polling`, `categories`,
`series`, `resources` e `alerts`, com timestamps ISO. Não modifica o tenant da
sessão. O padrão é 24 horas; retenção de sete dias.

O POST `/v1/admin/tenants/switch` mantém a atualização persistente de
`user.tenantId`, sempre usando o `userId` do JWT validado. Com `Accept:
application/json`, retorna `{token}` e HTTP 200; sem isso mantém cookie e redirect
do formulário legado. O token inclui `tenantName` para identificar o contexto.
GET/PATCH `/v1/admin/tenants/:id` são exclusivos de superadmin; o PATCH retorna
somente o cadastro público, evitando serializar revisões internas BigInt.

## Coleta e custo

API e Bun contam requisições em memória por minuto e categorias fixas: consultas,
alterações, entrada, sync inicial e espera de polling. Não gravam banco por
requisição nem armazenam URLs, tokens, IDs de dispositivos ou corpos de requests.
O histograma usa limites 5/10/25/50/100/250/500/1000/2500/5000/10000/30000/60000 ms
e uma faixa superior. p95 é o limite superior aproximado da faixa correspondente;
na última faixa usa o maior tempo medido. Médias usam todas as durações, ponderadas
pela contagem; cancelamentos não entram na média nem como 5xx.

O worker mantém quinze minutos de agregados e expõe `GET /internal/metrics`
autenticado por `x-api-key` com `API_KEY_SECRET`. A API consulta diretamente a
URL interna, nunca o navegador. `/healthz` público não ganha os agregados privados.
Não habilitar diagnósticos SQL detalhados para usar o painel.

A cada 30 segundos, cada API persiste seus agregados e os recebidos do worker em
`request_metric_minute`. Chave: minuto + componente + UUID de instância + categoria.
Cada bucket tem revisão crescente; upserts aceitam apenas revisões mais novas,
evitando duplicação e sobrescrita por snapshots atrasados. Dados anteriores a sete
dias são removidos em lotes limitados. Não há histórico retroativo nem zeros
inventados para lacunas de coleta. Falhas de persistência não bloqueiam operações.

O banco é consultado com timeout observado de dois segundos. O worker usa fetch
com abort de dois segundos. Listener desconectado indica degradação quando a
tabela derivada está habilitada; sua verificação periódica continua funcionando.
O painel distingue operacional, degradado, indisponível e sem medição.
Medições com mais de 90 segundos ficam desatualizadas. A resposta de uma instância
não certifica a disponibilidade de todas as réplicas nem substitui monitor externo.

Variáveis da API:

| Variável | Padrão / efeito |
| --- | --- |
| `FIELD_WORKER_INTERNAL_URL` | Configurar URL interna do worker, ex. `http://field-worker:3402` |
| `API_KEY_SECRET` | Chave compartilhada, somente nos serviços |
| `MONITORING_ENABLED` | `0` desativa o coletor; padrão habilitado fora dos testes |
| `REQUEST_METRICS_ENABLED` | `0` desativa contagem; mesma opção no Bun |
| `MONITORING_LATENCY_MS` | 1000 ms para p95 de operações |
| `MONITORING_ERROR_PERCENT` | 5% de 5xx em operações |
| `MONITORING_MIN_REQUESTS` | 20 requisições nos últimos cinco minutos |

Histórico técnico não altera presença, revisões de domínio ou limites do pool.
O adaptador pg do worker continua sem escritas de telemetria: a persistência é da API.

## Testes e operação

- `bash dev/test-api.sh monitoring.e2e-spec.ts superadmin-management.e2e-spec.ts dashboard-usage.e2e-spec.ts concurrency.e2e-spec.ts` na raiz do workspace.
- `npm test -- --runInBand request-metrics.spec.ts` e `node --test field-worker/tests/*.test.cjs` na API.
- `npm run build`; reconstruir o worker porque ele carrega os fontes compilados atuais.
- `node load-tests/telemetry-overhead.cjs` compara baseline sem instrumentação com
  contadores em seis rodadas A/B de HTTP sintético no loopback. Nunca acessa a API
  real, worker, dados restaurados ou produção. Mede somente custo do contador no
  caminho HTTP; não certifica capacidade da VPS, banco ou carga real de campo.

Aplicar a migration aditiva `20261027000000_request_telemetry` antes da nova API.
O Compose local e o manifesto da API incluem a URL interna. Não aplicar DNS, NPM,
limites ou publicação em produção implicitamente. O corte exige API, worker e
Admin compatíveis, conforme `deploy/README.md`. Para rollback, voltar imagens e
tráfego anteriores e conservar as tabelas aditivas; não apagar dados coletados.
