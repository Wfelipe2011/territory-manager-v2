#!/usr/bin/env python3
"""Capture READ ONLY plans in the synthetic lab, outside capacity measurements."""
import argparse,fcntl,json,subprocess
import lab
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--modes',default='baseline,joined,aggregate')
a=p.parse_args()
modes=a.modes.split(',')
if any(m not in ['baseline','joined','aggregate'] for m in modes):p.error('Unknown mode')
block=json.loads((lab.RUNTIME/'fixture-peak.json').read_text())['blocks'][0]
out=lab.ROOT/'results/sql-tuning-plans';out.mkdir(exist_ok=True)
with (lab.ROOT.parent/'.runtime/runner.lock').open('a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 try:
  for mode in modes:
   lab.ENV['LAB_SNAPSHOT_MODE']=mode
   lab.up('bun')
   subprocess.run(['docker','exec','-i','territory-field-labs-bun-1','bun','/app/labs/bun/explain.cjs'],input=json.dumps(block),text=True,capture_output=True,timeout=60,check=True)
   target=out/(mode+'.json')
   subprocess.run(['docker','cp','territory-field-labs-bun-1:/tmp/field-explain.json',str(target)],check=True)
   data=json.loads(target.read_text());assert data['houses']==150 and data['plans']
   data['image']=next(x['imageId'] for x in lab.state('bun') if x['service']=='bun')
   target.write_text(json.dumps(data,indent=2)+'\n')
   print(mode,'plans',len(data['plans']),flush=True)
 finally:lab.compose('down')
