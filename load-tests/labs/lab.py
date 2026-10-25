#!/usr/bin/env python3
"""Local synthetic labs only. Never stops/changes the workspace's normal stack."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / '.runtime'
COMPOSE = ['docker', 'compose', '-f', str(ROOT / 'compose.yml'),
           '--profile', 'bun', '--profile', 'nest', '--profile', 'tools']
ENV = os.environ.copy()


def compose(*args, **kwargs):
    return subprocess.run(COMPOSE + list(args), env=ENV, check=True, text=True, **kwargs)


def wait(url):
    for _ in range(120):
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(1)
    raise RuntimeError('Service did not become ready: ' + url)


def state(variant):
    ids = compose('ps', '-q', stdout=subprocess.PIPE).stdout.split()
    containers = json.loads(subprocess.run(['docker', 'inspect', *ids], check=True,
                                          text=True, stdout=subprocess.PIPE).stdout)
    result = [{
        'service': item['Config']['Labels']['com.docker.compose.service'],
        'imageId': item['Image'], 'cpuLimit': item['HostConfig']['NanoCpus'] / 1e9,
        'memoryLimit': item['HostConfig']['Memory'], 'oom': item['State']['OOMKilled'],
        'restarts': item['RestartCount'], 'running': item['State']['Running'],
    } for item in containers]
    expected = {'db': (1, 2 * 1024**3), 'api': (.4, 2 * 1024**3),
                variant: (.5, 2 * 1024**3), 'proxy': (.1, 128 * 1024**2)}
    actual = {item['service']: (item['cpuLimit'], item['memoryLimit']) for item in result}
    if actual != expected or any(item['oom'] or item['restarts'] for item in result):
        raise RuntimeError('Unexpected active containers, limits, OOM or restarts: ' + str(result))
    return result


def prepare():
    compose('build', 'bun', 'nest')
    compose('stop', 'proxy', 'bun', 'nest', 'api')
    compose('up', '-d', '--wait', 'db')
    compose('run', '--rm', '--no-deps', '-T', '--entrypoint', 'npx', 'tools', 'prisma', 'migrate', 'deploy')
    compose('run', '--rm', '--no-deps', '-T', '--user', f'{os.getuid()}:{os.getgid()}', 'tools', '/load/seed-peak.cjs')
    compose('run', '--rm', '--no-deps', '-T', 'tools', '/load/normalize-peak.cjs')
    counts = compose('exec', '-T', 'db', 'psql', '-U', 'load', '-d', 'territory_manager_peak_load', '-Atc',
                     "SELECT json_build_object('tenants',(SELECT count(*) FROM multi_tenancy),"
                     "'houses',(SELECT count(*) FROM house),'rounds',(SELECT count(*) FROM round))",
                     stdout=subprocess.PIPE).stdout
    if json.loads(counts) != {'tenants': 12, 'houses': 60000, 'rounds': 480000}:
        raise RuntimeError('Unexpected synthetic dataset')
    print('Prepared: 12 synthetic tenants, 400 blocks, 60000 houses, 480000 rounds.')


def up(variant):
    if not (RUNTIME / 'fixture-peak.json').exists():
        raise RuntimeError('Run prepare first')
    ENV['SNAPSHOT_UPSTREAM'] = f'{variant}:{3402 if variant == "bun" else 3403}'
    compose('build', variant)
    compose('stop', 'proxy', 'nest' if variant == 'bun' else 'bun')
    compose('up', '-d', '--wait', 'db', 'api', variant)
    wait('http://localhost:3401/api')
    compose('up', '-d', '--force-recreate', 'proxy')
    wait('http://localhost:3400/healthz')
    print(f'{variant}: proxy http://localhost:3400; synthetic reference API http://localhost:3401')


def test(variants=("nest","bun")):
    reports = []
    try:
        for variant in variants:
            up(variant)
            before = state(variant)
            filename = f'equivalence-{variant}.json'
            compose('run', '--rm', '--no-deps', '-T', '--user', f'{os.getuid()}:{os.getgid()}',
                    '-e', f'LAB_VARIANT={variant}', 'tools', '/app/labs/tests/parity.cjs')
            report = json.loads((RUNTIME / filename).read_text())
            report['containersBefore'] = before
            report['containersAfter'] = state(variant)
            reports.append(report)
        if len(reports)>1 and reports[0]['source'] != reports[1]['source']:
            raise RuntimeError('Variants do not use identical compiled domain sources')
        result = ROOT / 'results'
        result.mkdir(exist_ok=True)
        stamp = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
        images = compose('images', '--format', 'json', stdout=subprocess.PIPE).stdout
        (result / f'equivalence-{stamp}.json').write_text(json.dumps({
            'scope': 'functional equivalence, NOT capacity certification',
            'reports': reports, 'images': images, 'snapshotMode': ENV.get('LAB_SNAPSHOT_MODE','baseline'),
        }, indent=2) + '\n')
        print('Both variants matched the original API; sanitized evidence saved in labs/results/.')
    finally:
        compose('down')  # Deliberately no -v: retain synthetic data, never touch normal stack.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'up', 'test', 'down', 'status'])
    parser.add_argument('variant', nargs='?', choices=['bun', 'nest'])
    args = parser.parse_args()
    RUNTIME.mkdir(mode=0o700, exist_ok=True)
    lock_dir = ROOT.parent / '.runtime'
    lock_dir.mkdir(mode=0o700, exist_ok=True)
    with (lock_dir / 'runner.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'prepare':
            prepare()
        elif args.action == 'up':
            if not args.variant:
                parser.error('up requires bun or nest')
            up(args.variant)
        elif args.action == 'test':
            test([args.variant] if args.variant else ['nest','bun'])
        elif args.action == 'down':
            compose('down')
        else:
            compose('ps', '-a')


if __name__ == '__main__':
    main()
