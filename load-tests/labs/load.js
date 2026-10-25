import http from 'k6/http';
import exec from 'k6/execution';
import { sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { config, blockFor, writerOwner, sampledReader, headers } from '../config.js';

// Separate writer shutdown from observer shutdown. Writes start only inside the
// 120-second window; observers continue another 60 seconds for late ACK delivery.
const idle = __ENV.IDLE_ONLY === '1';
const users = config.USERS, active = idle ? 0 : users / 10, prep = 65, duration = 120, tail = Number(__ENV.LAB_OBSERVER_TAIL || 90);
if (![30,90].includes(tail)) throw Error('Unsupported observer tail');
if (!config.STAGED || users < 120 || users % 10) throw Error('Staged synthetic peak workload required');
const ready = new Counter('initial_ready'), entries = new Trend('snapshot_ms', true);
const marks = new Trend('mark_ms', true), sentinel = new Trend('principal_snapshot_ms', true);
const errors = new Rate('unexpected_errors'), measured = new Rate('started_in_window_errors');
const sentinelErrors = new Rate('principal_snapshot_errors'), lateness = new Trend('writer_start_lateness_ms', true);
const changedTime = new Trend('changed_snapshot_ms', true), unchangedTime = new Trend('unchanged_response_ms', true);
const initialCount = new Counter('initial_snapshots'), changed = new Counter('changed_snapshots');
export const options = {
  discardResponseBodies: true,
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  scenarios: {
    observers: { executor: 'constant-vus', vus: users, duration: `${prep + duration + tail}s`, exec: 'observeScreen', gracefulStop: '35s' },
    ...(idle ? {} : { writers: { executor: 'per-vu-iterations', vus: active, iterations: 4, startTime: `${prep}s`, maxDuration: '155s', exec: 'writeHouse', gracefulStop: '35s' } }),
    principal: { executor: 'constant-vus', vus: 1, startTime: `${prep}s`, duration: `${duration}s`, exec: 'principalProbe', gracefulStop: '35s' },
  },
  thresholds: { initial_ready: [`count>=${users}`], snapshot_ms: ['p(95)<=1000'], ...(idle ? {} : {mark_ms: ['p(95)<=500']}),
    unexpected_errors: ['rate<0.01'], started_in_window_errors: ['rate<0.01'],
    principal_snapshot_errors: ['rate<0.01'], ...(idle ? {} : {writer_start_lateness_ms: ['p(95)<=500']}), dropped_iterations: ['count==0'] },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};
let cursor, previous, started = false, counted = false;
const logical = (Math.max(1, __VU) - 1) % users;
const nonce = String(__VU).padStart(12, '0');
const sampled = sampledReader(logical);
const event = data => console.log('FIELD_EVENT ' + JSON.stringify(data));
function url(block, identity, revision, base = config.API_URL) {
  return `${base}/v1/field/blocks/${block.blockId}/sync?clientId=load-client-${identity}&tabId=load-tab-id-${identity}${revision ? '&cursor=' + encodeURIComponent(revision) : ''}`;
}
function params(block, name) { return { headers: headers(block), timeout: '35s', tags: { name }, responseType: 'text' }; }
function record(res, begin, parse = false, primary = false) {
  let state, bad = res.status !== 200;
  if (parse && !bad) { try { state = res.json(); } catch { bad = true; } }
  errors.add(bad);
  const relative = begin - exec.scenario.startTime;
  // Observers start at t=0; writers/probe scenarios start at t=65.
  const inWindow = exec.scenario.name === 'observers' ? relative >= prep * 1000 && relative < (prep + duration) * 1000 : relative >= 0 && relative < duration * 1000;
  if (inWindow) measured.add(bad);
  if (primary) sentinelErrors.add(bad);
  if (bad) event({ event: 'request_error', kind: exec.scenario.name, at: Date.now(), started: begin, status: res.status });
  return state;
}
function remember(state, initial) {
  if (!sampled || !state.data) return;
  const next = {};
  const rows = state.data.streets.flatMap(street => street.houses);
  if (initial) event({ event: 'initial', at: Date.now(), observer: logical, states: rows.map(h => [h.id, h.status]) });
  for (const house of rows) {
    next[house.id] = house.status;
    if (!initial && previous && previous[house.id] !== undefined && previous[house.id] !== house.status)
      event({ event: 'seen', house: house.id, status: house.status, at: Date.now(), observer: logical });
  }
  previous = next;
}
export function observeScreen() {
  if (!started) {
    started = true;
    if (logical === 0) event({ event: 'window', at: exec.scenario.startTime + prep * 1000 });
    sleep(logical / users * 30);
  }
  const block = blockFor(logical), initial = !cursor, begin = Date.now();
  const res = http.get(url(block, nonce, cursor), params(block, initial ? 'snapshot' : 'poll'));
  const state = record(res, begin, true);
  if (!state) { cursor = undefined; sleep(1); return; }
  cursor = state.cursor;
  if (initial) {
    entries.add(res.timings.duration);
    if (!counted) { counted = true; initialCount.add(1); if (Date.now() < exec.scenario.startTime + prep * 1000) ready.add(1); }
    remember(state, true);
  } else if (state.changed) { changed.add(1); changedTime.add(res.timings.duration); remember(state, false); }
  else unchangedTime.add(res.timings.duration);
}
export function writeHouse() {
  const owner = (exec.vu.idInTest - 1) % active, round = exec.vu.iterationInScenario;
  const planned = exec.scenario.startTime + round * 30000 + owner * 30000 / active;
  sleep(Math.max(0, planned - Date.now()) / 1000);
  const begin = Date.now();
  lateness.add(Math.max(0, begin - planned));
  const sequence = round * active + owner, ownerId = writerOwner(owner), block = blockFor(ownerId);
  const offset = (Math.floor(owner / 12) * 4 + round) % 150;
  const address = block.firstAddress + Math.floor(offset / 50), house = block.firstHouse + offset;
  const res = http.patch(`${config.API_URL}/v1/territories/${block.territoryId}/blocks/${block.blockId}/address/${address}/houses/${house}`,
    JSON.stringify({ round: 8, status: true }), params(block, 'mark'));
  record(res, begin);
  marks.add(res.timings.duration);
  if (res.status === 200) event({ event: 'ack', sequence, house, status: true, started: begin, at: Date.now(), owner: ownerId });
}
export function principalProbe() {
  const block = blockFor(0), begin = Date.now();
  const res = http.get(url(block, 'sentinel-0000000001', undefined, 'http://api:3000'), params(block, 'principal-snapshot'));
  record(res, begin, true, true);
  sentinel.add(res.timings.duration);
  sleep(5);
}
export function handleSummary(data) { return { '/output/load-summary.json': JSON.stringify(data, null, 2) }; }
