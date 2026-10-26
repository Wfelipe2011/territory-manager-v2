// Synthetic loopback-only A/B harness. Never connects to the application or a database.
const http = require('node:http');
const fs = require('node:fs');
const { RequestMetrics, requestCategory } = require('../dist/modules/monitoring/request-metrics');
const requests = Number(process.env.TELEMETRY_BENCH_REQUESTS || 10000);
const concurrency = 16;
if (!Number.isSafeInteger(requests) || requests < 100 || requests > 1000000) throw Error('Invalid request count');
let enabled = false, metrics = new RequestMetrics('api');
const server = http.createServer((req, res) => {
  if (enabled) {
    const start = performance.now(), category = requestCategory(req.method, req.url);
    res.once('finish', () => metrics.record(category, performance.now() - start, res.statusCode));
  }
  res.setHeader('Content-Type', 'application/json');
  res.end('{"ok":true,"fixture":"synthetic-qa"}');
});
function percentile(values, p) { const sorted = [...values].sort((a,b)=>a-b); return sorted[Math.ceil(sorted.length*p)-1]; }
async function run(measured, count) {
  enabled = measured; metrics = new RequestMetrics('api');
  const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
  const times = []; let next = 0;
  const cpu = process.cpuUsage(), start = performance.now();
  await Promise.all(Array.from({length:concurrency}, async () => {
    while (next < count) {
      const id = next++, began = performance.now();
      await new Promise((resolve,reject) => {
        http.get({ hostname:'127.0.0.1', port:server.address().port, path:id%2 ? '/v1/territories' : '/v1/field/sync?cursor=qa', agent }, res => {
          res.resume(); res.on('end',resolve); res.on('error',reject);
        }).on('error',reject);
      });
      times.push(performance.now()-began);
    }
  }));
  const elapsedMs = performance.now()-start, used = process.cpuUsage(cpu);
  agent.destroy();
  return { enabled:measured, requests:count, elapsedMs, requestsPerSecond:count/elapsedMs*1000, p95Ms:percentile(times,.95), cpuMs:(used.user+used.system)/1000, buckets:metrics.snapshot().buckets.length };
}
async function main() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    await run(false,1000); await run(true,1000);
    const runs=[];
    for (const mode of [false,true,true,false,false,true]) runs.push(await run(mode,requests));
    const median = mode => {
      const rows=runs.filter(row=>row.enabled===mode);
      return { requestsPerSecond:percentile(rows.map(row=>row.requestsPerSecond),.5), p95Ms:percentile(rows.map(row=>row.p95Ms),.5), cpuMs:percentile(rows.map(row=>row.cpuMs),.5) };
    };
    const baseline=median(false), instrumented=median(true);
    const result={ generatedAt:new Date().toISOString(), scope:'Synthetic HTTP loopback, fixed response, no business logic/database/production certification', node:process.version, concurrency, runs, baseline,instrumented,
      throughputChangePercent:(instrumented.requestsPerSecond/baseline.requestsPerSecond-1)*100,
      p95ChangeMs:instrumented.p95Ms-baseline.p95Ms,
      cpuPerRequestChangeMicroseconds:(instrumented.cpuMs-baseline.cpuMs)/requests*1000 };
    if(process.env.TELEMETRY_BENCH_OUTPUT)fs.writeFileSync(process.env.TELEMETRY_BENCH_OUTPUT,JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  } finally { server.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;server.close();});
