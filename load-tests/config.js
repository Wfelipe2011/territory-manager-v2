import { SharedArray } from 'k6/data';
import { buildReaders, activeOwner } from './distribution.mjs';
export const config = {
  API_URL: __ENV.API_URL || 'http://proxy:8080',
  ADMIN_URL: __ENV.ADMIN_URL || 'http://admin:4800',
  USERS: Number(__ENV.USERS || 10),
  DURATION: __ENV.DURATION || '120s',
  PROFILE: __ENV.PROFILE || 'distributed',
  GROUP_SIZE: Number(__ENV.GROUP_SIZE || 10),
  STAGED: __ENV.STAGED_READERS === '1',
  PREP_SECONDS: __ENV.STAGED_READERS === '1' ? 65 : 0,
};
if (![10,20].includes(config.GROUP_SIZE))throw Error('Group preference must be 10 or 20');
for (const [url, allowed] of [[config.API_URL, /^http:\/\/(proxy:8080|localhost:3301|127\.0\.0\.1:3301)$/], [config.ADMIN_URL, /^http:\/\/(admin:4800|localhost:5800|127\.0\.0\.1:5800)$/]]) {
  if (!allowed.test(url)) throw Error('Only the isolated local load environment is allowed');
}
export const blocks = new SharedArray('load-blocks', () => {
  const metadata = JSON.parse(open(__ENV.FIXTURE_PATH || './.runtime/fixture.json'));
  if (!['territory-load-v1','territory-load-peak-v1'].includes(metadata.name) || metadata.blocks.length !== 400) throw Error('Unknown fixture');
  return metadata.blocks;
});
export const peak = __ENV.FIXTURE_PATH === './.runtime/fixture-peak.json';
const readers = peak ? new SharedArray('peak-readers', () => buildReaders(Array.from(blocks),config.USERS,config.GROUP_SIZE,config.PROFILE==='hotspot')) : null;
export function blockFor(index) { return blocks[peak ? readers[index].blockIndex : config.PROFILE === 'hotspot' ? 0 : Math.floor(index / 10) % blocks.length]; }
export function writerOwner(index) { return peak ? activeOwner(index,12) : index*10; }
export function sampledReader(index) { return peak ? readers[index].sampled : index%10===1 && (config.PROFILE!=='hotspot'||Math.floor(index/10)<20); }

export function headers(block) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${block.token}` }; }
