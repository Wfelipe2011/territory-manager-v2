#!/usr/bin/env python3
"""Reproducible Bun-only capacity/pool/interval experiments on synthetic data."""
import argparse
import fcntl
import json
from pathlib import Path
import subprocess
import time
import compare
import lab
from importlib.machinery import SourceFileLoader


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode', choices=['baseline','joined','aggregate'], default='baseline')
    p.add_argument('--users', default='150,300,500,750,1000,1500,2000,3000')
    p.add_argument('--pools', default='10')
    p.add_argument('--intervals', default='3000')
    p.add_argument('--groups', default='10')
    p.add_argument('--repetitions', type=int, default=1)
    p.add_argument('--idle', action='store_true')
    p.add_argument('--search', action='store_true')
    p.add_argument('--out', type=Path)
    args = p.parse_args()
    counts = [int(x) for x in args.users.split(',')]
    pools = [int(x) for x in args.pools.split(',')]
    intervals = [int(x) for x in args.intervals.split(',')]
    groups = [int(x) for x in args.groups.split(',')]
    if any(n<120 or n%10 for n in counts) or any(n not in [1,2,5,10] for n in pools) or any(n not in [3000,5000,10000,15000,20000,25000] for n in intervals) or any(n not in [10,20] for n in groups) or args.repetitions<1:
        p.error('Unsupported cohort/pool/interval/group/repetitions')
    if args.search and (len(pools)!=1 or len(intervals)!=1 or len(groups)!=1):
        p.error('Search changes only user count')
    out = args.out or lab.ROOT/'results'/('tuning-'+time.strftime('%Y%m%d-%H%M%S',time.gmtime()))
    out.mkdir(parents=True,exist_ok=True)
    command = ['docker','compose','-f',str(compare.W/'docker-compose.yml')]
    running = subprocess.check_output(command+['ps','--services','--status','running'],text=True).split()
    paused = [x for x in ['api','admin'] if x in running]
    results=[]
    (out/'campaign.json').write_text(json.dumps({**vars(args),'out':str(out),'resources':'worker 0.5CPU/2GiB; PG 1CPU/2GiB; API 0.4CPU/2GiB; proxy 0.1CPU/128MiB'},default=str,indent=2)+'\n')
    with (lab.ROOT.parent/'.runtime/runner.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        try:
            if paused: subprocess.run(command+['stop',*paused],check=True)
            for n in counts:
                stage=[]
                for rep in range(1,args.repetitions+1):
                    # Alternate pool order so a fixed order cannot always favor one candidate.
                    for pool in pools if rep%2 else list(reversed(pools)):
                        for interval in intervals:
                            for group in groups:
                                row=compare.trial('bun',n,rep,out,pool,interval,group,args.mode,args.idle)
                                stage.append(row); results.append(row)
                                (out/'summary.json').write_text(json.dumps(results,indent=2)+'\n')
                                if not row['monitoringValid'] or not row['generatorValid'] or not row['infrastructureValid']:
                                    raise RuntimeError('Invalid generator/infrastructure measurement; investigate before escalating')
                if args.search and not all(r['passed'] for r in stage):
                    print('First failing stage; stopping escalation.',flush=True)
                    break
        finally:
            subprocess.run(['docker','rm','-f','territory-field-lab-generator'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            lab.compose('down')
            if paused: subprocess.run(command+['start',*paused],check=True)
            for service,url in [('api','http://localhost:3001/api'),('admin','http://localhost:4800/login')]:
                if service in paused: lab.wait(url)
            print('Normal stack restored; evidence:',out,flush=True)

if __name__=='__main__': main()
