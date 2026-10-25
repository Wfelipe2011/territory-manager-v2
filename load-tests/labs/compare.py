#!/usr/bin/env python3
"""Controlled, synthetic mixed-load comparison. No production access."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import statistics
import subprocess
import threading
import time
import urllib.request

import lab

L = Path(__file__).resolve().parent
W = L.parents[2]
spec = importlib.util.spec_from_file_location('matrix_metrics', L.parent / 'matrix.py')
metrics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metrics)


def db(sql):
    return lab.compose('exec', '-T', 'db', 'psql', '-U', 'load', '-d', 'territory_manager_peak_load',
                       '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql, stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE).stdout.strip()


def monitor(stop, samples, generator):
    tick = 0
    while not stop.is_set():
        try:
            # docker stats can discard the entire response when any requested
            # container does not exist (e.g. Bun before its very first launch).
            names = subprocess.check_output(['docker', 'ps', '--filter',
                'label=com.docker.compose.project=territory-field-labs', '--format', '{{.Names}}'], text=True).split()
            if not names:
                raise RuntimeError('No laboratory containers to monitor')
            result = subprocess.run(['docker', 'stats', '--no-stream', '--format', '{{json .}}', *names],
                                    text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            with urllib.request.urlopen('http://localhost:3400/healthz',timeout=3) as health:
                worker_stats=json.loads(health.read()).get('stats',{})
            pressure={}
            if tick%3==0:
                for service in ['bun','nest','db','api']:
                    if 'territory-field-labs-'+service+'-1' not in names: continue
                    pressure[service]=lab.compose('exec','-T',service,'cat','/sys/fs/cgroup/cpu.stat','/sys/fs/cgroup/memory.events',stdout=subprocess.PIPE,stderr=subprocess.DEVNULL).stdout
            tick+=1
            statement_totals=json.loads(db("SELECT json_build_object('calls',coalesce(sum(calls),0),'executionMs',coalesce(sum(total_exec_time),0)) FROM pg_stat_statements"))
            samples.append({'time': time.time(), 'hostMemoryAvailableKiB':int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))), 'workerStats':worker_stats, 'cgroups':pressure,'sqlTotals':statement_totals, 'hostLoad': os.getloadavg(),
                'containers': [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')],
                'database': json.loads(db("SELECT json_build_object('active',count(*) FILTER(WHERE state='active'),"
                    "'idleInTransaction',count(*) FILTER(WHERE state='idle in transaction'),'connections',count(*),"
                    "'lockWaits',count(*) FILTER(WHERE wait_event_type='Lock'),"
                    "'loadClients',(SELECT count(DISTINCT client_id) FROM field_session WHERE disconnected_at IS NULL AND last_seen_at>now()-interval '60 seconds' AND client_id~'^load-client-[0-9]{12}$'),"
                    "'loadTenants',(SELECT count(DISTINCT tenant_id) FROM field_session WHERE disconnected_at IS NULL AND last_seen_at>now()-interval '60 seconds' AND client_id~'^load-client-[0-9]{12}$')) FROM pg_stat_activity WHERE datname=current_database()"))})
        except Exception as error:
            samples.append({'time':time.time(),'error':type(error).__name__})
        stop.wait(4)


def warmup():
    blocks = json.loads((lab.RUNTIME / 'fixture-peak.json').read_text())['blocks']
    for i in range(48):
        block = blocks[i % 12]
        route = f'http://localhost:3400/v1/field/blocks/{block["blockId"]}/sync?clientId=warmup-client-00000001&tabId=warmup-tab-id-00000001'
        request = urllib.request.Request(route, headers={'Authorization': 'Bearer ' + block['token']})
        with urllib.request.urlopen(request, timeout=35) as response:
            if response.status != 200:
                raise RuntimeError('Warmup failed')
            response.read()
    time.sleep(2)
    db('TRUNCATE field_session; SELECT pg_stat_statements_reset();')


def trial(variant, users, repeat, out, pool=10, interval=3000, group=10, mode="baseline", idle=False, batch=False):
    lab.ENV.update(LAB_POOL_SIZE=str(pool), FIELD_POLL_CHECK_MS=str(interval), LAB_SNAPSHOT_MODE=mode, LAB_BATCH_VALIDATION=str(int(batch)))
    # Refuse a running generator, remove only a stopped orphan from a prior run.
    old = subprocess.run(['docker','inspect','territory-field-lab-generator','--format','{{.State.Running}}'],capture_output=True,text=True)
    if old.returncode == 0:
        if old.stdout.strip() == 'true': raise RuntimeError('A generator is already running')
        subprocess.run(['docker','rm','territory-field-lab-generator'],check=True,stdout=subprocess.DEVNULL)
    # A fresh worker/API process for each repetition; same warmup/data reset.
    lab.compose('stop', 'proxy', 'api', 'bun', 'nest')
    lab.up(variant)
    before = lab.state(variant)
    worker=next(item for item in before if item['service']==variant)
    reference=next(item for item in before if item['service']=='api')
    if worker.get('poolLimit',pool)!=pool or reference.get('poolLimit',10)!=10:
        raise RuntimeError('Worker/reference pools differ from experiment settings')
    subprocess.run(['docker','image','tag',worker['imageId'],'territory-field-lab-'+variant+':evidence-'+worker['imageId'].split(':')[1][:16]],check=True)
    db('UPDATE round SET completed=false,completed_date=NULL,update_date=NULL WHERE round_number=8 AND (completed OR completed_date IS NOT NULL); TRUNCATE field_session;')
    warmup()
    name = f'{variant}-{mode}{'-batch' if batch else ''}-p{pool}-{users}u-g{group}-{interval}ms-{"idle" if idle else "mixed"}-r{repeat}'
    log_path = lab.RUNTIME / (name + '.log')
    summary_path = lab.RUNTIME / 'load-summary.json'
    summary_path.unlink(missing_ok=True)
    generator = 'territory-field-lab-generator'
    args = lab.COMPOSE + ['run', '-T', '--no-deps', '--name', generator, '--user', f'{os.getuid()}:{os.getgid()}',
        '-e', f'USERS={users}', '-e', f'GROUP_SIZE={group}', '-e', f'IDLE_ONLY={int(idle)}', '-e', 'STAGED_READERS=1', '-e', 'FIXTURE_PATH=./.runtime/fixture-peak.json',
        'generator', 'run', '--quiet', '--log-format', 'raw', 'labs/load.js']
    print(name + ': starting 65s preparation + 120s measurement + 90s observer tail', flush=True)
    start = time.time()
    stop, samples = threading.Event(), []
    with log_path.open('w') as log:
        process = subprocess.Popen(args, env=lab.ENV, stdout=log, stderr=subprocess.STDOUT, text=True)
        thread = threading.Thread(target=monitor, args=(stop, samples, generator), daemon=True)
        thread.start()
        try:
            code = process.wait(timeout=400)
        except subprocess.TimeoutExpired:
            subprocess.run(['docker', 'stop', '-t', '5', generator], check=False)
            code = process.wait(timeout=30)
        finally:
            stop.set()
            thread.join(timeout=15)
    inspection = json.loads(subprocess.run(['docker', 'inspect', generator], check=True, text=True,
                                           stdout=subprocess.PIPE).stdout)[0]
    subprocess.run(['docker', 'rm', generator], check=True, stdout=subprocess.DEVNULL)
    after = lab.state(variant)
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else {}
    if not summary:
        raise RuntimeError('Generator produced no summary; inspect private log ' + str(log_path))
    delivery = metrics.propagation(log_path)
    window = next((json.loads(line.split('FIELD_EVENT ', 1)[1])['at'] for line in log_path.read_text().splitlines()
                   if 'FIELD_EVENT ' in line and '"event":"window"' in line), None)
    measured = [sample for sample in samples if window and window <= sample['time'] * 1000 < window + 120000]
    cpu = {}
    memory = {}
    for sample in measured:
        for container in sample.get('containers', []):
            key = container.get('Name', '')
            cpu.setdefault(key, []).append(float(container.get('CPUPerc', '0%').rstrip('%')))
            memory.setdefault(key, []).append(container.get('MemUsage'))
    metric = lambda name, key, default=0: metrics.metric(summary, name, key, default)
    infrastructure = all(item['running'] and not item['oom'] and item['restarts'] == 0 for item in after)
    generator_cpu = cpu.get(generator, [])
    monitoring_valid = bool(generator_cpu)
    generator_bound = bool(generator_cpu) and (statistics.mean(generator_cpu)>=90 or sum(v>=95 for v in generator_cpu)>max(2,len(generator_cpu)*.2))
    generator_valid = not inspection['State']['OOMKilled'] and inspection['State']['ExitCode'] not in [137,139] and monitoring_valid and not generator_bound
    functional = infrastructure and generator_valid and metric('initial_ready', 'count') == users and metric('started_in_window_errors', 'rate', 1) < .01 and metric('unexpected_errors', 'rate', 1) < .01 and metric('principal_snapshot_errors', 'rate', 1) < .01 and metric('dropped_iterations', 'count') == 0 and delivery['acknowledged_writes'] == (0 if idle else users // 10 * 4) and not delivery['missing_sequences'] and (idle or metric('writer_start_lateness_ms', 'p(95)', 1e9) <= 500)
    capacity_passed = functional and metric('snapshot_ms', 'p(95)', 1e9) <= 1000 and (idle or metric('mark_ms', 'p(95)', 1e9) <= 500) 
    passed = capacity_passed and (idle or (delivery['observer_p95_ms'] is not None and delivery['observer_p95_ms'] <= 5000))
    queries = json.loads(db("SELECT coalesce(json_agg(q),'[]'::json) FROM (SELECT query,calls,total_exec_time,mean_exec_time,rows FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 25) q"))
    result = {'id': name, 'variant': variant, 'logicalUsers': users, 'repeat': repeat, 'groupPreference': group, 'snapshotMode': mode, 'idleOnly': idle, 'batchValidation':batch,
        'checkIntervalMs': interval, 'poolSize': pool, 'measurementSeconds': 120, 'preparationSeconds': 65,
        'observerTailSeconds': 90, 'writerMaxDurationSeconds': 155, 'wallSeconds': time.time() - start,
        'windowStartMs': window, 'exitCode': code, 'passed': passed, 'capacityPassedWithoutPropagationGoal':capacity_passed, 'functionalSteadyPassed': functional,
        'generatorValid': generator_valid, 'generatorBound':generator_bound, 'monitoringValid': monitoring_valid, 'infrastructureValid': infrastructure,
        'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'ready': metric('initial_ready', 'count'), 'snapshotP95Ms': metric('snapshot_ms', 'p(95)'),
        'markP95Ms': metric('mark_ms', 'p(95)'), 'principalSnapshotP95Ms': metric('principal_snapshot_ms', 'p(95)'),
        'errorRateStartedInWindow': metric('started_in_window_errors', 'rate', 1), 'errorRateAllPhases': metric('unexpected_errors', 'rate', 1),
        'propagation': delivery, 'cpuAveragePercent': {key: statistics.mean(values) for key, values in cpu.items()},
        'cpuMaxPercent': {key: max(values) for key, values in cpu.items()}, 'sampledMemoryUsage': memory,
        'before': before, 'after': after, 'metrics': summary['metrics'], 'monitor': samples, 'topQueriesAllPhases': queries,
        'limitations': ['Shared host; generator has its own 1CPU/1GiB budget outside the 2CPU target stack.',
                        'Propagation measures sampled observers, not every screen.', 'SQL counters span preparation, measurement and drain.',
                        'Principal sentinel is a full snapshot directly on the synthetic API every >=5s, not an administrative workload.']}
    (out / (name + '.json')).write_text(json.dumps(result, indent=2) + '\n')
    with (lab.RUNTIME / (name + '-services.log')).open('w') as log:
        lab.compose('logs', '--no-color', variant, 'api', stdout=log, stderr=subprocess.STDOUT)
    print(json.dumps({key: result[key] for key in ['id', 'passed', 'ready', 'snapshotP95Ms', 'markP95Ms', 'principalSnapshotP95Ms', 'errorRateStartedInWindow', 'generatorValid']}), flush=True)
    print('propagation:', delivery['p95_ms'], 'ACK:', delivery['acknowledged_writes'], 'missing:', delivery['missing_sequences'], flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--users', default='150,300,1000')
    parser.add_argument('--repetitions', type=int, default=3)
    parser.add_argument('--variants', default='nest,bun')
    parser.add_argument('--repeat-start', type=int, default=1)
    args = parser.parse_args()
    variants = args.variants.split(',')
    if not variants or len(set(variants)) != len(variants) or any(value not in ['nest', 'bun'] for value in variants):
        parser.error('variants must be nest, bun, or nest,bun')
    if args.repetitions < 1 or args.repeat_start < 1:
        parser.error('repetitions and repeat-start must be positive')
    users = [int(value) for value in args.users.split(',')]
    if any(value < 120 or value % 10 for value in users):
        parser.error('Use synthetic peak cohorts >=120, multiples of ten')
    lab.RUNTIME.mkdir(mode=0o700, exist_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
    out = L / 'results' / ('comparison-' + stamp)
    out.mkdir(parents=True)
    root_command = ['docker', 'compose', '-f', str(W / 'docker-compose.yml')]
    running = subprocess.run(root_command + ['ps', '--services', '--status', 'running'], check=True, text=True, stdout=subprocess.PIPE).stdout.split()
    paused = [name for name in ['api', 'admin'] if name in running]
    with (L.parent / '.runtime/runner.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            if paused:
                subprocess.run(root_command + ['stop', *paused], check=True)
            all_results = []
            for count in users:
                stage = []
                for repeat in range(args.repeat_start, args.repeat_start + args.repetitions):
                    for variant in [value for value in (['nest', 'bun'] if repeat % 2 else ['bun', 'nest']) if value in variants]:
                        stage.append(trial(variant, count, repeat, out))
                        all_results = all_results + [stage[-1]]
                        (out / 'summary.json').write_text(json.dumps([{key: row[key] for key in ['id','variant','logicalUsers','repeat','passed','functionalSteadyPassed','snapshotP95Ms','markP95Ms','principalSnapshotP95Ms','errorRateStartedInWindow','propagation','cpuAveragePercent','generatorValid']} for row in all_results], indent=2) + '\n')
                if not all(row['passed'] for row in stage):
                    print(f'Stopping escalation: {count} users did not pass every repetition. Investigate before increasing.', flush=True)
                    break
        finally:
            lab.compose('down')
            if paused:
                subprocess.run(root_command + ['start', *paused], check=True)
            for service, url in [('api', 'http://localhost:3001/api'), ('admin', 'http://localhost:4800/login')]:
                if service in paused:
                    lab.wait(url)
                    print('Restored', url, flush=True)
            print('Evidence:', out, flush=True)


if __name__ == '__main__':
    main()
