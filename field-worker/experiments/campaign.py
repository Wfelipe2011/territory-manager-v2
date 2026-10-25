#!/usr/bin/env python3
"""Three isolated, explicitly experimental variants; record results for discussion."""
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
    args = parser.parse_args()
    results = API / 'field-worker/results'
    output = results / ('grouping-campaign-' + time.strftime('%Y%m%d-%H%M%S', time.gmtime()))
    output.mkdir(parents=True)
    manifest = {'scope': 'local synthetic only; no automatic promotion', 'image': args.image,
        'users': 600, 'checkMs': 1000, 'queryPool': 2, 'measurementSeconds': 120,
        'implementationHashes': {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in ROOT.glob('*') if path.suffix in ['.cjs', '.sql']}, 'trials': []}
    failure = None
    try:
        for variant in ['baseline', 'grouped', 'notify']:
            before = set(results.glob('integration-*'))
            print('Starting variant:', variant, flush=True)
            code = subprocess.run([sys.executable, '-u', str(API / 'field-worker/tests/verify.py'),
                '--image', args.image, '--load-users', '600', '--check-ms', '1000', '--experiment', variant], cwd=API).returncode
            new = set(results.glob('integration-*')) - before
            if len(new) != 1:
                raise RuntimeError('Cannot uniquely identify evidence for ' + variant)
            directory = new.pop()
            summary = json.loads((directory / 'verification.json').read_text())
            load_paths = list(directory.glob('bun-*.json'))
            if len(load_paths) != 1 or not summary.get('equivalencePassed') or not summary.get('normalStackRestored'):
                raise RuntimeError('Incomplete parity/load/restoration for ' + variant)
            load = json.loads(load_paths[0].read_text())
            if code not in [0, 1] or not all(load[key] for key in ['generatorValid', 'monitoringValid', 'infrastructureValid']):
                raise RuntimeError('Invalid infrastructure/generator measurement for ' + variant)
            if variant != 'baseline' and not summary.get('experimentStats'):
                raise RuntimeError('Missing experimental execution evidence')
            manifest['trials'].append({'variant': variant, 'directory': str(directory.relative_to(API)),
                'verification': summary, 'loadFile': str(load_paths[0].relative_to(API))})
            (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    except Exception as error:
        failure = str(error)
    finally:
        manifest['failure'] = failure
        (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        lines = ['# Agrupamento e notificações — ensaio local', '',
            '600 usuários, 12 tenants, preferência de grupo 10; 10% marcando a cada 30s.',
            'Pool de consultas 2, verificação de segurança 1s, long polling 25s.',
            'Mesmos limites: Bun 0,5 CPU/2 GiB; PostgreSQL 1 CPU/2 GiB; API 0,4 CPU/2 GiB; nginx 0,1 CPU/128 MiB.',
            '65s de preparo, 120s de medição e 90s de observação final. Gerador separado no mesmo host.', '',
            '| Variante | Carregamento p95 ms | Marcação p95 ms | Primeiro observador p95 ms | Observações p95 ms | Erros | ACK | CPU worker / banco | PASS |',
            '|---|---:|---:|---:|---:|---:|---:|---|---|']
        for trial in manifest['trials']:
            data = json.loads((API / trial['loadFile']).read_text())
            cpu = data['cpuAveragePercent']
            lines.append('| ' + ' | '.join([trial['variant'], f'{data["snapshotP95Ms"]:.1f}', f'{data["markP95Ms"]:.1f}',
                f'{data["propagation"]["p95_ms"]:.1f}', f'{data["propagation"]["observer_p95_ms"]:.1f}',
                f'{100*data["errorRateStartedInWindow"]:.2f}%', str(data['propagation']['acknowledged_writes']),
                f'{cpu.get("territory-field-labs-bun-1",0):.1f}% / {cpu.get("territory-field-labs-db-1",0):.1f}%', str(data['passed'])]) + ' |')
            experiment = trial['verification'].get('experimentStats')
            if experiment:
                (output / (trial['variant'] + '-stats.json')).write_text(json.dumps(experiment, indent=2) + '\n')
        lines += ['', '## Interpretação e limites', '',
            '- Uma execução por variante, ordem fixa referência → agrupamento → agrupamento + notificações; não são três confirmações.',
            '- Primeiro observador e todas as observações amostradas são métricas diferentes; nenhuma comprova toda tela.',
            '- Agrupamento somente enquanto a transação está em andamento: sem cache de resultados concluídos ou de autorização.',
            '- Chave inclui tenant, território, quadra, rodada, revisão, perfil de resposta e parâmetros temporais/permissões.',
            '- Cursor e dados vêm da mesma transação; cada leitor recebe cópia independente. Presença e revalidação continuam individuais.',
            '- NOTIFY é um aviso após commit da revisão persistida. Listener dedicado acrescenta uma conexão além das duas de consultas.',
            '- Verificação de segurança continua em 1s: revogação/expiração não foram relaxadas. Notificações podem acordar antes do timer.',
            '- Perda da conexão invalida revisões locais e acorda leitores; reconexão faz LISTEN antes de depender dos eventos. Timer continua como fallback.',
            '- Somente o banco sintético recebe trigger experimental, removido ao terminar. Nenhuma migration da aplicação foi alterada.',
            '- Em cenários com PgBouncer, o listener precisa de conexão direta ou session pooling, não transaction pooling.',
            '- SQL total e contadores finais abrangem também preparo e observação; CPU média é da janela de medição.',
            '- Espera acumulada de aquisição de conexão existente mede transações, não toda espera de pool de todas as consultas.',
            '- CPU/cgroups/pool/consultas permanecem nos JSONs. Limites são caps no host compartilhado, não uma VPS física dedicada.',
            '- Nada foi promovido automaticamente: Compose normal permanece com a implementação anterior e intervalo 3s.',
            '- Sem push ou publicação em produção.', '']
        if failure:
            lines += ['**Campanha interrompida por falha de execução/validação:** ' + failure, '']
        text = '\n'.join(lines)
        (output / 'README.md').write_text(text)
        with (WORKSPACE / 'INVESTIGACAO-PERFORMANCE.md').open('a') as report:
            report.write('\n\n## 15. Experimentos de agrupamento e LISTEN/NOTIFY — 25/10/2026\n\n'
                + f'Evidências: `{output.relative_to(WORKSPACE)}/README.md` e `manifest.json`, com referências aos ensaios individuais.\n\n'
                + text.replace('# Agrupamento e notificações — ensaio local', '### Resultados', 1).replace('\n## ', '\n### '))
        print(text, flush=True)
        print('Evidence:', output, flush=True)
    if failure:
        raise SystemExit(failure)


if __name__ == '__main__':
    main()
