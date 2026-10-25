# Bun + PostgreSQL: ajuste e capacidade local

**Campanha pausada a pedido do usuário. Resultados exploratórios; confirmações e comparação final de pools não concluídas.**

Melhor candidata funcional até a interrupção: Bun + pg, catálogo agregado no PostgreSQL,
validação consolidada sem cache, pool dois e verificação de três segundos. Com 300
usuários, entrada p95 de 345ms, marcação de 159ms e propagação amostrada de 4,032s,
sem erros. São resultados de uma execução de dois minutos, não capacidade confirmada.
Em 400/500 usuários, entrada p95 de 1.054/3.534ms reprovou a meta de um segundo;
propagação permaneceu abaixo de cinco segundos. O ensaio de 350 foi interrompido e
excluído. Não foram demonstrados 1.000 usuários nem um máximo final. Laboratório e
gerador encerrados; API/Admin habituais responderam HTTP 200 após a limpeza.

Recursos fixos: Bun 0,5 CPU/2 GiB; PostgreSQL 1 CPU/2 GiB; API de marcações 0,4 CPU/2 GiB; nginx 0,1 CPU/128 MiB. Gerador 1 CPU/1 GiB, no mesmo host, fora desse orçamento.
Base sintética de 12 tenants, 400 quadras, 60 mil casas e 480 mil participações. Uma consulta pendente por leitor; 10% também marcam uma casa a cada 30s. Casos idle não fazem marcações.
Cada ponto: 65s de preparação, 120s de medição, 90s de observação adicional e encerramento. Sem Next/assets ou escrita de sonda. Sentinela de leitura na API original a cada pelo menos 5s.

| Fase | Versão | Usuários | Grupo preferido | Pool | Intervalo s | Execuções/capacidade/com meta de 5s | Entrada p95 ms | Marcação p95 ms | Propagação observadores p95 ms | CPU Bun % core | CPU PG % core |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bun-aggregate-batch-search | aggregate + validação SQL | 300 | 10 | 2 | 3.0 | 1/1/1 | 344.7 | 159.0 | 4032.3 | 40.7 | 63.2 |
| bun-aggregate-batch-search | aggregate + validação SQL | 400 | 10 | 2 | 3.0 | 1/0/0 | 1054.3 | 162.6 | 4246.2 | 44.6 | 75.6 |
| bun-aggregate-batch-search | aggregate + validação SQL | 500 | 10 | 2 | 3.0 | 1/0/0 | 3533.7 | 212.2 | 4716.6 | 48.6 | 74.3 |
| bun-aggregate-search | aggregate | 150 | 10 | 2 | 3.0 | 1/1/1 | 267.5 | 88.6 | 3838.4 | 34.9 | 39.1 |
| bun-aggregate-search | aggregate | 300 | 10 | 2 | 3.0 | 1/1/1 | 821.1 | 150.1 | 4308.0 | 46.9 | 64.3 |
| bun-aggregate-search | aggregate | 500 | 10 | 2 | 3.0 | 1/0/0 | 7407.0 | 130.1 | 7688.5 | 50.7 | 82.1 |
| bun-baseline-capacity | baseline | 150 | 10 | 10 | 3.0 | 1/0/1 | 384.1 | 219.0 | 4195.5 | 35.7 | 34.8 |
| bun-baseline-capacity | baseline | 300 | 10 | 10 | 3.0 | 1/0/0 | 713.3 | 178.9 | 5711.0 | 46.6 | 53.5 |
| bun-baseline-search | baseline | 150 | 10 | 2 | 3.0 | 1/1/1 | 167.5 | 128.6 | 4083.4 | 34.1 | 29.8 |
| bun-baseline-search | baseline | 220 | 10 | 2 | 3.0 | 1/1/1 | 449.9 | 211.4 | 4851.0 | 45.7 | 39.1 |
| bun-baseline-search | baseline | 260 | 10 | 2 | 3.0 | 1/1/1 | 387.6 | 116.9 | 4242.8 | 41.2 | 36.0 |
| bun-baseline-search | baseline | 280 | 10 | 2 | 3.0 | 1/1/1 | 623.8 | 147.6 | 4811.6 | 45.4 | 44.2 |
| bun-baseline-search | baseline | 300 | 10 | 2 | 3.0 | 1/1/0 | 718.5 | 139.9 | 5084.3 | 44.7 | 47.0 |
| bun-joined-search | joined | 150 | 10 | 2 | 3.0 | 1/1/1 | 378.4 | 211.5 | 4020.1 | 38.0 | 30.4 |
| bun-joined-search | joined | 180 | 10 | 2 | 3.0 | 1/1/1 | 317.4 | 112.3 | 4168.9 | 38.1 | 37.5 |
| bun-joined-search | joined | 200 | 10 | 2 | 3.0 | 1/1/1 | 723.9 | 132.2 | 4138.2 | 37.4 | 37.0 |
| bun-joined-search | joined | 220 | 10 | 2 | 3.0 | 1/0/0 | 1284.0 | 176.2 | 4585.8 | 39.9 | 50.8 |
| bun-joined-search | joined | 300 | 10 | 2 | 3.0 | 1/0/0 | 1466.2 | 172.5 | 4358.6 | 48.7 | 53.5 |
| bun-pool-grid | baseline (exploratório excluído) | 150 | 10 | 1 | 3.0 | 1/1/1 | 322.9 | 166.9 | 4227.4 | 41.4 | 27.8 |
| bun-pool-grid | baseline | 150 | 10 | 10 | 3.0 | 1/1/1 | 386.3 | 256.1 | 4184.8 | 39.6 | 30.3 |
| bun-pool-grid | baseline | 150 | 10 | 2 | 3.0 | 1/1/1 | 264.9 | 155.7 | 4068.7 | 34.6 | 27.5 |
| bun-pool-grid | baseline | 150 | 10 | 5 | 3.0 | 1/1/1 | 230.6 | 126.1 | 4144.4 | 36.4 | 29.1 |
| bun-pool1-fixed | baseline | 150 | 10 | 1 | 3.0 | 1/1/1 | 291.4 | 141.3 | 3888.3 | 37.3 | 23.8 |

