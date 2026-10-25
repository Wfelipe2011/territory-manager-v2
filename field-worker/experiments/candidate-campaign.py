#!/usr/bin/env python3
"""Promoted control + four independent candidates; synthetic only, no promotion."""
import argparse
import fcntl
import hashlib
import json
import signal
from pathlib import Path
import statistics
import subprocess
import sys
import time

API=Path(__file__).resolve().parents[2]
ROOT=API.parent
VARIANTS=['control','copies','roundtrips','native','cpu']

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image',required=True)
    parser.add_argument('--quick',action='store_true',help='One round per configuration, 30s tail, no extra profiling; 30-minute budget')
    args=parser.parse_args()
    output=API/'field-worker/results'/('candidate-campaign-'+time.strftime('%Y%m%d-%H%M%S',time.gmtime()))
    output.mkdir(parents=True)
    manifest={'scope':'synthetic only; no automatic promotion','image':args.image,'users':1000,'pool':2,'listener':1,'checkMs':1000,'preflights':[],'trials':[],'diagnostics':[],'failure':None,
              'orders':[VARIANTS,['roundtrips','native','cpu','control','copies'],['cpu','copies','control','native','roundtrips']],
              'sources':{str(p.relative_to(API)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (API/'field-worker/experiments').glob('*') if p.is_file()}}
    deadline=time.monotonic()+1800 if args.quick else None
    manifest.update(quick=args.quick,observerTailSeconds=30 if args.quick else 90,budgetSeconds=1800 if args.quick else None)
    if args.quick:manifest['orders']=[VARIANTS]
    def save(): (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    def run(variant,load=False,profile=False):
        before=set((API/'field-worker/results').glob('integration-*'))
        command=[sys.executable,'-u',str(API/'field-worker/tests/verify.py'),'--image',args.image,'--candidate',variant,'--check-ms','1000']
        if load: command+=['--load-users','1000']
        if args.quick:command+=['--observer-tail','30']
        if profile: command+=['--cpu-profile-dir',str(output/('profile-'+variant))]
        print('START',variant,'load',load,'profile',profile,flush=True)
        process=subprocess.Popen(command,cwd=API)
        try:
            code=process.wait(timeout=max(1,deadline-time.monotonic()) if deadline else None)
        except subprocess.TimeoutExpired:
            process.send_signal(signal.SIGINT)
            process.wait(timeout=120)  # Allow the verified finally block to restore the normal stack.
            raise RuntimeError('30-minute campaign budget reached; cleanup completed, no additional trials')
        new=set((API/'field-worker/results').glob('integration-*'))-before
        if len(new)!=1:raise RuntimeError('Missing unique evidence for '+variant)
        directory=new.pop()
        summary=json.loads((directory/'verification.json').read_text())
        evidence={'variant':variant,'directory':str(directory.relative_to(API)),'verification':summary,'exitCode':code}
        if code not in [0,1] or not summary.get('equivalencePassed'):raise RuntimeError('Parity/execution failed: '+str(directory))
        if not (directory/'read-model-integration.json').exists():raise RuntimeError('Missing database checks')
        if variant=='native' and not (directory/'native-integration.json').exists():raise RuntimeError('Missing native SQL compatibility checks')
        if not load:
            if code!=0:raise RuntimeError('Preflight failed '+variant)
            return evidence
        paths=list(directory.glob('bun-*.json'))
        if len(paths)!=1:raise RuntimeError('Missing load evidence')
        row=json.loads(paths[0].read_text());evidence['loadFile']=str(paths[0].relative_to(API))
        if not summary.get('normalStackRestored') or not summary.get('readModelHealthy'):raise RuntimeError('Restoration/derived maintenance failed')
        if not all(row[k] for k in ['generatorValid','monitoringValid','infrastructureValid','functionalSteadyPassed']):raise RuntimeError('Invalid/incomplete load: '+str(directory))
        if row['errorRateAllPhases']!=0 or row['errorRateStartedInWindow']!=0:raise RuntimeError('Unexpected request errors '+variant)
        return evidence
    lockpath=API/'load-tests/.runtime/candidate-campaign.lock'
    with lockpath.open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        try:
            if not args.quick:
                for variant in VARIANTS:
                    manifest['preflights'].append(run(variant));save()
            for repeat,order in enumerate(manifest['orders'],1):
                for variant in order:
                    evidence=run(variant,True);evidence['repeat']=repeat
                    manifest['trials'].append(evidence);save()
            # Profiling overhead must not contaminate any of the 15 main rounds.
            rows=[(t,json.loads((API/t['loadFile']).read_text())) for t in manifest['trials']]
            best=min(VARIANTS[1:],key=lambda v:statistics.median(r['snapshotP95Ms'] for t,r in rows if t['variant']==v))
            for variant in ([] if args.quick else ['control',best]):
                manifest['diagnostics'].append(run(variant,True,True));save()
        except (Exception,KeyboardInterrupt) as error:
            manifest['failure']=str(error)
        finally:
            save()
            lines=['# Controle + quatro candidatas — 1.000 usuários','',
                   ('Triagem rápida: uma rodada por configuração, 1s, pool 2 + listener; variantes independentes.' if args.quick else 'Três repetições por configuração, 1s, pool 2 + listener; variantes independentes.'),
                   'Controle/copies/roundtrips/native: worker 0,5 CPU e banco 1 CPU. CPU: worker 0,7 e banco 0,8.',
                   'API 0,4 CPU e proxy 0,1 CPU. Gerador separado, mesmo host. Sem promoção automática.','',
                   '| Variante | Rodadas | Entrada p95 mediana [min–max] ms | Marcação p95 mediana ms | Propagação amostrada p95 mediana ms |',
                   '|---|---:|---:|---:|---:|']
            for variant in VARIANTS:
                rows=[json.loads((API/t['loadFile']).read_text()) for t in manifest['trials'] if t['variant']==variant]
                if not rows:continue
                entry=[r['snapshotP95Ms'] for r in rows]
                lines.append(f'| {variant} | {len(rows)} | {statistics.median(entry):.1f} [{min(entry):.1f}–{max(entry):.1f}] | {statistics.median(r["markP95Ms"] for r in rows):.1f} | {statistics.median(r["propagation"]["observer_p95_ms"] for r in rows):.1f} |')
            lines+=['','Medians of per-trial percentiles are not pooled percentiles. Raw metrics include p50/95/99.',
                    ('Quick: no extra profiles or standalone preflights. Mandatory parity/database checks precede each load. 65s preparation + 120s measurement + 30s observer tail; shorter tail reduces tolerance to late deliveries.' if args.quick else 'Profiles are separate diagnostic runs, not used in the comparison.'),
                    'Native pool total/idle are estimates from its configured capacity; queue/active reservations are observed.',
                    'Source fixture is reset each trial; derived catalogs are cleared before the identical warmup.',
                    'Persisted revision counters may increase between trials; identities and business fixture remain the same.',
                    ('One round is exploratory only: no repeatability/variability claim or production certification.' if args.quick else 'Three repetitions reveal variability but do not establish production capacity or statistical significance.'),'']
            if manifest['failure']:lines+=['**INTERRUPTED:** '+manifest['failure'],'']
            text='\n'.join(lines);(output/'README.md').write_text(text)
            with (ROOT/'INVESTIGACAO-PERFORMANCE.md').open('a') as report:
                report.write('\n\n## 19. Controle + quatro candidatas, três repetições — campanha local\n\n'+f'Evidências: `{output.relative_to(ROOT)}`.\n\n'+text)
            print(text,flush=True);print('EVIDENCE',output,flush=True)
    if manifest['failure']:raise SystemExit(manifest['failure'])

if __name__=='__main__':main()
