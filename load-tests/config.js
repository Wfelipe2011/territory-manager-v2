import { SharedArray } from 'k6/data';
export const config = {
  API_URL: __ENV.API_URL || 'http://proxy:8080',
  ADMIN_URL: __ENV.ADMIN_URL || 'http://admin:4800',
  USERS: Number(__ENV.USERS || 10),
  DURATION: __ENV.DURATION || '120s',
  PROFILE: __ENV.PROFILE || 'distributed',
};
for (const [url, allowed] of [[config.API_URL, /^http:\/\/(proxy:8080|localhost:3301|127\.0\.0\.1:3301)$/], [config.ADMIN_URL, /^http:\/\/(admin:4800|localhost:5800|127\.0\.0\.1:5800)$/]]) {
  if (!allowed.test(url)) throw Error('Only the isolated local load environment is allowed');
}
export const blocks = new SharedArray('load-blocks', () => {
  const metadata = JSON.parse(open('./.runtime/fixture.json'));
  if (metadata.name !== 'territory-load-v1' || metadata.blocks.length !== 400) throw Error('Unknown fixture');
  return metadata.blocks;
});
export function blockFor(index) { return blocks[config.PROFILE === 'hotspot' ? 0 : Math.floor(index / 10) % blocks.length]; }
export function headers(block) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${block.token}` }; }
