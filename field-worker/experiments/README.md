# Histórico dos experimentos locais

O Compose normal executa `field-worker/main.cjs` e agora incorpora módulos próprios
de agrupamento, SQL por conjunto e leitura versionada/NOTIFY, sem importar estes
bootstraps. As descrições abaixo refletem o momento das campanhas anteriores.
Para reproduzir as comparações, usar as imagens congeladas nos manifests, não
reconstruir a referência antiga a partir do código atual: isso combinaria duas
implementações. Nunca executar os overlays/DDL de experimento no banco restaurado.

```bash
# Na raiz da API; usa o volume sintético preparado, nunca o banco restaurado:
node --test field-worker/tests/*.test.cjs
docker build -f Dockerfile.field -t territory-field-worker:grouping-experiment .
python3 -u field-worker/experiments/campaign.py --image territory-field-worker:grouping-experiment
```

Três variantes, 600 usuários/1s, mesmo pool de duas consultas e orçamento. Cada uma
passa por equivalência HTTP antes da carga. Aproximadamente 20–30 minutos no total,
incluindo preparação, observação e restauração de API/Admin entre variantes.

`grouped`: supressão de montagens simultâneas com chave tenant/território/quadra/
rodada/revisão/perfil. Compartilha a transação completa, não mistura cursor/payload
de transações distintas. Não retém resultado após conclusão. Mantém verificações
individuais, presença e cópias independentes da resposta.

`notify`: agrupamento mais uma conexão PostgreSQL dedicada; NOTIFY após commit da
revisão acorda interessados e invalida seu cache de revisão. A espera HTTP permanece
25s e a revalidação periódica continua em 1s. Isso mede notificações sem enfraquecer
revogação/expiração; não promete eliminar a carga de revalidação. Listener cai para
timer em falha e reconecta. Trigger criado/removido apenas no DB sintético.

Resultados em `field-worker/results/grouping-campaign-*/` e referências aos JSONs
individuais. Resumo anexado a `INVESTIGACAO-PERFORMANCE.md` para discussão. Sem
promoção automática, push ou alteração de produção; padrão local permanece 3s.
# Campanha ampliada: agrupamento, SQL e modelo de leitura

```bash
# Raiz da API. Imagem exclusiva: não substituir o tag do Compose normal.
node --test field-worker/tests/*.test.cjs
docker build -f Dockerfile.field -t territory-field-worker:advanced-experiment .
python3 field-worker/experiments/advanced-campaign.py --image territory-field-worker:advanced-experiment
```

Ordem: `reference`, `expanded`, `sql`, `readmodel`. Mesmos 600 usuários/1s,
pool de consultas 2 e limites da campanha anterior. Cada variante passa por
equivalência funcional antes de uma medição de 120s. Falha de integridade/segurança
interrompe a campanha; reprovação somente das metas de latência é registrada.

`expanded` agrupa leituras simultâneas de autorização por link (JWT/claims continuam
individuais), metadados e presença equivalentes, além da transação de snapshot.
Nenhum resultado de autorização concluído é guardado. `sql` também substitui
a busca LATERAL por casa por seleção de rodadas por conjunto; planos reais dos dois
SQLs são salvos no DB sintético antes da carga, não durante a medição.

`readmodel` adiciona tabela sintética de catálogo bruto por tenant/território/quadra/
rodada/revisão. Uma revisão incompatível nunca serve silenciosamente dados antigos:
reconstrói na mesma transação do cursor. A persistência da versão ocorre após commit,
com inserção idempotente; escritores concorrentes não substituem uma versão mais nova
por uma antiga. A tabela não contém tokens de assinatura nem decisões de autorização.
Assinatura de quadra é consultada novamente e campos temporais/perfil são recalculados.

Listener usa gerações por escopo, não uma geração global por qualquer alteração.
Notificações agendam reconstrução dos escopos conhecidos usando o mesmo pool de duas
conexões. Listener mantém uma conexão dedicada adicional. Reconexão invalida revisões
e atualiza os escopos conhecidos; verificação periódica de 1s e revisão persistida
continuam obrigatórias, inclusive para autorização. Semântica não é event-only.

SQL e DDL restritos pelo executor e bootstrap ao banco `territory_manager_peak_load`
no host Docker `db`, usuário `load`. Tabela/função/trigger removidos no encerramento,
volume sintético preservado. Nada alterado na aplicação normal ou em produção.
Relatório e referências aos JSONs em `field-worker/results/advanced-campaign-*/` e
`INVESTIGACAO-PERFORMANCE.md` na raiz do workspace. Contadores finais incluem preparo
e drenagem; instrumentação de pool/timer está presente nas quatro variantes.
