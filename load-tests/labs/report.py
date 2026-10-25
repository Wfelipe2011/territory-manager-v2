#!/usr/bin/env python3
"""Render saved measurements only; does not access Docker or run more load."""
import argparse
import json
from pathlib import Path
import statistics


def format_range(values, digits=1):
    return f'{min(values):.{digits}f}–{max(values):.{digits}f}' if values else '—'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    rows = [json.loads(path.read_text()) for path in sorted(args.directory.glob('*-g10-3s-r*.json'))]
    if not rows:
        parser.error('No completed comparison measurements')
    lines = ['# Comparação dos laboratórios de campo', '',
        'Mesmos limites: worker 0,5 CPU/2 GiB; API 0,4 CPU/2 GiB; PostgreSQL 1 CPU/2 GiB; nginx 0,1 CPU/128 MiB.',
        'Pool 10, revisão 3s, 12 tenants, preferência de grupo 10, 10% marcando a cada 30s.',
        '65s preparação + 120s medição + 90s observação adicional. VUs de escrita separados representam ações dos mesmos usuários lógicos.', '',
        '| Usuários | Variante | Repetições | PASS | Snapshot p95 ms | Marcação p95 ms | Propagação p95 ms | Sentinela API p95 ms | Erros por início | CPU worker média % |',
        '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    for users in sorted({row['logicalUsers'] for row in rows}):
        for variant in ['nest', 'bun']:
            group = [row for row in rows if row['logicalUsers'] == users and row['variant'] == variant]
            if not group:
                continue
            worker = 'territory-field-labs-' + variant + '-1'
            lines.append('| ' + ' | '.join([str(users), variant, str(len(group)), str(sum(row['passed'] for row in group)),
                format_range([row['snapshotP95Ms'] for row in group]), format_range([row['markP95Ms'] for row in group]),
                format_range([row['propagation']['p95_ms'] for row in group if row['propagation']['p95_ms'] is not None]),
                format_range([row['principalSnapshotP95Ms'] for row in group]),
                format_range([100 * row['errorRateStartedInWindow'] for row in group], 2) + '%',
                format_range([row['cpuAveragePercent'][worker] for row in group if worker in row['cpuAveragePercent']]),
            ]) + ' |')
    lines += ['', 'Faixas são mínimo–máximo dos p95 de cada repetição, **não um p95 agregado**.',
        'CPU é percentual de um core: 50% aproxima o teto de 0,5 CPU do worker.', '', '## Integridade por ensaio', '',
        '| Ensaio | Prontos | ACK/previsto | Observados | Ausentes | Gerador válido | Infra válida | Steady funcional |',
        '|---|---:|---:|---:|---|---|---|---|']
    for row in rows:
        delivery = row['propagation']
        lines.append('| ' + ' | '.join([row['id'], str(row['ready']), f'{delivery["acknowledged_writes"]}/{row["logicalUsers"] // 10 * 4}',
            str(delivery['samples']), str(delivery['missing_sequences']), str(row['generatorValid']),
            str(row['infrastructureValid']), str(row['functionalSteadyPassed'])]) + ' |')
    lines += ['', '## Escopo e limitações', '',
        '- A carga é no fluxo HTTP completo, não somente três SELECTs ou montagem de snapshot.',
        '- PASS exige entrada p95 <=1s, marcação p95 <=500ms e propagação amostrada p95 <=5s, além de integridade/erros/agendamento.',
        '- Não houve escalada após um patamar com falhas. Falhar um patamar não demonstra incapacidade intrínseca do runtime/framework.',
        '- Propagação é o primeiro observador amostrado, não todas as telas; ausência de observação não prova perda de persistência.',
        '- Sentinela faz snapshot diretamente na API principal a cada pelo menos 5s; não representa todos os módulos administrativos.',
        '- Classificação de erros pelo início do request inclui respostas tardias. Snapshot inclui recomposição após erro.',
        '- CPU média somente na janela de medição. SQL total inclui preparação e drenagem.',
        '- Gerador no mesmo host, com orçamento separado; não é certificação de uma VPS física de dois cores.',
        '- Harness mudou (drenagem, agendamento e sentinela); não atribuir diferenças contra resultados históricos somente à stack.',
        '- Comparação Bun/pg versus Nest/Prisma altera runtime, HTTP e driver juntos.', '']
    target = args.directory / 'README.md'
    target.write_text('\n'.join(lines))
    print(target)


if __name__ == '__main__':
    main()
