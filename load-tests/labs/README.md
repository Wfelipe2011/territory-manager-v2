# Laboratórios HTTP de campo

Dois serviços independentes para evoluir e comparar o **fluxo real**, sem editar
`src/`, o bootstrap, os manifests de dependências ou o compose da API principal.
**Não são uma migração de produção nem uma certificação de capacidade.**

| | A | B |
|---|---|---|
| Entrada | `bun/main.cjs`, `Bun.serve` | `nest/main.cjs`, novo módulo raiz Nest/Express |
| Persistência | `pg` 8.23.1 | Prisma da imagem de referência |
| Porta direta, somente localhost | 3402 | 3403 |
| Limite por worker | 0,5 CPU / 2 GiB | 0,5 CPU / 2 GiB |
| Endereço comparável via nginx | `http://localhost:3400` | `http://localhost:3400` |

## Regras compartilhadas, processos separados

A imagem `territory-load-api:read-collation` é a referência inicial (código da
API em `c5b1951411ce3a6199ef75d2be545c79ca2289a9`). Os dois builds copiam/reutilizam
os **mesmos arquivos compilados, sem reescrevê-los**. `/healthz` publica hashes dos
arquivos de regras, sem tokens ou dados do banco. `LAB_API_IMAGE` permite selecionar
outra imagem conscientemente; registre seu ID/digest ao comparar resultados.

O Nest inicializa somente `FieldController`, `FieldService`, `FieldAccessService`,
`CatalogRoundService`, Prisma, tracing e os guards originais de autenticação,
roles e API key. Ambos também executam o throttler original (10 mil/5s): as duas
rotas de sync preservam `SkipThrottle`, saída de sessão mantém a proteção.
Não importa `AppModule`, Firebase, SMTP, tarefas administrativas
ou módulos de escrita. As rotas de sincronização já pulam cache/throttling na API
de referência. A tarefa original de limpeza de presença/cache roda a cada 30s
em ambas as variantes, sem inicializar o scheduler global.

O Bun não sobe uma aplicação Nest e **não instancia PrismaClient/engine**. Reutiliza
as classes de domínio, os guards e o filtro de erros originais (portanto ainda
depende das bibliotecas de decorators/exceções do Nest). Um adaptador SQL com
`pg` implementa somente as operações necessárias a esse fluxo:

- validação JWT e da assinatura persistida, expiração/revogação e escopo;
- resolução de rodada, parâmetros e permissões;
- snapshot completo, relações em lote e revisão em `REPEATABLE READ`;
- heartbeat atômico, presença, saída da sessão e limpeza;
- cursor, espera máxima nominal de 25s e cancelamento pelo cliente.

O adaptador **não é uma implementação genérica de Prisma**. Operações não
implementadas falham; escrita raw é restrita ao SQL de `field_session`. Valores
são parâmetros, identificadores vêm do schema gerado. Timestamps sem timezone
são interpretados como UTC, como no Prisma, **também na codificação de parâmetros
Date** (não apenas no parser dos resultados). O teste de expiração persistida
protege contra deslocamento de três horas no fuso local. Transações de heartbeat usam operações
preguiçosas e a mesma conexão entre BEGIN e COMMIT; não são promises disparadas
antecipadamente no pool. Consultas e hidratação SQL diferem entre os drivers.

É uma comparação de **stacks completas isoladas**, não um experimento que separa
o efeito de runtime, framework e driver. Não há JWT cacheado, snapshot compartilhado,
delta ou outra otimização nova escondida em uma das variantes.

## Banco e orçamento local

Compose próprio, projeto/rede/volume `territory-field-labs`, sem porta pública de
PostgreSQL. Banco sintético novo `territory_manager_peak_load`, nunca o banco
restaurado. `prepare` migra e popula 12 tenants, 400 quadras, 60 mil casas e 480 mil
marcações de rodada; pode demorar. Fixture/tokens ficam em `.runtime/`, ignorado
pelo Git. Executar `prepare` novamente renova as assinaturas sintéticas.

