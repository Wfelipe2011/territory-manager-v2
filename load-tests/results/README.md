# Evidências de carga

- `validation/`: smoke do roteiro, sem valor de capacidade; dados sintéticos.
- `baseline/`: referência funcional commitada, antes de alterações de performance.
- `failover.json`: reconexão pelo balanceador após interromper uma API.

Cada JSON inclui métricas, limites reais e imagens Docker. JWTs e fixture não
entram nestes arquivos. Logs/fixture ficam em `../.runtime/` (ignorado).
O k6 roda uma matriz por vez, no perfil fixo descrito em `../README.md`.
Resultados são medição local sob essas condições, não previsão de produção.

## Pausa solicitada pelo usuário — 24/10/2026

Foram concluídos 18 ensaios da referência, com verificações a cada 3 e 5 segundos.
A confirmação de dez minutos com 5s/quadra concentrada/7 usuários foi interrompida
e não integra os resultados. Os intervalos de 10, 15, 20 e 25 segundos não foram
executados. O executor da matriz e a sequência automática de otimizações foram
encerrados. Nenhuma otimização do Next ou da API foi aplicada; os rascunhos estão
em `../.runtime/`, ignorado pelo Git. Não existe comparação antes/depois concluída.

### Resultados principais (p95)

| Verificação / cenário | Usuários | Duração | Ruas/casas | Marcação | Propagação |
|---|---:|---:|---:|---:|---:|
| 3s / distribuído | 10 | 2 min | 3.260 ms | 91 ms | 2,96 s |
| 3s / distribuído | 5 | 10 min | 288 ms | 61 ms | 2,96 s |
| 3s / mesma quadra | 7 | 10 min | 436 ms | 63 ms | 3,01 s |
| 5s / distribuído | 10 | 2 min | 4.241 ms | 79 ms | 4,98 s |
| 5s / distribuído | 5 | 10 min | 229 ms | 56 ms | 4,96 s |

O patamar de dez usuários falhou na meta de carregamento de até 1s nos dois
cenários e intervalos (mesma quadra: 2.278ms a 3s e 2.129ms a 5s). As confirmações
de carga mista com cinco usuários distribuídos e sete concentrados passaram nas
condições acima, mas o ensaio somente de observadores com cinco distribuídos
falhou no carregamento: 1.043ms a 3s e 1.510ms a 5s. Não afirmar, portanto, uma
capacidade geral garantida de cinco ou sete usuários. A abertura simultânea e os
snapshots também da sonda de propagação fazem parte deste perfil de teste.

Todos os 18 ensaios completos tiveram taxa de erros inesperados zero, sem OOM,
reinicializações ou iterações descartadas. Isso não elimina a falha de latência.
Os limites de CPU/memória foram verificados nos containers. A base é sintética:
60 mil casas e 480 mil participações, isolada do banco local restaurado.

### Gargalo observado e hipótese de correção

`pg_stat_statements` apontou a consulta de casas como maior custo acumulado.
A relação Prisma para excluir vínculos rejeitados produz uma subconsulta de IDs
que percorre o catálogo inteiro, embora a consulta externa seja de uma quadra.
Esse é o principal candidato a otimização, ainda sem medição da correção.
Também foi identificado um risco de snapshots repetidos devido a revisão em
cache anterior à revisão do snapshot recém-carregado; a correção está apenas em
rascunho e precisa de validação. Não atribuir o gargalo ao Next ou ao transporte
long polling com os dados disponíveis.

Três segundos é a melhor opção preliminar entre as duas verificadas para a meta
de propagação p95 até 5s. Cinco segundos ficou no limite, inclusive ultrapassando
5s em alguns ensaios. O tempo máximo da requisição HTTP continua em 25s e não se
confunde com o intervalo entre verificações. O padrão aplicado no ambiente local
permanece em 2s, sem alteração por estes ensaios.

### Entrega funcional e estado da pausa

- API: `0dba5b8` (funcional), `b442e2a` (inicialização sem Firebase), `dd28524` (roteiro e validação entre instâncias).
- Admin: `b080214` (mobile unificado, logo, ações inferiores e casas provisórias).
- Validação: 184 testes de integração, 27 unitários e nove de navegador aprovados; typecheck e builds de produção aprovados. Três testes SMTP ignorados.
- Sincronização entre APIs verificada nos dois sentidos; recuperação via balanceador após parada de uma API verificada em ensaio separado.
- Sem push/publicação. JSONs desta referência parcial e este resumo preservados no disco, ainda sem commit.
- Ambiente de carga encerrado sem apagar o volume sintético. Ambiente habitual restaurado com uma API e o Admin unificado.
