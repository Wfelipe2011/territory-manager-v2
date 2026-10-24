"""Local-only balance/reconnection smoke; always restarts the stopped API."""
import json, pathlib, subprocess, urllib.request, time
root=pathlib.Path(__file__).resolve().parent
fixture=json.loads((root/'.runtime/fixture.json').read_text())
assert fixture['name']=='territory-load-v1'
b=fixture['blocks'][0]
compose=['docker','compose','-f',str(root/'compose.yml')]
def fetch():
    req=urllib.request.Request(f"http://localhost:3301/v1/field/blocks/{b['blockId']}/sync?clientId=load-failover000000000&tabId=load-failover000000000",headers={'Authorization':f"Bearer {b['token']}"})
    with urllib.request.urlopen(req,timeout=35) as res:return res.status,json.load(res)
first=fetch()[1]
started=time.monotonic()
try:
    subprocess.run(compose+['stop','api1'],check=True)
    status,second=fetch()
    assert status==200 and first['data']['block']['id']==second['data']['block']['id']
    result={'stopped':'api1','continued_via':'api2','http_status':status,'same_block':True,'seconds_including_shutdown':round(time.monotonic()-started,3)}
    (root/'results'/'failover.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))
finally:
    subprocess.run(compose+['start','api1'],check=True)
    subprocess.run(compose+['restart','proxy'],check=True)
