#!/usr/bin/env python3
"""Enforce the user's shortened deadline, preserve completed trials, record limits."""
import argparse
import json
import os
from pathlib import Path
import select
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[2]


def matches(pid, expected):
    try:
        return expected.encode() in Path(f'/proc/{pid}/cmdline').read_bytes()
    except FileNotFoundError:
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runner', type=int, required=True)
    parser.add_argument('--queued-finalizer', type=int, required=True)
    parser.add_argument('--deadline-epoch', type=float, required=True)
    args = parser.parse_args()
    if matches(args.queued_finalizer, 'load-tests/labs/finish-comparison.py'):
        # The queued task owns no containers; stop it so it cannot add another run.
        os.kill(args.queued_finalizer, signal.SIGTERM)
    if matches(args.runner, 'load-tests/labs/compare.py'):
        fd = os.pidfd_open(args.runner)
        remaining = max(0, args.deadline_epoch - time.time())
        print(f'Waiting at most {remaining:.0f}s for current campaign; then graceful interruption and restoration.', flush=True)
        done, _, _ = select.select([fd], [], [], remaining)
        if not done:
            print('Shortened time budget reached: interrupting remaining campaign, not discarding completed evidence.', flush=True)
            os.kill(args.runner, signal.SIGINT)
            done, _, _ = select.select([fd], [], [], 70)
            if not done:
                raise RuntimeError('Runner has not finished cleanup; do not publish restoration success')
        os.close(fd)
    for service, url in [('api', 'http://localhost:3001/api'), ('admin', 'http://localhost:4800/login')]:
        with urllib.request.urlopen(url, timeout=15) as response:
            if response.status != 200:
                raise RuntimeError('Normal service not restored: ' + service)
    source = ROOT / 'results/comparison-20261025-101734'
    paths = list(source.glob('*-g10-3s-r*.json'))
    valid, excluded = [], []
    for path in paths:
        row = json.loads(path.read_text())
        (valid if row['generatorValid'] and row['infrastructureValid'] else excluded).append(path)
    if not valid:
        raise RuntimeError('No valid completed trials')
    stamp = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
    target = ROOT / 'results' / ('comparison-budget-' + stamp)
    target.mkdir()
    for path in valid:
        shutil.copyfile(path, target / path.name)
    (target / 'excluded').mkdir()
    for path in excluded:
        shutil.copyfile(path, target / 'excluded' / path.name)
    subprocess.run([sys.executable, str(ROOT / 'report.py'), str(target)], check=True)
    counts = {variant: sum(json.loads(path.read_text())['variant'] == variant for path in valid) for variant in ['nest', 'bun']}
    footer = ('\n\n## Encerramento antecipado solicitado\n\n'
        f'O usuário limitou o restante a dez minutos. Ensaios válidos concluídos: Nest {counts["nest"]}, Bun {counts["bun"]}. '
        'Não foi concluído o plano de três repetições válidas por variante. Comparação preliminar; '
        'ensaios incompletos não foram contados. A primeira rodada Nest permanece excluída por falta de CPU coletada '
        '(docker stats consultava um container Bun ainda inexistente), não por saturação comprovada do gerador. '
        'As rodadas posteriores dispõem de monitoramento. API normal e Admin foram verificados HTTP 200 após encerramento. '
        'Sem push ou mudança em produção.\n')
    report = (target / 'README.md').read_text() + footer
    (target / 'README.md').write_text(report)
    (target / 'selection.json').write_text(json.dumps({'valid': [path.name for path in valid],
        'excluded': [path.name for path in excluded], 'counts': counts, 'shortenedByUser': True,
        'restoration': {'api': 200, 'admin': 200}}, indent=2) + '\n')
    relative = target.relative_to(WORKSPACE)
    with (WORKSPACE / 'INVESTIGACAO-PERFORMANCE.md').open('a') as document:
        document.write('\n\n## 11. Comparação HTTP dos laboratórios — encerramento com prazo reduzido (2026-10-25)\n\n'
            f'Evidências: `{relative}/README.md` e JSONs individuais.\n\n'
            + report.replace('# Comparação dos laboratórios de campo', '### Resultados disponíveis', 1).replace('\n## ', '\n### '))
    print(report, flush=True)
    print('Recorded:', relative, flush=True)


if __name__ == '__main__':
    main()
