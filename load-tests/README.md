# Carga local: ruas, casas e marcações HTTP

Roteiro k6 reutilizável, sem WebSocket/SSE. Nunca executa contra produção ou o
banco restaurado. Compose próprio (`territory-load`), PostgreSQL
`territory_manager_load`, API no host **3301**, Admin **5800**. A sessão normal
continua com API 3001/Admin 4800 e uma instância.

## Preparar

Docker Compose v2, Python 3 e espaço livre para imagens/base sintética são necessários.
Não é necessário instalar k6 no host: imagem fixada em `grafana/k6:1.3.0`.

```sh
docker compose -f load-tests/compose.yml build api1 admin
python3 load-tests/matrix.py prepare
python3 load-tests/matrix.py smoke
```

A preparação aplica migrations e gera **10 congregações, 50 territórios, 400
quadras, 1.200 ruas, 60.000 casas e 480.000 participações**. É sintético e
reproduzível; não lê dumps. Assinaturas temporárias ficam em `.runtime/fixture.json`
(ignorado pelo Git). A preparação recusa banco diferente ou um seed parcial;
para refazer exclusivamente esta base descartável:

```sh
docker compose -f load-tests/compose.yml down -v
rm -f load-tests/.runtime/fixture.json
python3 load-tests/matrix.py prepare
```

## Recursos efetivos

| Serviço | CPU | Memória |
|---|---:|---:|
| Cada API (2) | 1 | 512 MiB |
| Admin | 0,5 | 512 MiB |
| PostgreSQL | 1 | 1 GiB |
| Nginx | 0,25 | 128 MiB |
| k6 | 1 | 1 GiB |

API/Admin usam builds de produção; API tem pool de 10 conexões por instância e
log em `warn`. PostgreSQL usa `shared_buffers=256MB` e `pg_stat_statements`.
Limites são conferidos por `docker inspect`, incluídos nos resultados.
O balanceador alterna instâncias sem afinidade. Timeout HTTP do proxy é 45s,
do cliente k6 35s, espera longa da API 25s. `FIELD_POLL_CHECK_MS` altera apenas a
verificação de revisões, não a duração máxima da requisição.

## Matriz e comparação

```sh
python3 load-tests/matrix.py matrix --label baseline
# Depois de alterar, validar e commitar a otimização:
LOAD_VARIANT=next docker compose -f load-tests/compose.yml build api1 admin
python3 load-tests/matrix.py matrix --label next
```

Ordem: **3, 5, 10, 15, 20, 25s**, cenários distribuído e concentrado numa quadra.
Patamares **10,25,50,100,200,400,800,1600** por 120s, interrompidos na primeira
falha. Refinamento por dois pontos entre aprovação/falha; confirmação por 600s
no maior patamar aprovado. Também há 120s de usuários sem alterações.
Os resultados já existentes são reutilizados para retomar uma matriz interrompida;
use outro label para uma execução independente.

Cada usuário lógico é uma tela com exatamente um poll pendente. Cliques têm
fluxo independente, equivalente a 20% dos usuários agindo a cada 10s, mais uma
rajada de 5s a um clique/s por usuário ativo aos 60s. Escritas se distribuem
somente entre quadras observadas e alternam casas/estado; antes de cada ensaio,
a rodada ativa e a presença retornam à condição inicial. Uma casa fica reservada
à medição de propagação. Entradas HTTP na página Next ocorrem à taxa de N/min;
20% carregam também JS/CSS (navegador frio), 80% reutilizam esses assets.
O teste HTTP não executa JavaScript nem substitui os testes Playwright de navegação.
Tokens são preparados fora da carga; resolução pública de assinatura não é chamada
repetidamente, para não medir o throttling público de 30 chamadas/min por IP.

SLOs: snapshot inicial p95 <=1s, PATCH p95 <=500ms, erros inesperados <1%,
sem OOM/reinícios e sem iterações de chegada descartadas. Respostas normais de
poll sem mudança após 25s não entram no SLO de latência dos snapshots.
Propagação mede o intervalo do ACK do PATCH até outro cliente enxergar o estado,
com poll independente e cursor, e é relatada à parte: objetivo p95 <=5s.
Intervalos mais altos podem aumentar capacidade enquanto atrasam atualizações.

Resultados sanitizados em `results/<label>/*.json` e `summary.csv`: commits e
imagens, limites, p95, erros, contagem de propagação, distribuição entre APIs,
CPU/memória/rede dos containers e consultas/conexões do banco a cada ~5s.
Logs brutos e fixture permanecem em `.runtime/`; não publicá-los.
Falha/OOM do k6 invalida a medição; não representa limite da API.
Sem saturação observada, reportar capacidade como limite inferior comprovado.

Confirme comparações relevantes com três ensaios equivalentes:

```sh
python3 load-tests/matrix.py repeat --label next --intervals 3 --profiles hotspot --users 50 --repetitions 3
```

Faça apenas uma matriz por vez. Não execute builds ou outras cargas simultâneas.
Para evitar concorrência com servidores dev, pare somente API/Admin do workspace
antes da matriz e restaure ao terminar; não pare serviços de outros projetos.

```sh
# na raiz do workspace:
docker compose stop api admin
# ao concluir:
python3 territory-manager-v2/load-tests/matrix.py down
docker compose up -d api admin
```

Sem push/deploy/DNS: este roteiro só modifica o ambiente local de carga.
