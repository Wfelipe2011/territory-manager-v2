#!/usr/bin/env python3
"""Four synthetic variants; preserve evidence and stop on security/integrity failure."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
API = ROOT.parents[1]
WORKSPACE = API.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--variants', default='reference,expanded,sql,readmodel')
    args = parser.parse_args()
    variants = args.variants.split(',')
    if len(set(variants)) != len(variants) or any(v not in ['reference', 'expanded', 'sql', 'readmodel'] for v in variants):
        parser.error('Unknown or repeated variant')
    results = API / 'field-worker/results'
    output = results / ('advanced-campaign-' + time.strftime('%Y%m%d-%H%M%S', time.gmtime()))
    output.mkdir(parents=True)
    manifest = {'scope': 'local synthetic only; no promotion', 'image': args.image, 'users': 600,
        'checkMs': 1000, 'queryPool': 2, 'measurementSeconds': 120, 'order': variants,
        'implementationHashes': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.iterdir() if p.suffix in ['.cjs', '.sql']}, 'trials': []}
    failure = None
    try:
        for variant in variants:
            prior = set(results.glob('integration-*'))
            print('Starting:', variant, flush=True)
            code = subprocess.run([sys.executable, '-u', str(API / 'field-worker/tests/verify.py'),
                '--image', args.image, '--load-users', '600', '--check-ms', '1000', '--experiment', variant], cwd=API).returncode
            new = set(results.glob('integration-*')) - prior
            if len(new) != 1:
                raise RuntimeError('Missing unique evidence: ' + variant)
            directory = new.pop()
            summary = json.loads((directory / 'verification.json').read_text())
            paths = list(directory.glob('bun-*.json'))
            if len(paths) != 1 or not summary.get('equivalencePassed') or not summary.get('normalStackRestored'):
                raise RuntimeError('Incomplete parity/load/restoration: ' + variant)
            row = json.loads(paths[0].read_text())
            if code not in [0, 1] or not all(row[k] for k in ['generatorValid', 'monitoringValid', 'infrastructureValid', 'functionalSteadyPassed']):
                raise RuntimeError('Invalid generator/infrastructure or functional integrity: ' + variant)
            if not summary.get('experimentStats'):
                raise RuntimeError('Missing experimental instrumentation: ' + variant)
            manifest['trials'].append({'variant': variant, 'directory': str(directory.relative_to(API)), 'verification': summary, 'loadFile': str(paths[0].relative_to(API))})
            (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    except Exception as error:
        failure = str(error)
    finally:
        manifest['failure'] = failure
        (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        lines = ['# Agrupamento ampliado, SQL e tabela de leitura — experimento local', '',
            '600 usuários/12 tenants; preferência de grupo 10; 10% marcando a cada 30s.',
            'Pool de consultas 2, verificação de segurança 1s, long polling 25s.',
            'Worker 0,5 CPU/2 GiB; banco 1 CPU/2 GiB; API 0,4 CPU/2 GiB; nginx 0,1 CPU/128 MiB.',
            '65s de preparação + 120s medição + 90s observação; gerador separado no mesmo host.', '',
            '| Variante | Entrada p95 ms | Marcação p95 ms | Primeiro observador p95 ms | Observações p95 ms | Erros | ACK | CPU worker / banco | PASS |',
            '|---|---:|---:|---:|---:|---:|---:|---|---|']
        for trial in manifest['trials']:
            row = json.loads((API / trial['loadFile']).read_text())
            cpu = row['cpuAveragePercent']
            lines.append('| ' + ' | '.join([trial['variant'], f'{row["snapshotP95Ms"]:.1f}', f'{row["markP95Ms"]:.1f}',
                f'{row["propagation"]["p95_ms"]:.1f}', f'{row["propagation"]["observer_p95_ms"]:.1f}', f'{100*row["errorRateStartedInWindow"]:.2f}%',
                str(row['propagation']['acknowledged_writes']), f'{cpu.get("territory-field-labs-bun-1",0):.1f}% / {cpu.get("territory-field-labs-db-1",0):.1f}%', str(row['passed'])]) + ' |')
            stats = trial['verification']['experimentStats']
            (output / (trial['variant'] + '-stats.json')).write_text(json.dumps(stats, indent=2) + '\n')
        lines += ['', '## Variantes e limites', '',
            '- reference: algoritmo normal, com a mesma instrumentação de pool/event loop das demais variantes.',
            '- expanded: agrupamento in-flight de transações de snapshot, leituras de autorização por link, metadados equivalentes e presença equivalente.',
            '- Cada validação original ainda verifica JWT/claims individualmente. Não há autorização guardada depois que a consulta termina; expiração é novamente conferida por caller.',
            '- sql: expanded + seleção das primeiras rodadas por conjunto, preservando o menor id por casa. Planos EXPLAIN ANALYZE BUFFERS dos dois SQLs nos ensaios sql/readmodel.',
            '- readmodel: sql + catálogo bruto versionado em tabela sintética, não JSON final de permissões. Tokens de assinatura não são persistidos nessa tabela.',
            '- Dados brutos e revisão são lidos na mesma transação RepeatableRead. Materialização é armazenada após commit em chave imutável; revisão incompatível resulta em reconstrução, nunca resposta silenciosamente velha.',
            '- NOTIFY por escopo invalida revisões locais e agenda atualização dos escopos conhecidos no mesmo pool de duas conexões. Listener dedicado acrescenta uma conexão, não um segundo pool de consultas.',
            '- Reconexão invalida revisões e agenda atualização dos escopos conhecidos; timer/revisões persistidas recuperam eventos perdidos. A verificação de autorização continua em 1s, antes de entregar snapshots.',
            '- Campos temporais/perfil são recalculados, presença e identidade não são congeladas no catálogo. Heartbeat e cancelamento permanecem individuais.',
            '- Contadores finais incluem aquecimento/preparo/drenagem. CPU vem da janela medida. PoolWait inclui aquisição de todas as consultas/transações; lag mede atraso do timer de 100ms, não um perfil completo de CPU.',
            '- Uma repetição por variante, ordem fixa; não demonstra máximo, ganho estatístico ou uma VPS física dedicada.',
            '- Trigger, função e tabela apenas no DB sintético, removidos no fim; nenhuma migration ou fonte de domínio da aplicação alterada.',
            '- Nenhuma promoção automática, mudança em produção, commit ou push. Stack normal restaurada com pool 2 e intervalo 3s.', '']
        if failure:
            lines += ['**Execução interrompida para investigação:** ' + failure, '']
        text = '\n'.join(lines)
        (output / 'README.md').write_text(text)
        with (WORKSPACE / 'INVESTIGACAO-PERFORMANCE.md').open('a') as report:
            report.write('\n\n## 16. Agrupamento ampliado, SQL e modelo de leitura — 25/10/2026\n\n'
                + f'Evidências: `{output.relative_to(WORKSPACE)}/README.md` e `manifest.json`.\n\n'
                + text.replace('# Agrupamento ampliado, SQL e tabela de leitura — experimento local', '### Resultados', 1).replace('\n## ', '\n### '))
        print(text, flush=True)
        print('Evidence:', output, flush=True)
    if failure:
        raise SystemExit(failure)


if __name__ == '__main__':
    main()
