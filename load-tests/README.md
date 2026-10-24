# Carga local do endpoint de ruas e casas

Roteiro k6 HTTP, exclusivamente na base sintética `territory_manager_load`.
API via balanceador em 3301; Admin em 5800, sem tráfego Next no ensaio principal.
Não usa assinaturas, dumps ou marcações reais. Fixture privada em `.runtime/`.

## Preparação e recursos

Execute na raiz da API:

```sh
python3 load-tests/matrix.py prepare --label read-baseline
python3 load-tests/matrix.py matrix --label read-baseline --intervals 3
```

A imagem da API é selecionada por `LOAD_VARIANT` (por padrão, o label).
A imagem do Admin permanece `baseline`, configurável por `LOAD_ADMIN_VARIANT`.
Metadados das imagens e seus commits ficam em `results/image-sources.json`.
Use labels novos para medições independentes: resultados existentes são retomados.

Base reproduzível: 10 congregações, 50 territórios, 400 quadras, 1.200 ruas,
60 mil casas e 480 mil participações. `prepare` verifica contagens e limites e
atualiza estatísticas das tabelas sintéticas antes das comparações.

| Serviço | CPU | Memória |
|---|---:|---:|
| Cada API (duas, produção) | 1 | 512 MiB |
| Admin (produção) | 0,5 | 512 MiB |
| PostgreSQL 16 | 1 | 1 GiB |
| Nginx, sem afinidade | 0,25 | 128 MiB |
| k6 1.3.0 | 1 | 1 GiB |

API usa pool de dez conexões por instância e heap máximo de 384MiB. PostgreSQL:
shared_buffers 256MiB, max_connections 100, pg_stat_statements habilitado.
HTTP aguarda até 25s; cliente aceita 35s; proxy 45s. Intervalo de verificação é
independente da espera máxima, configurado por FIELD_POLL_CHECK_MS.

## Perfil v2

Antes de cada ensaio, cem GETs autenticados, com concorrência vinte, aquecem as duas APIs e seus pools;
aguardam-se dois segundos para expirar a revisão em memória, e presença/estatísticas
são reinicializadas. Esse preparo não entra na carga medida. O snapshot inicial
mede chegada simultânea de usuários a servidores aquecidos. Partidas frias ficam
separadas em `results/exploratory/`, sem comparação direta de capacidade.

Todos os ensaios duram **120s**, com até 35s de encerramento das requisições.
Patamares: 10,20,50,100,200,400,800,1600 usuários; parada na primeira falha,
até dois refinamentos em múltiplos de dez e ensaio separado somente de leitores.
Não há confirmação de dez minutos nem rajadas, assets ou sonda com escritas extras.

Cada usuário lógico mantém uma consulta pendente no endpoint
`GET /v1/field/blocks/:blockId/sync`. Dez por cento também marcam a cada 30s,
com chegadas distribuídas e executor de escrita independente do polling.
Distribuído: grupos de dez telas por quadra, uma ativa por grupo. Concentrado:
todas as telas na mesma quadra. Reutilização de casas alterna o estado.
Antes de cada ensaio, somente a rodada sintética e a presença são reinicializadas.

Propagação é calculada dos ACKs dessas escritas e das observações de outras telas
existentes, sem usuários extras. Uma tela por grupo registra transições; no cenário
concentrado a amostra é limitada a vinte observadores. Para cada ACK mede-se a
primeira observação correspondente por outra tela, limitada pela próxima escrita
na mesma casa. Recebimento anterior ao ACK, após início da escrita, conta zero.
Com dez usuários existem apenas quatro escritas em dois minutos: amostra pequena,
explicitada no relatório e complementada por três repetições equivalentes.