| Container ativo | CPU **limite**, não reserva | RAM limite |
|---|---:|---:|
| PostgreSQL | 1 | 2 GiB |
| Worker escolhido | 0,5 | 2 GiB |
| API principal de referência, só dados sintéticos | 0,4 | 2 GiB |
| nginx | 0,1 | 128 MiB |

Total dos limites de CPU: 2. RAM limitada: 6,125 GiB; ainda é necessário orçamento
para SO, Docker, cache de páginas e gerador. Limite de CPU não é um core dedicado.
O banco, disco, rede e host continuam compartilhados: isolamento não garante que
a API principal fique imune à carga do worker. O gerador deve ficar fora da VPS
para um ensaio representativo. Esta preparação funcional não simula todos esses
efeitos nem suspende os serviços normais do workspace.

`LAB_POOL_SIZE` (default 10) e `FIELD_POLL_CHECK_MS` (default 3000) são iguais nas
duas variantes. Ambas acessam PostgreSQL diretamente, sem PgBouncer nesta base.
Não aumentar pools automaticamente; com 0,5 CPU, medir 1/2/5/10
antes de escolher. Timeout de aquisição/execução e mensagens de falhas internas
dependem de cada driver; não presumir equivalência de filas sob saturação.

## Operação

Na raiz da API:

```bash
python3 load-tests/labs/lab.py prepare
python3 load-tests/labs/lab.py test

python3 load-tests/labs/lab.py up bun
# ou: python3 load-tests/labs/lab.py up nest
python3 load-tests/labs/lab.py status
python3 load-tests/labs/lab.py down

# Testes locais sem banco/container:
node --test load-tests/labs/tests/adapter.test.cjs
```

`up` desliga o worker alternativo e recria nginx para resolver o upstream correto.
Ele também reconstrói a imagem escolhida: alterações nos arquivos de laboratório
entram no próximo `up`, sem rebuild/restart da API normal. As regras compiladas
permanecem congeladas na imagem de referência; para mudar regras em um experimento,
use uma nova imagem de referência identificada, sem substituir a imagem em uso
pela API normal. Primeiro preserve a equivalência, depois nomeie cada otimização.
Somente uma variante é usada por vez. Não execute outro runner de carga ao mesmo
tempo: o CLI compartilha o lock dos ensaios anteriores durante cada operação.
Não há lock mantido depois de `up`: verifique containers antes de iniciar carga.
`down` preserva o volume. Não usar `down -v` se quiser manter os dados sintéticos.

O nginx encaminha `/v1/field/blocks/:blockId/sync`, `/v1/field/sync` e
`DELETE /v1/field/session` ao worker. As demais rotas vão à API de referência
em `http://localhost:3401`. Marcações continuam nela. A API normal em 3001 e
Admin em 4800 não são modificados/reconfigurados pelo laboratório.

## Equivalência antes de desempenho

`test` usa a API de referência como oráculo HTTP e compara cada worker
sequencialmente, via o mesmo nginx. Não basta comparar duas POCs entre si.
Compara dados e status, permissões, cache-control, erros JSON (desconsiderando
somente timestamp), presença, saída, timeout real de 25s, revogação durante a
espera e despertar após alteração transacional. Também compara hashes do domínio.
Os testes criam assinaturas, solicitação e rodada temporárias e as removem ao final;
restauram a marcação alterada. Também exercitam casas/pais provisórios, solicitação pendente, casa legada sem
vínculo normalizado, rejeição e rodadas fechada/vazia. Cada alteração temporária
no catálogo sintético é restaurada em `finally`. Limites efetivos, IDs das imagens,
OOM e reinícios dos containers são verificados/registrados pelo executor.

Ao terminar (inclusive em falha), o CLI derruba apenas o compose do laboratório.
Evidências sanitizadas aprovadas ficam em `results/equivalence-*.json`; fixtures e
arquivos transitórios ficam privados em `.runtime/`.

