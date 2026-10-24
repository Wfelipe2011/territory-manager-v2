#!/usr/bin/env python3
"""Reproducible, local-only k6 matrix. Raw fixtures/logs stay in .runtime/."""
import argparse, csv, fcntl, json, os, pathlib, subprocess, threading, time, urllib.request, statistics
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
    counts=json.loads(db("SELECT json_build_object('houses',(SELECT count(*) FROM house),'rounds',(SELECT count(*) FROM round))"))
    if counts!={'houses':60000,'rounds':480000}:raise RuntimeError(f'Unexpected synthetic database: {counts}')
    db('ANALYZE house; ANALYZE round; ANALYZE territory_block; ANALYZE territory_block_address;')
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
            samples.append({'time':time.time(),'host_load':os.getloadavg(),'host_memory':dict(line.split(':',1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines() if line.startswith(('MemAvailable:','MemTotal:'))),'containers':stats,'db':db("SELECT json_build_object('connections',numbackends,'commits',xact_commit,'rollbacks',xact_rollback,'disk_reads',blks_read,'cache_hits',blks_hit) FROM pg_stat_database WHERE datname=current_database()"),'queries':db('SELECT json_build_object(\'calls\',sum(calls),\'exec_ms\',sum(total_exec_time)) FROM pg_stat_statements')})
        except Exception as e:samples.append({'time':time.time(),'monitor_error':type(e).__name__})
        stop.wait(5)

def metric(summary, name, key, default=0):
    return summary.get('metrics',{}).get(name,{}).get('values',{}).get(key,default)

def percentile(values, fraction=.95):
    if not values:return None
    v=sorted(values);pos=(len(v)-1)*fraction;lo=int(pos);hi=min(lo+1,len(v)-1)
    return v[lo]+(v[hi]-v[lo])*(pos-lo)

def propagation(log_path):
    events=[]
    for line in log_path.read_text().splitlines():
        if 'FIELD_EVENT ' in line:
            try:events.append(json.loads(line.split('FIELD_EVENT ',1)[1]))
            except ValueError:pass
    writes=sorted((e for e in events if e['event']=='ack'),key=lambda e:e['started'])
    seen=[e for e in events if e['event']=='seen']
    for e in events:
        if e['event']=='initial':seen.extend({'house':h,'status':status,'at':e['at'],'observer':e['observer']} for h,status in e['states'])
    latencies=[];missing=[]
    for i,w in enumerate(writes):
        following=next((n['started'] for n in writes[i+1:] if n['house']==w['house']),float('inf'))
        matches=[e for e in seen if e['house']==w['house'] and e['status']==w['status'] and e['observer']!=w['owner'] and w['started']<=e['at']<following]
        if matches:latencies.append(max(0,min(e['at'] for e in matches)-w['at']))
        else:missing.append(w['sequence'])
    return {'p95_ms':percentile(latencies),'samples':len(latencies),'acknowledged_writes':len(writes),'missing_sequences':missing,'latencies_ms':latencies}

def trial(label, seconds, profile, users, duration, kind='step', workload='mixed'):
    trial_id=f'{label}-{seconds}s-{profile}-{users}u-{kind}'
    target=RESULTS/label
    target.mkdir(parents=True,exist_ok=True)
    path=target/f'{trial_id}.json'
    if path.exists():return json.loads(path.read_text())
    db("UPDATE round SET completed=false,completed_date=NULL,update_date=NULL WHERE round_number=8 AND (completed OR completed_date IS NOT NULL); TRUNCATE field_session; SELECT pg_stat_statements_reset();")
    if not all(s['running'] for s in state()):interval(seconds)
    before=state(); samples=[];stop=threading.Event()
    summary_path=RUNTIME/'summary.json'
    summary_path.unlink(missing_ok=True)
    run(['docker','rm','-f','territory-load-generator'],check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    api_id=compose('ps','-q','api1',stdout=subprocess.PIPE).stdout.strip()
    ip=capture(['docker','inspect','-f','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',api_id])
    args=BASE+['run','-T','--name','territory-load-generator','--user',f'{os.getuid()}:{os.getgid()}',
      '-e',f'USERS={users}','-e',f'DURATION={duration}s','-e',f'PROFILE={profile}','-e',f'WORKLOAD={workload}',
      '-e',f'API1_ADDRESS={ip}:3000','k6','run','--quiet','--log-format','raw','main.js']
    print(f'{trial_id}: {duration}s',flush=True)
    started=time.time()
    log_path=RUNTIME/f'{trial_id}.log'
    with log_path.open('w') as log:
        proc=subprocess.Popen(args,env=ENV,stdout=log,stderr=subprocess.STDOUT,text=True)
        thread=threading.Thread(target=sample,args=(stop,samples),daemon=True);thread.start()
        code=proc.wait()
        stop.set();thread.join(timeout=15)
    generator=json.loads(capture(['docker','inspect','territory-load-generator']))[0]
    after=state()
    delivery=propagation(log_path)
    summary=json.loads(summary_path.read_text()) if summary_path.exists() else {}
    threshold_ok=bool(summary) and all(t.get('ok',False) for m in summary.get('metrics',{}).values() for t in m.get('thresholds',{}).values())
    infrastructure_ok=len(after)==5 and all(s['running'] and not s['oom'] and s['restarts']==next((b['restarts'] for b in before if b['service']==s['service']),-1) for s in after)
    generator_ok=not generator['State']['OOMKilled'] and generator['State']['ExitCode'] not in (137,139)
    cpus={}
    for observation in samples:
        for c in observation.get('containers',[]):
            name=c.get('Name',''); cpus.setdefault(name,[]).append(float(c.get('CPUPerc','0%').rstrip('%')))
    generator_cpu=cpus.get('territory-load-generator',[])
    generator_bound=bool(generator_cpu) and max(generator_cpu)>=95 and metric(summary,'dropped_iterations','count')>0
    sources_path=RESULTS/'image-sources.json'
    sources=json.loads(sources_path.read_text()).get(ENV['LOAD_VARIANT'],{}) if sources_path.exists() else {}
    queries=json.loads(db("SELECT coalesce(json_agg(q),'[]'::json) FROM (SELECT query,calls,total_exec_time,mean_exec_time,rows,shared_blks_hit,shared_blks_read FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20) q"))
    data={'harness_version':2,'id':trial_id,'label':label,'interval_seconds':seconds,'profile':profile,'logical_users':users,'duration_seconds':duration,
      'kind':kind,'workload':workload,'wall_seconds':round(time.time()-started,2),'exit_code':code,
      'passed':code==0 and threshold_ok and infrastructure_ok and generator_ok and not generator_bound and (workload=='idle' or (delivery['samples']>0 and not delivery['missing_sequences'])),'generator_valid':generator_ok and not generator_bound,'generator_bound':generator_bound,'infrastructure_valid':infrastructure_ok,
      'snapshot_p95_ms':metric(summary,'snapshot_ms','p(95)'), 'mark_p95_ms':metric(summary,'mark_ms','p(95)'),
      'propagation_p95_ms':delivery['p95_ms'], 'propagation_samples':delivery['samples'],'delivery':delivery,
      'changed_poll_p95_ms':metric(summary,'changed_poll_ms','p(95)'), 'unchanged_poll_p95_ms':metric(summary,'unchanged_poll_ms','p(95)'),
      'initial_snapshots':metric(summary,'initial_snapshots','count'), 'changed_snapshots':metric(summary,'changed_snapshots','count'),'unchanged_polls':metric(summary,'unchanged_polls','count'),
      'error_rate':metric(summary,'unexpected_errors','rate',1), 'dropped_iterations':metric(summary,'dropped_iterations','count'),
      'active_users':0 if workload=='idle' else users//10,'mark_period_seconds':30,'top_queries':queries,
      'cpu_avg_percent':{name:round(sum(v)/len(v),2) for name,v in cpus.items() if v},
      'resources_before':before,'resources_after':after,'generator':{'cpu':generator['HostConfig']['NanoCpus']/1e9,'memory':generator['HostConfig']['Memory'],'oom':generator['State']['OOMKilled']},
      'metrics':summary.get('metrics',{}),'monitor':samples,
      'api_commit':sources.get('api_commit',os.getenv('LOAD_API_COMMIT','unknown')),'harness_commit':capture(['git','-C',str(ROOT.parent),'rev-parse','HEAD']),
      'admin_commit':sources.get('admin_commit','b080214')}
    path.write_text(json.dumps(data,indent=2)+'\n')
    run(['docker','rm','territory-load-generator'],stdout=subprocess.DEVNULL)
    print(f"  {'PASS' if data['passed'] else 'FAIL'} snapshot={data['snapshot_p95_ms']:.1f}ms mark={data['mark_p95_ms']:.1f}ms propagation={data['propagation_p95_ms']}ms errors={data['error_rate']:.3%}",flush=True)
    return data

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['prepare','smoke','matrix','repeat','down'])
    parser.add_argument('--label',default=os.getenv('LOAD_VARIANT','baseline'))
    parser.add_argument('--intervals',default='3')
    parser.add_argument('--profiles',default='distributed,hotspot')
    parser.add_argument('--users',default='10,20,50,100,200,400,800,1600')
    parser.add_argument('--step-seconds',type=int,default=120)
    parser.add_argument('--repetitions',type=int,default=3)
    args=parser.parse_args();os.chdir(ROOT)
    if args.step_seconds!=120:raise ValueError('All load rounds must last 120 seconds')
    ENV['LOAD_VARIANT']=os.getenv('LOAD_VARIANT', 'baseline' if args.command=='smoke' else args.label)
    RUNTIME.mkdir(mode=0o700,exist_ok=True);RESULTS.mkdir(exist_ok=True)
    lock=(RUNTIME/'runner.lock').open('w')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    if args.command=='down':compose('down');return
    if args.command=='prepare':prepare();return
    if not (RUNTIME/'fixture.json').exists():raise RuntimeError('Run prepare first')
    if args.command=='smoke':
        interval(3);trial(args.label,3,'distributed',10,120,'smoke');return
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
                    middle=((low+high)//20)*10
                    if middle<=low:break
                    result=trial(args.label,seconds,profile,middle,args.step_seconds,'refine')
                    if result['passed']:low=middle
                    else:high=middle
                last=low
            idle=trial(args.label,seconds,profile,max(10,last),120,'idle','idle')
            if last and not idle['passed']:last=0
            print(json.dumps({'interval':seconds,'profile':profile,'confirmed_users':last,'generator_limited':generator_limited,'upper_failure':first_failed}),flush=True)
    rows=[]
    for path in (RESULTS/args.label).glob('*.json'):
        data=json.loads(path.read_text());rows.append({k:data[k] for k in ['id','interval_seconds','profile','logical_users','duration_seconds','passed','generator_valid','snapshot_p95_ms','mark_p95_ms','propagation_p95_ms','error_rate','active_users']})
    if rows:
        with (RESULTS/args.label/'summary.csv').open('w') as file:
            writer=csv.DictWriter(file,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)

if __name__=='__main__':main()
