# Serviço de sincronização de campo (Bun + pg)

Implementação promovida da candidata `aggregate` + validação consolidada do
laboratório em `694ef21`. O build compila **os fontes atuais de `src/`**, não usa
imagens congeladas de carga. Os laboratórios continuam independentes e sintéticos.

## Responsabilidade

- `GET/HEAD /v1/field/blocks/:blockId/sync`, `GET/HEAD /v1/field/sync` e
  `DELETE /v1/field/session`. Outros caminhos/métodos retornam 404, exceto preflight OPTIONS.
- Reutiliza FieldService, FieldAccessService, CatalogRoundService, guards e filtro
  de erros compilados da API. Não instancia PrismaClient nem AppModule.
- Snapshot completo de quadra agregado no PostgreSQL, no mesmo `REPEATABLE READ`
  do cursor; escopos genéricos usam junções. Ambiguidades legadas usam o caminho
  original. Sem cache compartilhado de autorização/snapshot.
- Cada validação consulta novamente o banco; consolidação somente dentro de uma
  invocação, via AsyncLocalStorage. Revogação/expiração continuam verificadas.
- Adaptador SQL restrito: operações desconhecidas falham; escrita somente no SQL
  original de presença. Datas entram/saem em UTC. Não é substituto geral de Prisma.
- Marcações, autenticação por link, gestão e solicitações continuam na API NestJS.

## Configuração

`DATABASE_URL`, `JWT_SECRET` e `API_KEY_SECRET` são obrigatórios e devem corresponder
à API principal. Schema suportado: `public`. `FIELD_DB_POOL_SIZE=2` controla o pool
real, substituindo eventual `connection_limit` da URL. `FIELD_POLL_CHECK_MS=3000`
controla a verificação; espera HTTP permanece 25s, presença 60s. `PORT=3402`.

`/healthz`, também acessível pelo proxy local, não contém dados/tokens; informa
configuração efetiva e hashes de fontes.
`FIELD_WORKER_DIAGNOSTICS=1` habilita contadores de consultas/pool, somente para
diagnóstico controlado. O serviço não aplica migrations/seed; aguarda a API saudável
no Compose local. Limites do worker: 0,5 CPU/2 GiB, pool 2, nofile 32768.

## Desenvolvimento local

Da raiz do workspace: `docker compose up --build -d`. Proxy em 3001, API direta
somente localhost:3002. Worker sem porta publicada. Frontend mantém
`NEXT_PUBLIC_API_URL=http://localhost:3001`; não necessita outro host/CORS.

Mudou `src/` ou `field-worker/`? `docker compose up --build -d field-worker`.
O worker não usa hot reload; API/Admin continuam com HMR. Uma alteração de contrato
exige reconstruir os serviços compatíveis juntos, não manter código antigo no worker.

Rollback local (sem apagar dados, sem reconstruir o frontend):

```bash
FIELD_SYNC_UPSTREAM=api:3000 docker compose up -d --no-deps --force-recreate proxy
# Voltar ao worker:
docker compose up -d --no-deps --force-recreate proxy
```

O override vale apenas para o comando; não é persistido no `.env`. Não há fallback
automático que mascare falhas ou repita marcações. Proxy usa timeouts 90s, sem cache
ou buffering. Produção/Portainer/Nginx Proxy Manager não são alterados por este setup.

## Verificações

```bash
# Na raiz da API:
node --test field-worker/tests/*.test.cjs
docker build -f Dockerfile.field -t territorio-field-worker:local .
# Equivalência + um ensaio sintético de 300 usuários, com o volume lab preparado:
python3 field-worker/tests/verify.py --image territorio-field-worker:local --load-300
# Na raiz do workspace, somente congregação QA:
FIELD_EXPECT_PROXY=1 bash dev/test-field.sh
```

A evidência histórica de 300 usuários não certifica automaticamente este build nem
uma VPS real. Executar carga somente no banco sintético isolado, nunca no banco
restaurado. O adaptador não reproduz exatamente os timeouts do Prisma sob saturação.