Não é uma prova exaustiva: outras combinações de dados legados/provisórios,
solicitações e corridas concorrentes precisam de casos adicionais antes de
qualquer corte real. Cancelamento no cliente não prova ausência de vazamento no
servidor. O contrato principal é JSON/mobile; suporte a páginas administrativas
não faz parte deste serviço. Nenhuma capacidade de 300/1.000 usuários é inferida.

## Próximos ensaios, separados desta preparação

1. Expandir a equivalência com outras combinações do catálogo, solicitações e
   mudanças concorrentes de escopo/permissões.
2. Escolher pools em testes curtos controlados; manter mesmos limites e segurança.
3. Carga HTTP completa 150 → 300 → 1.000, com marcações na API principal sintética,
   carga sentinela nessa API, CPU/throttling/memória, filas e PostgreSQL.
4. Medição de 120s além da preparação/encerramento, repetições e comparação de
   intervalos; corrigir censura de observação no encerramento do harness anterior.
5. Só então otimizar SQL/agregação no banco como variante identificada, conservando
   estes dois laboratórios equivalentes como referência.

## Comparação de carga reproduzível

```bash
python3 load-tests/labs/compare.py --users 150,300,1000 --repetitions 3
```

O executor usa somente o volume sintético já preparado e pausa apenas API/Admin
normais que estavam em execução, para reduzir concorrência no host; ao terminar,
encerra o laboratório e reinicia esses mesmos serviços. Não altera seus arquivos,
imagens ou dados. Mantém o lock dos outros runners até o fim.

Cada ponto: 65s de preparação (chegadas distribuídas em 30s), **120s de medição**,
90s adicionais de observação após a janela, mais encerramento de requests.
Cada um dos 10% de writers realiza quatro marcações com início planejado a cada
30s; atrasos de início são medidos. Todos os usuários lógicos continuam leitores.
Há VUs separados para executar as ações desses mesmos usuários e uma sentinela.
Assim se evita uma chegada artificial exatamente na fronteira dos 120 segundos.

Há três repetições por variante e ordem alternada Nest/Bun, Bun/Nest, Nest/Bun;
processos de worker/API reiniciados, dados resetados e 48 snapshots de aquecimento
sequenciais antes de cada ponto. Pool 10, intervalo 3s, grupos com preferência 10
e distribuição entre os 12 tenants são iguais. “Preferência 10” não significa
exatamente dez leitores por quadra (em 150 são 12 quadras de 12–13 leitores).

Além das marcações reais na API principal, uma sentinela faz snapshot completo
diretamente nessa API a cada **pelo menos** cinco segundos. É uma leitura protegida
do fluxo de campo, não uma carga representativa de todas as funções administrativas.
O gerador tem 1 CPU/1 GiB separados do orçamento da stack; continua no mesmo host.
Outros serviços do host e o banco normal ocioso não são controlados por este ensaio.

Critérios: todos prontos antes da medição, snapshot p95 <=1s, marcação p95 <=500ms,
erros <1% (também classificados pelo **início** do request, incluindo respostas
tardias), todas as escritas planejadas confirmadas/observadas, propagação amostrada
p95 <=5s, sem OOM/reinício/drop e sem atraso relevante dos writers/gerador saturado.
`snapshot_ms` inclui novas admissões/recomposições após erro; interpretar junto da
taxa de erros. Não confundir p95 do primeiro leitor amostrado com entrega a todos.

Se algum resultado do patamar falhar, termina as repetições equivalentes mas **não
avança a mais usuários**. Resultados JSON sanitizados e monitoramento ficam em
`results/comparison-*/`; logs e fixture permanecem privados em `.runtime/`.
Contadores SQL incluem preparação/medição/drenagem; CPU média é filtrada para a
janela de 120s. O novo encerramento e a sentinela diferem do harness histórico:
usar como nova base, não atribuir qualquer diferença somente à stack.