Faixas são mínimo–máximo dos p95 por execução, não p95 agregado. CPU de 50% de um core corresponde aproximadamente ao teto do worker de 0,5 CPU.

## Critérios e limites

- Capacidade exige prontidão de todos, entrada p95 ≤1s, marcação p95 ≤500ms, erros <1%, integridade das marcações/observações, agendamento e infraestrutura válidos. A coluna final de aprovação acrescenta propagação amostrada p95 ≤5s; a tabela separa as duas contagens.
- Buscas históricas usam o critério responsive (capacidade mais propagação ≤5s). --search-criterion capacity permite medir a capacidade dos intervalos mais lentos sem confundir atraso de atualização com falha de capacidade; o JSON conserva ambos os resultados e capacity.json identifica o critério da busca.
- A propagação principal deste roteiro inclui cada observador amostrado. A métrica do primeiro observador também permanece nos JSONs; nenhuma representa entrega comprovada a todas as telas ou renderização no celular.
- Respostas sem alteração aguardando 25s são normais. Latência de polls com alteração também inclui espera; não equivale ao tempo de construir o snapshot.
- Preferência de dez/vinte não significa grupo exato: a população é balanceada por tenant. Os grupos mudam entre patamares; não presumir capacidade estritamente monotônica nem um máximo matemático.
- Escolha de pool e busca inicial são exploratórias. Capacidade confirmada exige três execuções aprovadas na mesma configuração; resultados de dois minutos não certificam capacidade sustentada em produção.
- Pool da API de marcações fixo em dez. O primeiro ponto pool=1 da grade acoplava os dois pools e foi excluído da escolha; há repetição corrigida em bun-pool1-fixed.
- Tempos dos wrappers são wall time inclusivo e podem se sobrepor. CPU é medida separadamente. SQL total inclui preparação e observação; amostras de CPU cobrem somente a janela de medição.
- Índices existentes foram mantidos. Planos READ ONLY reproduzíveis em sql-tuning-plans/; o snapshot agregado executa mais trabalho no PG em troca de menos consultas/hidratação no Bun.
- Bun usa o mesmo domínio compilado da imagem read-collation; joined otimiza relações; aggregate monta JSON/contagens e presença no banco. Validação SQL opcional lê novamente a cada invocação, sem cache de autorização.
- API principal/frontend/produção não foram migrados. Nenhum push/deploy. Os serviços habituais são restaurados pelos runners e o volume sintético é preservado.

CSV: [bun-tuning.csv](bun-tuning.csv). JSONs individuais contêm limites efetivos, imagens, hashes de implementação quando disponíveis, métricas, SQL, contagens e monitoramento.
