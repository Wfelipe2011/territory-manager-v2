#!/usr/bin/env python3
"""Verify the promoted image using ONLY the retained synthetic laboratory DB."""
import argparse
import fcntl
import json
from pathlib import Path
import subprocess
import sys
import time

API = Path(__file__).resolve().parents[2]
WORKSPACE = API.parent
sys.path.insert(0, str(API / 'load-tests/labs'))
import lab
import compare


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', default='territorio_digital-field-worker')
    parser.add_argument('--load-300', action='store_true', help='One 120s measurement after mandatory parity; not a maximum-capacity search')
    args = parser.parse_args()
    if not (lab.RUNTIME / 'fixture-peak.json').exists():
        parser.error('Prepare the synthetic laboratory first; never substitute the restored database')
    inspect = subprocess.run(['docker', 'inspect', 'territory-field-lab-generator', '--format', '{{.State.Running}}'], capture_output=True, text=True)
    if inspect.returncode == 0 and inspect.stdout.strip() == 'true':
        parser.error('Another generator is running')
    image_id = subprocess.check_output(['docker', 'image', 'inspect', args.image, '--format', '{{.Id}}'], text=True).strip()
    # Freeze the exact promoted image even if the ordinary local tag is rebuilt.
    frozen = 'territory-field-worker:verify-' + image_id.split(':')[1][:16]
    subprocess.run(['docker', 'image', 'tag', image_id, frozen], check=True)
    lab.ENV.update(LAB_BUN_IMAGE=frozen, LAB_SKIP_BUILD='1', LAB_POOL_SIZE='2',
                   LAB_SNAPSHOT_MODE='aggregate', LAB_BATCH_VALIDATION='1', FIELD_POLL_CHECK_MS='3000')
    lab.ENV['FIELD_PROXY_TEMPLATE'] = str(WORKSPACE / 'dev/nginx-api.conf.template')
    lab.COMPOSE[4:4] = ['-f', str(Path(__file__).with_name('compose.verify.yml'))]
    command = ['docker', 'compose', '-f', str(WORKSPACE / 'docker-compose.yml')]
    results = API / 'field-worker/results' / ('integration-' + time.strftime('%Y%m%d-%H%M%S', time.gmtime()))
    results.mkdir(parents=True)
    paused = []
    summary = {'imageId': image_id, 'image': frozen, 'scope': 'local integration; synthetic data only', 'loadRequested': args.load_300}
    lab.RUNTIME.mkdir(mode=0o700, exist_ok=True)
    lockdir = API / 'load-tests/.runtime'
    lockdir.mkdir(mode=0o700, exist_ok=True)
    with (lockdir / 'runner.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            prior = set((lab.ROOT / 'results').glob('equivalence-*.json'))
            lab.test(['bun'])
            new = set((lab.ROOT / 'results').glob('equivalence-*.json')) - prior
            if len(new) != 1:
                raise RuntimeError('Missing uniquely identified parity evidence')
            parity = json.loads(next(iter(new)).read_text())
            (results / 'equivalence.json').write_text(json.dumps(parity, indent=2) + '\n')
            summary['equivalencePassed'] = True
            if args.load_300:
                running = subprocess.check_output(command + ['ps', '--services', '--status', 'running'], text=True).split()
                paused = [service for service in ['admin', 'proxy', 'field-worker', 'api'] if service in running]
                if paused:
                    subprocess.run(command + ['stop', *paused], check=True)
                row = compare.trial('bun', 300, 1, results, pool=2, interval=3000, group=10, mode='aggregate', batch=True)
                summary['loadPassed'] = row['passed']
                if not row['generatorValid'] or not row['infrastructureValid'] or not row['monitoringValid']:
                    raise RuntimeError('Invalid measurement; do not interpret as service capacity')
        finally:
            try:
                if args.load_300:
                    # This name belongs to this locked runner; never remove volumes.
                    subprocess.run(['docker', 'rm', '-f', 'territory-field-lab-generator'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                lab.compose('down')
                if paused:
                    summary['normalStackRestored'] = False
                    subprocess.run(command + ['up', '-d', '--no-build', '--wait', *paused], check=True)
                    for service, url in [('api', 'http://localhost:3001/api'), ('admin', 'http://localhost:4800/login')]:
                        if service == 'api' or 'admin' in paused:
                            lab.wait(url)
                    summary['normalStackRestored'] = True
            finally:
                (results / 'verification.json').write_text(json.dumps(summary, indent=2) + '\n')
                print('Evidence:', results, flush=True)
    if args.load_300 and not summary.get('loadPassed'):
        raise SystemExit('300-user trial did not pass all goals; inspect evidence before increasing load')


if __name__ == '__main__':
    main()