Métricas separadas: snapshot inicial, poll com alteração e poll sem alteração.
Duração de poll inclui espera intencional e não é tempo de construção do snapshot.
SLO: inicial p95 <=1s, marcação p95 <=500ms, erros <1%, sem OOM/reinícios/carga
descartada e sem observações perdidas. Propagação p95 <=5s é objetivo separado.
Falhas do gerador ou CPU do gerador saturada com chegadas descartadas invalidam
uma conclusão de capacidade da aplicação. Monitoram-se também carga/memória do
host, recursos/rede dos containers e consultas/conexões PostgreSQL.

## Comparações

Medir referência, correção SQL e ajuste de polling separadamente, inicialmente
com intervalo 3s. Na melhor versão, comparar 3,5,10,15,20,25s em patamar comum
aprovado nos dois cenários. Repetir pontos principais três vezes por dois minutos:

```sh
python3 load-tests/matrix.py repeat --label read-poll --intervals 3,5,10,15,20,25 --profiles distributed,hotspot --users 100 --repetitions 1
python3 load-tests/matrix.py repeat --label read-poll --intervals 3 --profiles distributed,hotspot --users 100 --repetitions 3
```

Resultados sanitizados: JSON/CSV em `results/`; logs e JWTs somente em `.runtime/`
ignorado. Resultados v1, com outro perfil, não são diretamente comparáveis.
Capacidade corresponde a ensaios curtos de dois minutos, não garantia em produção.

Não fazer builds nem outras cargas durante medições. Na raiz do workspace, parar
somente API/Admin habituais antes da carga e restaurar depois:

```sh
docker compose stop api admin
python3 territory-manager-v2/load-tests/matrix.py down
docker compose up -d api admin
```

Não publicar imagens, fazer push/deploy ou alterar produção.

## Perfil principal: doze tenants ativos

Meta confirmada: 150–300 usuários simultâneos habituais e 1.000 no pico, no total
somando doze tenants; normalmente 10–20 pessoas por quadra. O perfil `peak` usa uma
segunda base sintética `territory_manager_peak_load`, com os mesmos 60 mil/480 mil
registros. A base da comparação inicial permanece preservada. Nenhuma usa dumps.

```sh
LOAD_VARIANT=read-poll python3 load-tests/matrix.py prepare --label peak-poll --dataset peak
LOAD_VARIANT=read-poll python3 load-tests/matrix.py target --label peak-poll --dataset peak --users 150,300,1000 --groups 10 --profiles distributed --repetitions 1
LOAD_VARIANT=read-poll python3 load-tests/matrix.py target --label peak-poll --dataset peak --users 1000 --groups 20 --profiles distributed --repetitions 1
```

No cenário `target`, as telas entram gradualmente em 30s; a preparação total tem
65s, e exige que todas tenham carregado antes de iniciar a janela de **120s** de
medição. O encerramento aceita mais 35s para consultas pendentes. O tempo total
inclui essa preparação: não é apresentado como uma execução inteira de 120s.
CPU/memória do monitor são guardados completos; a média de CPU utiliza a janela
medida, excluindo preparação e encerramento. As consultas acumuladas do PostgreSQL
incluem preparação e encerramento e são identificadas como tal.

A latência do carregamento inicial é registrada separadamente do resultado de
permanência. Entrada lenta não significa incapacidade de manter usuários ativos;
respostas/erros, marcações, presença e propagação continuam sendo verificadas.
`initial_ready` exige todas as telas prontas no início da medição. `steady-idle`
mede somente leitores. Cada cenário tem uma única consulta pendente por tela.

A distribuição reparte primeiro os usuários entre os doze tenants e depois entre
quadras: 150 usuários = grupos de 12–13 em 12 quadras; 300 = 12–13 em 24 quadras;
1.000 = 10–11 em 96 quadras (preferência 10) ou 16–17 em 60 (preferência 20).
Ativos também são repartidos entre todos os tenants; casas não colidem entre
escritores do mesmo grupo. Duas telas leitoras por quadra observam as mudanças.
Todos na mesma quadra usam apenas um tenant e representam estresse, não a meta.

```sh
node load-tests/distribution.test.mjs
python3 load-tests/test_metrics.py
```
