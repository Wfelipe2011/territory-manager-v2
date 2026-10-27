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
    workload = parser.add_mutually_exclusive_group()
    workload.add_argument('--load-300', action='store_true', help='Compatibility alias for --load-users 300')
    workload.add_argument('--load-users', type=int, help='One synthetic 120s measurement after mandatory parity; not a maximum-capacity search')
    parser.add_argument('--check-ms', type=int, default=1000)
    parser.add_argument('--experiment', choices=['baseline', 'grouped', 'notify', 'reference', 'expanded', 'sql', 'readmodel'], default='baseline')
    parser.add_argument('--candidate', choices=['control','copies','roundtrips','native','cpu'])
    parser.add_argument('--cpu-profile-dir', type=Path, help='Separate diagnostic run, never comparable with unprofiled trials')
    parser.add_argument('--observer-tail', type=int, choices=[30,90], default=90)
    args = parser.parse_args()
    users = 300 if args.load_300 else args.load_users
    if args.candidate and args.experiment != 'baseline':
        parser.error('Candidates must start from the promoted baseline')
    if args.cpu_profile_dir and not args.candidate:
        parser.error('CPU profiling requires an isolated candidate')
    if users is not None and (users < 120 or users % 10):
        parser.error('Use at least 120 logical users in multiples of ten')
    if not 100 <= args.check_ms <= 25000:
        parser.error('check-ms must be between 100 and 25000')
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
                   LAB_SNAPSHOT_MODE='aggregate', LAB_BATCH_VALIDATION='1', FIELD_POLL_CHECK_MS=str(args.check_ms),LAB_OBSERVER_TAIL=str(args.observer_tail))
    lab.ENV['FIELD_PROXY_TEMPLATE'] = str(WORKSPACE / 'dev/nginx-api.conf.template')
    lab.COMPOSE[4:4] = ['-f', str(Path(__file__).with_name('compose.verify.yml'))]
    if args.candidate:
        lab.ENV.update(FIELD_CANDIDATE=args.candidate,CANDIDATE_WORKER_CPU='0.7' if args.candidate=='cpu' else '0.5',CANDIDATE_DB_CPU='0.8' if args.candidate=='cpu' else '1.0')
        lab.COMPOSE[6:6] = ['-f', str(API / 'field-worker/experiments/candidates.compose.yml')]
        if args.cpu_profile_dir:
            profile_dir = args.cpu_profile_dir.resolve()
            if not profile_dir.is_relative_to(API / 'field-worker/results'):
                parser.error('Profiles must remain under field-worker/results')
            profile_dir.mkdir(parents=True,exist_ok=True)
            lab.ENV['CANDIDATE_PROFILE_DIR'] = str(profile_dir)
            lab.COMPOSE[8:8] = ['-f', str(API / 'field-worker/experiments/profile.compose.yml')]
    if args.experiment != 'baseline':
        lab.ENV['FIELD_EXPERIMENT'] = args.experiment
        if args.experiment in ['reference', 'expanded', 'sql', 'readmodel']:
            lab.ENV['FIELD_EXPERIMENT_ENTRY'] = '/app/field-worker/experiments/advanced-bootstrap.cjs'
        lab.COMPOSE[6:6] = ['-f', str(API / 'field-worker/experiments/compose.yml')]
    original_up = lab.up
    cleanup_sql = ('DROP TRIGGER IF EXISTS field_experiment_notify ON field_revision; DROP FUNCTION IF EXISTS field_experiment_notify(); '
                   'DROP FUNCTION IF EXISTS field_experiment_store(integer,integer,integer,integer,text,jsonb); DROP TABLE IF EXISTS field_experiment_read_model;')
    def up(variant):
        lab.compose('up', '-d', '--wait', 'db')
        if compare.db('SELECT current_database()') != 'territory_manager_peak_load':
            raise RuntimeError('Refusing read-model setup outside the synthetic database')
        compare.db((API / 'prisma/migrations/20261025190000_field_read_model/migration.sql').read_text())
        if compare.db("SELECT to_regclass('public.block_signature') IS NOT NULL") != 't':
            compare.db((API / 'prisma/migrations/20261027130000_block_signatures_per_round/migration.sql').read_text())
        compare.db('TRUNCATE field_read_model;')
        try:
            original_up(variant)
        except Exception:
            with (lab.RUNTIME / 'experiment-startup.log').open('w') as log:
                lab.compose('logs', '--no-color', 'bun', 'api', stdout=log, stderr=subprocess.STDOUT)
            raise
        if compare.db('SELECT current_database()') != 'territory_manager_peak_load':
            raise RuntimeError('Refusing notification DDL outside the synthetic database')
        compare.db(cleanup_sql)
        if args.experiment == 'readmodel':
            compare.db((API / 'field-worker/experiments/read-model.sql').read_text())
        if args.experiment in ['notify', 'readmodel']:
            compare.db((API / 'field-worker/experiments/notify.sql').read_text())
        if args.experiment in ['sql', 'readmodel']:
            plans = lab.compose('exec', '-T', 'bun', 'bun', '/app/field-worker/experiments/explain.cjs', stdout=subprocess.PIPE).stdout
            (results / 'query-plans.json').write_text(json.dumps(json.loads(plans), indent=2) + '\n')
        if args.experiment == 'baseline':
            checked = lab.compose('exec', '-T', 'bun', 'bun', '/app/field-worker/tests/read-model.integration.cjs', stdout=subprocess.PIPE).stdout
            (results / 'read-model-integration.json').write_text(json.dumps(json.loads(checked), indent=2) + '\n')
        if args.candidate == 'native':
            checked = lab.compose('exec', '-T', 'bun', 'bun', '/app/field-worker/tests/native.integration.cjs', stdout=subprocess.PIPE).stdout
            (results / 'native-integration.json').write_text(json.dumps(json.loads(checked), indent=2) + '\n')
    lab.up = up
    original_warmup = compare.warmup
    def clean_warmup():
        # Called after compare.trial resets the business fixture. Raw catalog starts
        # empty every trial; persisted revisions need not have identical numbers.
        if compare.db('SELECT current_database()') != 'territory_manager_peak_load':
            raise RuntimeError('Synthetic database required')
        compare.db('TRUNCATE field_read_model;')
        original_warmup()
    if args.candidate:
        compare.warmup = clean_warmup
    command = ['docker', 'compose', '-f', str(WORKSPACE / 'docker-compose.yml')]
    results = API / 'field-worker/results' / ('integration-' + time.strftime('%Y%m%d-%H%M%S', time.gmtime()))
    results.mkdir(parents=True)
    paused = []
    summary = {'imageId': image_id, 'image': frozen, 'scope': 'local integration; synthetic data only',
               'loadRequested': users is not None, 'logicalUsers': users, 'checkIntervalMs': args.check_ms,
                 'experiment': args.experiment, 'dedicatedListenerExpected': int(args.experiment in ['baseline', 'notify', 'readmodel'])}
    summary['candidate'] = args.candidate
    summary['profiled'] = bool(args.cpu_profile_dir)
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
            if users is not None:
                running = subprocess.check_output(command + ['ps', '--services', '--status', 'running'], text=True).split()
                paused = [service for service in ['admin', 'proxy', 'field-worker', 'api'] if service in running]
                if paused:
                    subprocess.run(command + ['stop', *paused], check=True)
                row = compare.trial('bun', users, 1, results, pool=2, interval=args.check_ms, group=10, mode='aggregate', batch=True)
                summary['loadPassed'] = row['passed']
                if args.experiment == 'baseline':
                    samples = [s['workerStats'] for s in row['monitor'] if s.get('workerStats', {}).get('readModel')]
                    if not samples or not samples[-1]['readModel']['hits'] or not samples[-1]['notifications']['notifications']:
                        raise RuntimeError('Promoted read model / notifications did not execute')
                    summary['workerStats'] = samples[-1]
                    if args.candidate and samples[-1].get('candidate',{}).get('variant') != args.candidate:
                        raise RuntimeError('Candidate identity/instrumentation mismatch')
                    summary['readModelHealthy'] = not any(samples[-1]['readModel'][key] for key in ['storeFailures','backgroundFailures','pruneFailures'])
                    if not summary['readModelHealthy']:
                        raise RuntimeError('Derived-data maintenance failed; investigate before promoting the image')
                if args.experiment != 'baseline':
                    samples = [s['workerStats']['experiment'] for s in row['monitor'] if s.get('workerStats', {}).get('experiment')]
                    if not samples or (args.experiment != 'reference' and not samples[-1]['grouping']['eligible']):
                        raise RuntimeError('Grouping instrumentation did not execute')
                    summary['experimentStats'] = samples[-1]
                    if args.experiment in ['notify', 'readmodel'] and not samples[-1]['notifications']['notifications']:
                        raise RuntimeError('LISTEN/NOTIFY did not execute')
                    if args.experiment == 'readmodel' and (not samples[-1]['readModel']['hits'] or not samples[-1]['readModel']['background']):
                        raise RuntimeError('Read model was not reused/refreshed by notifications')
                if not row['generatorValid'] or not row['infrastructureValid'] or not row['monitoringValid']:
                    raise RuntimeError('Invalid measurement; do not interpret as service capacity')
        finally:
            try:
                if users is not None:
                    # This name belongs to this locked runner; never remove volumes.
                    subprocess.run(['docker', 'rm', '-f', 'territory-field-lab-generator'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                try:
                    compare.db(cleanup_sql)
                except Exception:
                    print('Notification-trigger cleanup unavailable; next startup always removes the lab-only trigger', flush=True)
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
    if users is not None and not summary.get('loadPassed'):
        raise SystemExit(f'{users}-user trial did not pass all goals; inspect evidence before increasing load')


if __name__ == '__main__':
    main()
