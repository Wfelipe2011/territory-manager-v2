import http from 'k6/http';
import { Rate, Trend, Counter } from 'k6/metrics';
import { config, headers } from './config.js';
export const errors = new Rate('unexpected_errors');
export const initial = new Trend('snapshot_ms', true);
export const marking = new Trend('mark_ms', true);
export const api1 = new Counter('api_upstream_a');
export const api2 = new Counter('api_upstream_b');

export function observe(res, kind) {
  errors.add(res.status !== 200);
  const host = res.headers['X-Load-Upstream'];
  if (host) { (host===__ENV.API1_ADDRESS ? api1 : api2).add(1); }
  if (kind === 'initial') initial.add(res.timings.duration);
  if (kind === 'mark') marking.add(res.timings.duration);
  return res;
}
export function pollUrl(block, identity, cursor) {
  return `${config.API_URL}/v1/field/blocks/${block.blockId}/sync?clientId=load-client-${identity}&tabId=load-tab-id-${identity}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
}
export function params(block, name) { return { headers:headers(block), timeout:'35s', tags:{name}, responseType:'text' }; }
export function snapshot(block, identity) {
  const res=observe(http.get(pollUrl(block,identity),params(block,'snapshot')), 'initial');
  if (res.status !== 200) return null;
  try { return res.json(); } catch { errors.add(true); return null; }
}
export function mark(block, offset, status) {
  const address=block.firstAddress+Math.floor(offset/50), house=block.firstHouse+offset;
  return observe(http.patch(`${config.API_URL}/v1/territories/${block.territoryId}/blocks/${block.blockId}/address/${address}/houses/${house}`,JSON.stringify({round:8,status}),params(block,'mark')), 'mark');
}
