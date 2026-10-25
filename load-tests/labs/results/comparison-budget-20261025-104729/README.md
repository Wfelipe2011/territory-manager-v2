# Comparação dos laboratórios de campo

Mesmos limites: worker 0,5 CPU/2 GiB; API 0,4 CPU/2 GiB; PostgreSQL 1 CPU/2 GiB; nginx 0,1 CPU/128 MiB.
Pool 10, revisão 3s, 12 tenants, preferência de grupo 10, 10% marcando a cada 30s.
65s preparação + 120s medição + 90s observação adicional. VUs de escrita separados representam ações dos mesmos usuários lógicos.

| Usuários | Variante | Repetições | PASS | Snapshot p95 ms | Marcação p95 ms | Propagação p95 ms | Sentinela API p95 ms | Erros por início | CPU worker média % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 150 | nest | 2 | 0 | 33449.3–33677.7 | 126.7–127.8 | 64662.5–85634.4 | 279.2–385.0 | 47.60–48.99% | 50.4–50.7 |
| 150 | bun | 2 | 2 | 252.7–611.4 | 175.9–202.1 | 3360.4–3396.1 | 295.4–352.1 | 0.00–0.00% | 39.7–41.1 |

Faixas são mínimo–máximo dos p95 de cada repetição, **não um p95 agregado**.
CPU é percentual de um core: 50% aproxima o teto de 0,5 CPU do worker.

## Integridade por ensaio

| Ensaio | Prontos | ACK/previsto | Observados | Ausentes | Gerador válido | Infra válida | Steady funcional |
|---|---:|---:|---:|---|---|---|---|
| bun-150u-g10-3s-r1 | 150 | 60/60 | 60 | [] | True | True | True |
| bun-150u-g10-3s-r2 | 150 | 60/60 | 60 | [] | True | True | True |
| nest-150u-g10-3s-r2 | 125 | 60/60 | 60 | [] | True | True | False |
| nest-150u-g10-3s-r3 | 130 | 60/60 | 60 | [] | True | True | False |

## Escopo e limitações

- A carga é no fluxo HTTP completo, não somente três SELECTs ou montagem de snapshot.
- PASS exige entrada p95 <=1s, marcação p95 <=500ms e propagação amostrada p95 <=5s, além de integridade/erros/agendamento.
- Não houve escalada após um patamar com falhas. Falhar um patamar não demonstra incapacidade intrínseca do runtime/framework.
- Propagação é o primeiro observador amostrado, não todas as telas; ausência de observação não prova perda de persistência.
- Sentinela faz snapshot diretamente na API principal a cada pelo menos 5s; não representa todos os módulos administrativos.
- Classificação de erros pelo início do request inclui respostas tardias. Snapshot inclui recomposição após erro.
- CPU média somente na janela de medição. SQL total inclui preparação e drenagem.
- Gerador no mesmo host, com orçamento separado; não é certificação de uma VPS física de dois cores.
- Harness mudou (drenagem, agendamento e sentinela); não atribuir diferenças contra resultados históricos somente à stack.
- Comparação Bun/pg versus Nest/Prisma altera runtime, HTTP e driver juntos.


## Encerramento antecipado solicitado

O usuário limitou o restante a dez minutos. Ensaios válidos concluídos: Nest 2, Bun 2. Não foi concluído o plano de três repetições válidas por variante. Comparação preliminar; ensaios incompletos não foram contados. A primeira rodada Nest permanece excluída por falta de CPU coletada (docker stats consultava um container Bun ainda inexistente), não por saturação comprovada do gerador. As rodadas posteriores dispõem de monitoramento. API normal e Admin foram verificados HTTP 200 após encerramento. Sem push ou mudança em produção.
