#!/usr/bin/env python3
"""Replace the unmonitored first Nest run and record the completed comparison."""
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
ORIGINAL = ROOT / 'results/comparison-20261025-101734'
WORKSPACE = ROOT.parents[2]


def main():
    # Block on the same resource lock; no concurrent load and no progress polling.
    print('Waiting for the active comparison to release the laboratory lock.', flush=True)
    with (ROOT.parent / '.runtime/runner.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        original = [json.loads(path.read_text()) for path in ORIGINAL.glob('*-g10-3s-r*.json')]
        expected = {(variant, repeat) for variant in ['nest', 'bun'] for repeat in [1, 2, 3]}
        if {(row['variant'], row['repeat']) for row in original} != expected:
            raise RuntimeError('Original comparison did not complete all six trials; not treating partial work as complete')
        invalid = [row for row in original if not row['generatorValid'] or not row['infrastructureValid']]
        if [(row['variant'], row['repeat']) for row in invalid] != [('nest', 1)]:
            raise RuntimeError('Unexpected invalid trials; investigate before scheduling replacements')
        previous = set(ROOT.glob('results/comparison-*'))
    print('Replacing only Nest repetition 1 with monitored repetition 4.', flush=True)
    subprocess.run([sys.executable, '-u', str(ROOT / 'compare.py'), '--users', '150', '--repetitions', '1',
                    '--variants', 'nest', '--repeat-start', '4'], check=True)
    new = set(ROOT.glob('results/comparison-*')) - previous
    candidates = [path for directory in new for path in directory.glob('nest-150u-g10-3s-r4.json')]
    if len(candidates) != 1:
        raise RuntimeError('Could not identify the replacement evidence')
    replacement_path = candidates[0]
    replacement = json.loads(replacement_path.read_text())
    if not replacement['generatorValid'] or not replacement['infrastructureValid']:
        raise RuntimeError('Replacement is not a valid infrastructure/generator trial; no final comparison published')
    valid_paths = [path for path in ORIGINAL.glob('*-g10-3s-r*.json')
                   if path.name != 'nest-150u-g10-3s-r1.json'] + [replacement_path]
    if any(not json.loads(path.read_text())['generatorValid'] or not json.loads(path.read_text())['infrastructureValid'] for path in valid_paths):
        raise RuntimeError('Invalid evidence in final selection')
    stamp = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
    final = ROOT / 'results' / ('comparison-final-' + stamp)
    final.mkdir()
    manifest = []
    for path in valid_paths:
        shutil.copyfile(path, final / path.name)
        manifest.append({'source': str(path.relative_to(ROOT)), 'file': path.name,
                         'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    excluded = final / 'excluded'
    excluded.mkdir()
    shutil.copyfile(ORIGINAL / 'nest-150u-g10-3s-r1.json', excluded / 'nest-150u-g10-3s-r1.json')
    (final / 'selection.json').write_text(json.dumps({'included': manifest,
        'excluded': [{'file': 'excluded/nest-150u-g10-3s-r1.json',
            'reason': 'No CPU samples: docker stats failed when Bun container did not yet exist. Does not demonstrate generator saturation.'}],
        'replacement': 'Nest r4 replaces r1. Replacement scheduled after original series, not a fully randomized campaign.',
    }, indent=2) + '\n')
    subprocess.run([sys.executable, str(ROOT / 'report.py'), str(final)], check=True)
    restored = {}
    for name, url in [('api', 'http://localhost:3001/api'), ('admin', 'http://localhost:4800/login')]:
        with urllib.request.urlopen(url, timeout=15) as response:
            restored[name] = response.status
        if restored[name] != 200:
            raise RuntimeError('Normal service was not restored: ' + name)
    (final / 'restoration.json').write_text(json.dumps(restored, indent=2) + '\n')
    report = (final / 'README.md').read_text()
    footer = ('\n\n## Seleção das repetições\n\n'
        'Primeira repetição Nest excluída por ausência de amostras de CPU, causada por consulta a um container Bun ainda inexistente. '
        'Isso não comprova saturação do gerador. Monitor corrigido para consultar somente containers existentes/em execução '
        'e registrar falhas do comando. Nest r4 substitui r1; Nest r2/r3 e Bun r1/r2/r3 preservados. '
        'A reposição ocorreu depois da série original: a ordem final não é perfeitamente alternada. '
        'Dados excluídos preservados em `excluded/`; seleção e SHA-256 em `selection.json`.\n\n'
        'Ambiente normal verificado após encerramento: API 200, Admin 200. Sem push ou alteração em produção.\n')
    (final / 'README.md').write_text(report + footer)
    relative = str(final.relative_to(WORKSPACE))
    document = WORKSPACE / 'INVESTIGACAO-PERFORMANCE.md'
    section = ('\n\n## 11. Comparação HTTP dos laboratórios — três repetições válidas (2026-10-25)\n\n'
        f'Evidências: `{relative}/README.md` e JSONs individuais no mesmo diretório.\n\n'
        + report.replace('# Comparação dos laboratórios de campo', '### Condições e resultados', 1)
                .replace('\n## ', '\n### ') + footer.replace('\n## ', '\n### '))
    with document.open('a') as output:
        output.write(section)
    print('Completed comparison and investigation notes:', relative, flush=True)
    print(report + footer, flush=True)


if __name__ == '__main__':
    main()
