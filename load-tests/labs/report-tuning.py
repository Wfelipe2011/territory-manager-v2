#!/usr/bin/env python3
"""Render sanitized saved trials; never runs load or opens a database."""
import argparse,csv,json,statistics
from collections import defaultdict
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--complete',action='store_true')
a=p.parse_args()
root=Path(__file__).resolve().parent/'results'
rows=[]
for folder in sorted(root.iterdir()):
 if not folder.is_dir() or not folder.name.startswith(('bun-','confirm-','compare-','interval-')):continue
 excluded=set()
 if (folder/'exclusions.json').exists():
  excluded={d['id'] for d in json.loads((folder/'exclusions.json').read_text()).get('excludedFromWorkerPoolRanking',[])}
 for file in sorted(folder.glob('bun-*.json')):
  d=json.loads(file.read_text())
  if 'logicalUsers' not in d:continue
  d['_phase']=folder.name;d['_file']=str(file.relative_to(root));d['_excluded']=d['id'] in excluded
  rows.append(d)
if not rows:p.error('No completed new-profile trials')
fields=['phase','mode','batch','pool','users','groupPreference','intervalMs','repeat','idle','passed','excluded','snapshotP95Ms','markP95Ms','observerPropagationP95Ms','workerCpuPercentOfCore','postgresCpuPercentOfCore','generatorValid','image']
with (root/'bun-tuning.csv').open('w') as f:
 writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
 for d in rows:
  writer.writerow(dict(zip(fields,[d['_phase'],d.get('snapshotMode','baseline'),d.get('batchValidation',False),d['poolSize'],d['logicalUsers'],d['groupPreference'],d['checkIntervalMs'],d['repeat'],d.get('idleOnly',False),d['passed'],d['_excluded'],d['snapshotP95Ms'],d['markP95Ms'],d['propagation'].get('observer_p95_ms'),d['cpuAveragePercent'].get('territory-field-labs-bun-1'),d['cpuAveragePercent'].get('territory-field-labs-db-1'),d['generatorValid'],next(x['imageId'] for x in d['before'] if x['service']=='bun')])) )
def span(values):
 values=[x for x in values if x is not None]
 if not values:return '—'
 return f'{min(values):.1f}–{max(values):.1f}' if len(values)>1 else f'{values[0]:.1f}'
groups=defaultdict(list)
for d in rows:
 groups[(d['_phase'],d['logicalUsers'],d['groupPreference'],d['checkIntervalMs'],d['poolSize'],d.get('snapshotMode','baseline'),d.get('batchValidation',False),d.get('idleOnly',False))].append(d)
lines=['# Bun + PostgreSQL: ajuste e capacidade local','',
 'Campanha concluída.' if a.complete else '**Parcial: a campanha ainda está em execução.**','',
 'Recursos fixos: Bun 0,5 CPU/2 GiB; PostgreSQL 1 CPU/2 GiB; API de marcações 0,4 CPU/2 GiB; nginx 0,1 CPU/128 MiB. Gerador 1 CPU/1 GiB, no mesmo host, fora desse orçamento.',
 'Base sintética de 12 tenants, 400 quadras, 60 mil casas e 480 mil participações. Uma consulta pendente por leitor; 10% também marcam uma casa a cada 30s. Casos idle não fazem marcações.',
 'Cada ponto: 65s de preparação, 120s de medição, 90s de observação adicional e encerramento. Sem Next/assets ou escrita de sonda. Sentinela de leitura na API original a cada pelo menos 5s.','',
 '| Fase | Versão | Usuários | Grupo preferido | Pool | Intervalo s | Execuções/PASS | Entrada p95 ms | Marcação p95 ms | Propagação observadores p95 ms | CPU Bun % core | CPU PG % core |',
 '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
for key,values in groups.items():
 phase,users,group,interval,pool,mode,batch,idle=key
 label=mode+(' + validação SQL' if batch else '')+(' / idle' if idle else '')
 if any(d['_excluded'] for d in values):label+=' (exploratório excluído)'
 lines.append('| '+' | '.join([phase,label,str(users),str(group),str(pool),str(interval/1000),f'{len(values)}/{sum(d["passed"] for d in values)}',span([d['snapshotP95Ms'] for d in values]),span([d['markP95Ms'] for d in values]) if not idle else '—',span([d['propagation'].get('observer_p95_ms') for d in values]),span([d['cpuAveragePercent'].get('territory-field-labs-bun-1') for d in values]),span([d['cpuAveragePercent'].get('territory-field-labs-db-1') for d in values])])+' |')
lines+=['','Faixas são mínimo–máximo dos p95 por execução, não p95 agregado. CPU de 50% de um core corresponde aproximadamente ao teto do worker de 0,5 CPU.','',
 '## Critérios e limites','',
 '- PASS exige prontidão de todos, entrada p95 ≤1s, marcação p95 ≤500ms, erros <1%, integridade das marcações/observações, agendamento e infraestrutura válidos, além de propagação amostrada p95 ≤5s.',
 '- A propagação principal deste roteiro inclui cada observador amostrado. A métrica do primeiro observador também permanece nos JSONs; nenhuma representa entrega comprovada a todas as telas ou renderização no celular.',
 '- Respostas sem alteração aguardando 25s são normais. Latência de polls com alteração também inclui espera; não equivale ao tempo de construir o snapshot.',
 '- Preferência de dez/vinte não significa grupo exato: a população é balanceada por tenant. Os grupos mudam entre patamares; não presumir capacidade estritamente monotônica nem um máximo matemático.',
 '- Escolha de pool e busca inicial são exploratórias. Capacidade confirmada exige três execuções aprovadas na mesma configuração; resultados de dois minutos não certificam capacidade sustentada em produção.',
 '- Pool da API de marcações fixo em dez. O primeiro ponto pool=1 da grade acoplava os dois pools e foi excluído da escolha; há repetição corrigida em bun-pool1-fixed.',
 '- Tempos dos wrappers são wall time inclusivo e podem se sobrepor. CPU é medida separadamente. SQL total inclui preparação e observação; amostras de CPU cobrem somente a janela de medição.',
 '- Índices existentes foram mantidos. Planos READ ONLY reproduzíveis em sql-tuning-plans/; o snapshot agregado executa mais trabalho no PG em troca de menos consultas/hidratação no Bun.',
 '- Bun usa o mesmo domínio compilado da imagem read-collation; joined otimiza relações; aggregate monta JSON/contagens e presença no banco. Validação SQL opcional lê novamente a cada invocação, sem cache de autorização.',
 '- API principal/frontend/produção não foram migrados. Nenhum push/deploy. Os serviços habituais são restaurados pelos runners e o volume sintético é preservado.','',
 'CSV: [bun-tuning.csv](bun-tuning.csv). JSONs individuais contêm limites efetivos, imagens, hashes de implementação quando disponíveis, métricas, SQL, contagens e monitoramento.','']
(root/'BUN-TUNING.md').write_text('\n'.join(lines))
print(root/'BUN-TUNING.md')
