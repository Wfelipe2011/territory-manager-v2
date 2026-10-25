# Serviço de sincronização de campo (Bun + pg)

Implementação local Bun + pg com agrupamento de leituras simultâneas, catálogo
agregado, tabela de leitura versionada e LISTEN/NOTIFY por escopo. O build compila
**os fontes atuais de `src/`**; não usa bootstrap ou arquivos de `experiments/`.
Os experimentos históricos continuam separados e suas imagens de evidência foram preservadas.

## Responsabilidade

- `GET/HEAD /v1/field/blocks/:blockId/sync`, `GET/HEAD /v1/field/sync` e
  `DELETE /v1/field/session`. Outros caminhos/métodos retornam 404, exceto preflight OPTIONS.
- Reutiliza FieldService, FieldAccessService, CatalogRoundService, guards e filtro
  de erros compilados da API. Não instancia PrismaClient nem AppModule.
- Transações simultâneas equivalentes de snapshot são agrupadas por tenant,
  território, quadra, rodada, revisão e perfil. Cada leitor recebe cópia independente.
- Consultas simultâneas da mesma assinatura, metadados e presença equivalentes são
  agrupadas somente durante sua execução. JWT/claims continuam verificados por caller;
  sem autorização em cache após a consulta. Revogação/expiração continuam verificadas.
- `field_read_model` guarda catálogo **bruto** por revisão, não permissões finais,
  presença ou tokens. Cursor/revisão/dados vêm da mesma transação `REPEATABLE READ`.
  Versão ausente/incompatível é reconstruída; nada obsoleto é servido como atual.
- A versão é armazenada após commit, com inserção idempotente e lock por escopo para
  coordenar escritores. Mantém duas versões recentes por escopo; limpeza a cada
  minuto remove até 1.000 linhas com mais de uma hora. A tabela é descartável.
- Regras temporais são recalculadas; seguidores que atravessam um prazo não herdam
  permissão vencida. Ambiguidades legadas usam a montagem original.
- Listener recebe `field_revision_changed` depois do commit, invalida somente o
  escopo afetado e atualiza catálogos conhecidos no mesmo pool de consultas.
  Reconexão invalida revisões e recupera escopos; temporizador continua como segurança.
  Limites: 512 escopos observados/atualizações pendentes, observação ociosa de 10 minutos.
- Adaptador SQL restrito: escritas de negócio somente na presença original;
  operações explícitas adicionais mantêm exclusivamente a tabela derivada. Datas
  em UTC. Não é substituto geral de Prisma.
- Marcações, autenticação por link, gestão e solicitações continuam na API NestJS.

## Configuração

`DATABASE_URL`, `JWT_SECRET` e `API_KEY_SECRET` são obrigatórios e devem corresponder
à API principal. Schema suportado: `public`. `FIELD_DB_POOL_SIZE=2` controla o pool
real, substituindo eventual `connection_limit` da URL. `FIELD_POLL_CHECK_MS=1000`
controla a verificação; espera HTTP permanece 25s, presença 60s. `PORT=3402`.

`/healthz`, também acessível pelo proxy local, não contém dados/tokens; informa
configuração efetiva, listener conectado e hashes de fontes.
`FIELD_WORKER_DIAGNOSTICS=1` habilita contadores de consultas/pool, somente para
diagnóstico controlado. O serviço não aplica migrations/seed; aguarda a API saudável
no Compose local. Limites do worker: 0,5 CPU/2 GiB, **pool 2 + uma conexão dedicada**
para LISTEN, nofile 32768. Listener exige conexão direta ou PgBouncer em session
pooling, nunca transaction pooling. `FIELD_READ_MODEL_ENABLED=0` desliga a tabela
e listener, mantendo agrupamento e o temporizador. Dados de negócio são preservados.

## Desenvolvimento local

Da raiz do workspace: `docker compose up --build -d`. Proxy em 3001, API direta
somente localhost:3002. Worker sem porta publicada. Frontend mantém
`NEXT_PUBLIC_API_URL=http://localhost:3001`; não necessita outro host/CORS.

Mudou `src/` ou `field-worker/`? `docker compose up --build -d field-worker`.
O worker não usa hot reload; API/Admin continuam com HMR. Uma alteração de contrato
exige reconstruir os serviços compatíveis juntos, não manter código antigo no worker.
`revision-poll.cjs` espelha somente o laço de espera do domínio e recusa um hash
desconhecido de FieldService: se esse domínio mudar, revisar o adaptador/compatibilidade
e repetir os testes antes de atualizar a assinatura esperada. Não remover essa proteção.

Rollback local (sem apagar dados, sem reconstruir o frontend):

```bash
FIELD_SYNC_UPSTREAM=api:3000 docker compose up -d --no-deps --force-recreate proxy
# Voltar ao worker:
docker compose up -d --no-deps --force-recreate proxy
```

O override vale apenas para o comando; não é persistido no `.env`. Não há fallback
automático que mascare falhas ou repita marcações. Proxy usa timeouts 90s, sem cache
ou buffering. Produção/Portainer/Nginx Proxy Manager não são alterados por este setup.
Migration aditiva: `20261025190000_field_read_model`. Para rollback de tráfego não
é necessário apagar tabela, função ou trigger, nem reverter dados de negócio.
Se for remover a infraestrutura derivada depois de parar o worker, remover primeiro
o trigger `field_notify_revision`, depois `field_notify_revision()`,
`field_store_read_model(integer,integer,integer,integer,text,jsonb)` e a tabela
`field_read_model`, em manutenção coordenada. Não editar migration já aplicada.
Depois de restauração/substituição externa dos dados que possa reiniciar contadores
de revisão, invalidar a tabela derivada em manutenção antes de reabrir o tráfego.

## Verificações

```bash
# Na raiz da API:
node --test field-worker/tests/*.test.cjs
docker build -f Dockerfile.field -t territorio-field-worker:local .
# Equivalência + um ensaio sintético de 300 usuários, com o volume lab preparado:
python3 field-worker/tests/verify.py --image territorio-field-worker:local --load-users 600 --check-ms 1000
# Na raiz do workspace, somente congregação QA:
FIELD_EXPECT_PROXY=1 bash dev/test-field.sh
```

A evidência histórica de 300 usuários não certifica automaticamente este build nem
uma VPS real. Executar carga somente no banco sintético isolado, nunca no banco
restaurado. O adaptador não reproduz exatamente os timeouts do Prisma sob saturação.
Executor aplica a migration apenas no DB sintético antes do boot e testa retenção,
escritores concorrentes, reconexão real do listener e NOTIFY com commit/rollback.
Depois faz equivalência/carga e restaura o Compose local com o intervalo configurado.
600 usuários passaram integridade nos experimentos, mas entrada de aproximadamente
3,4s ainda não satisfaz a meta de 1s; isso não certifica máximo ou 1.000 usuários.
