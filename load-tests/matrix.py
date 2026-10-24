#!/usr/bin/env python3
"""Reproducible, local-only k6 matrix. Raw fixtures/logs stay in .runtime/."""
import argparse, csv, fcntl, json, os, pathlib, subprocess, threading, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parent
RUNTIME = ROOT / '.runtime'
RESULTS = ROOT / 'results'
BASE = ['docker', 'compose', '-f', str(ROOT / 'compose.yml')]
ENV = os.environ.copy()

def run(args, check=True, **kwargs):
    return subprocess.run(args, check=check, text=True, **kwargs)

def compose(*args, **kwargs):
    return run(BASE + list(args), env=ENV, **kwargs)

def capture(args):
    return run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.strip()

def db(sql):
    return compose('exec','-T','db','psql','-U','load','-d','territory_manager_load','-At','-v','ON_ERROR_STOP=1','-c',sql, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.strip()

def state():
    ids=compose('ps','-a','-q',stdout=subprocess.PIPE).stdout.split()
    if not ids:return []
    raw=json.loads(capture(['docker','inspect',*ids]))
    return [{'service':c['Config']['Labels'].get('com.docker.compose.service'), 'id':c['Id'][:12], 'image':c['Image'],
      'cpu':c['HostConfig']['NanoCpus']/1e9,'memory':c['HostConfig']['Memory'], 'oom':c['State']['OOMKilled'],
      'restarts':c['RestartCount'],'running':c['State']['Running']} for c in raw if c['Config']['Labels'].get('com.docker.compose.service') in ['api1','api2','admin','db','proxy']]

def wait_http():
    for _ in range(120):
        try:
            with urllib.request.urlopen('http://localhost:3301/api', timeout=2) as res:
                if res.status==200:return
        except Exception:time.sleep(1)
    raise RuntimeError('Load API did not start')

def interval(seconds):
    ENV['FIELD_POLL_CHECK_MS']=str(seconds*1000)
    compose('up','-d','--no-build','--pull','never','api1','api2','admin','proxy', stdout=subprocess.DEVNULL)
    # Recreated API addresses require a fresh proxy DNS resolution.
    compose('restart','proxy', stdout=subprocess.DEVNULL)
    wait_http()

def prepare():
    compose('up','-d','--wait','db')
    compose('run','--rm','-T','--entrypoint','npx','api1','prisma','migrate','deploy')
    if not (RUNTIME/'fixture.json').exists():
        compose('run','--rm','-T','--user',f'{os.getuid()}:{os.getgid()}', '-v',f'{RUNTIME}:/output','--entrypoint','node','api1','/load/seed.cjs')
    interval(3)
    limits={s['service']:(s['cpu'],s['memory']) for s in state()}
    expected={'api1':(1,512*1024**2),'api2':(1,512*1024**2),'admin':(.5,512*1024**2),'db':(1,1024**3),'proxy':(.25,128*1024**2)}
    if any(limits.get(name)!=limit for name,limit in expected.items()):raise RuntimeError(f'Unexpected limits: {limits}')

def sample(stop, samples):
    while not stop.is_set():
        try:
            names=[f'territory-load-{name}-1' for name in ['api1','api2','admin','db','proxy']]+['territory-load-generator']
            res=run(['docker','stats','--no-stream','--format','{{json .}}',*names],check=False,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
            stats=[json.loads(line) for line in res.stdout.splitlines() if line.startswith('{')]
            samples.append({'time':time.time(),'containers':stats,'db':db("SELECT json_build_object('connections',numbackends,'commits',xact_commit,'rollbacks',xact_rollback,'disk_reads',blks_read,'cache_hits',blks_hit) FROM pg_stat_database WHERE datname=current_database()"),'queries':db('SELECT json_build_object(\'calls\',sum(calls),\'exec_ms\',sum(total_exec_time)) FROM pg_stat_statements')})
        except Exception as e:samples.append({'time':time.time(),'monitor_error':type(e).__name__})
        stop.wait(5)

def metric(summary, name, key, default=0):
    return summary.get('metrics',{}).get(name,{}).get('values',{}).get(key,default)

def trial(label, seconds, profile, users, duration, kind='step', workload='mixed'):
    trial_id=f'{label}-{seconds}s-{profile}-{users}u-{kind}'
    target=RESULTS/label
    target.mkdir(parents=True,exist_ok=True)
    path=target/f'{trial_id}.json'
    if path.exists():return json.loads(path.read_text())
    db("UPDATE round SET completed=false,completed_date=NULL,update_date=NULL WHERE round_number=8 AND (completed OR completed_date IS NOT NULL); TRUNCATE field_session; SELECT pg_stat_statements_reset();")
    before=state(); samples=[];stop=threading.Event()
    summary_path=RUNTIME/'summary.json'
    summary_path.unlink(missing_ok=True)
    run(['docker','rm','-f','territory-load-generator'],check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    api_id=compose('ps','-q','api1',stdout=subprocess.PIPE).stdout.strip()
    ip=capture(['docker','inspect','-f','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',api_id])
    args=BASE+['run','-T','--name','territory-load-generator','--user',f'{os.getuid()}:{os.getgid()}',
      '-e',f'USERS={users}','-e',f'DURATION={duration}s','-e',f'PROFILE={profile}','-e',f'WORKLOAD={workload}',
      '-e',f'API1_ADDRESS={ip}:3000','k6','run','--quiet','main.js']
    print(f'{trial_id}: {duration}s',flush=True)
    started=time.time()
    with (RUNTIME/f'{trial_id}.log').open('w') as log:
        proc=subprocess.Popen(args,env=ENV,stdout=log,stderr=subprocess.STDOUT,text=True)
        thread=threading.Thread(target=sample,args=(stop,samples),daemon=True);thread.start()
        code=proc.wait()
        stop.set();thread.join(timeout=15)
    generator=json.loads(capture(['docker','inspect','territory-load-generator']))[0]
    after=state()
    summary=json.loads(summary_path.read_text()) if summary_path.exists() else {}
    threshold_ok=bool(summary) and all(t.get('ok',False) for m in summary.get('metrics',{}).values() for t in m.get('thresholds',{}).values())
    infrastructure_ok=all(s['running'] and not s['oom'] and s['restarts']==next((b['restarts'] for b in before if b['service']==s['service']),-1) for s in after)
    generator_ok=not generator['State']['OOMKilled'] and generator['State']['ExitCode'] not in (137,139)
    cpus={}
    for observation in samples:
        for c in observation.get('containers',[]):
            name=c.get('Name',''); cpus.setdefault(name,[]).append(float(c.get('CPUPerc','0%').rstrip('%')))
    data={'id':trial_id,'label':label,'interval_seconds':seconds,'profile':profile,'logical_users':users,'duration_seconds':duration,
      'kind':kind,'workload':workload,'wall_seconds':round(time.time()-started,2),'exit_code':code,
      'passed':code==0 and threshold_ok and infrastructure_ok and generator_ok,'generator_valid':generator_ok,'infrastructure_valid':infrastructure_ok,
      'snapshot_p95_ms':metric(summary,'snapshot_ms','p(95)'), 'mark_p95_ms':metric(summary,'mark_ms','p(95)'),
      'propagation_p95_ms':metric(summary,'propagation_ms','p(95)'), 'propagation_samples':metric(summary,'propagation_samples','count'),
      'error_rate':metric(summary,'unexpected_errors','rate',1), 'dropped_iterations':metric(summary,'dropped_iterations','count'),
      'page_p95_ms':metric(summary,'page_ms','p(95)'), 'page_bytes_avg':metric(summary,'page_bytes','avg'),
      'cpu_avg_percent':{name:round(sum(v)/len(v),2) for name,v in cpus.items() if v},
      'resources_before':before,'resources_after':after,'generator':{'cpu':generator['HostConfig']['NanoCpus']/1e9,'memory':generator['HostConfig']['Memory'],'oom':generator['State']['OOMKilled']},
      'metrics':summary.get('metrics',{}),'monitor':samples,
      'api_commit':capture(['git','-C',str(ROOT.parent),'rev-parse','HEAD']),
      'admin_commit':capture(['git','-C',str(ROOT.parent.parent/'admin-territory-manager'),'rev-parse','HEAD'])}
    path.write_text(json.dumps(data,indent=2)+'\n')
    run(['docker','rm','territory-load-generator'],stdout=subprocess.DEVNULL)
    print(f"  {'PASS' if data['passed'] else 'FAIL'} snapshot={data['snapshot_p95_ms']:.1f}ms mark={data['mark_p95_ms']:.1f}ms propagation={data['propagation_p95_ms']:.1f}ms errors={data['error_rate']:.3%}",flush=True)
    return data

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['prepare','smoke','matrix','repeat','down'])
    parser.add_argument('--label',default=os.getenv('LOAD_VARIANT','baseline'))
    parser.add_argument('--intervals',default='3,5,10,15,20,25')
    parser.add_argument('--profiles',default='distributed,hotspot')
    parser.add_argument('--users',default='10,25,50,100,200,400,800,1600')
    parser.add_argument('--step-seconds',type=int,default=120)
    parser.add_argument('--stable-seconds',type=int,default=600)
    parser.add_argument('--repetitions',type=int,default=3)
    args=parser.parse_args();os.chdir(ROOT)
    ENV['LOAD_VARIANT']=os.getenv('LOAD_VARIANT', 'baseline' if args.command=='smoke' else args.label)
    RUNTIME.mkdir(mode=0o700,exist_ok=True);RESULTS.mkdir(exist_ok=True)
    lock=(RUNTIME/'runner.lock').open('w')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    if args.command=='down':compose('down');return
    if args.command=='prepare':prepare();return
    if not (RUNTIME/'fixture.json').exists():raise RuntimeError('Run prepare first')
    if args.command=='smoke':
        interval(3);trial(args.label,3,'distributed',2,15,'smoke');return
    for seconds in map(int,args.intervals.split(',')):
        if seconds not in [3,5,10,15,20,25]:raise ValueError('Unexpected interval')
        interval(seconds)
        for profile in args.profiles.split(','):
            if profile not in ['distributed','hotspot']:raise ValueError('Unexpected profile')
            if args.command=='repeat':
                users=int(args.users)
                for n in range(args.repetitions):trial(args.label,seconds,profile,users,args.step_seconds,f'repeat{n+1}')
                continue
            last=0;first_failed=None;generator_limited=False
            for users in map(int,args.users.split(',')):
                result=trial(args.label,seconds,profile,users,args.step_seconds)
                if not result['generator_valid']:generator_limited=True;break
                if not result['passed']:first_failed=users;break
                last=users
            if first_failed:
                low,high=last,first_failed
                for _ in range(2):
                    middle=(low+high)//2
                    if middle<=low:break
                    result=trial(args.label,seconds,profile,middle,args.step_seconds,'refine')
                    if result['passed']:low=middle
                    else:high=middle
                last=low
            if last:
                stable=trial(args.label,seconds,profile,last,args.stable_seconds,'stable')
                if not stable['passed']:last=0
                trial(args.label,seconds,profile,max(1,last),args.step_seconds,'idle','idle')
            print(json.dumps({'interval':seconds,'profile':profile,'confirmed_users':last,'generator_limited':generator_limited,'upper_failure':first_failed}),flush=True)
    rows=[]
    for path in (RESULTS/args.label).glob('*.json'):
        data=json.loads(path.read_text());rows.append({k:data[k] for k in ['id','interval_seconds','profile','logical_users','duration_seconds','passed','generator_valid','snapshot_p95_ms','mark_p95_ms','propagation_p95_ms','error_rate','page_p95_ms']})
    if rows:
        with (RESULTS/args.label/'summary.csv').open('w') as file:
            writer=csv.DictWriter(file,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)

if __name__=='__main__':main()
