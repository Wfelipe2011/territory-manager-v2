import { readFile, writeFile, cp, mkdir, rm, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = new URL(process.argv[2]);
const local = process.argv.includes('--local');
if (server.pathname !== '/mcp' || server.search || server.hash || server.username || server.password) throw new Error('Informe o endpoint canônico /mcp, sem credenciais ou parâmetros');
if (local ? !['localhost', '127.0.0.1'].includes(server.hostname) : server.protocol !== 'https:') throw new Error('Pacotes públicos exigem HTTPS; --local aceita somente loopback');
const metadata = await fetch(`${server.origin}/.well-known/oauth-protected-resource`, { signal: AbortSignal.timeout(15000) });
if (!metadata.ok) throw new Error('Endpoint MCP indisponível: metadados não encontrados');
const document = await metadata.json();
if (document.resource !== server.href || !document.authorization_servers?.length) throw new Error('Recurso MCP ou servidor OAuth divergente');
const info = new URL(document.resource_documentation);
const listingUrls = { websiteURL: info.href, supportURL: new URL('/integracoes/suporte', info).href, privacyPolicyURL: document.resource_policy_uri, termsOfServiceURL: document.resource_tos_uri };
if (!local) for (const url of Object.values(listingUrls)) {
  const destination = new URL(url);
  if (destination.protocol !== 'https:') throw new Error('Páginas públicas exigem HTTPS');
  const page = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const html = await page.text();
  if (!page.ok || !html.includes('Wilson Felipe da Silva') || !html.includes('Território Digital') || new URL(page.url).pathname.includes('/login')) throw new Error(`Página pública indisponível ou divergente: ${url}`);
}
const challenge = await fetch(server, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) });
if (challenge.status !== 401 || !challenge.headers.get('www-authenticate')?.includes('resource_metadata')) throw new Error('Endpoint não oferece o desafio OAuth esperado');
const target = resolve(root, '.agent-runtime/plugins');
await mkdir(target, { recursive: true });
for (const host of ['openai', 'claude']) {
  const source = resolve(root, 'integrations/plugins', host);
  const destination = resolve(target, `${host}-territorio-digital`);
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });
  const template = JSON.parse((await readFile(resolve(destination, 'mcp.template.json'), 'utf8')).replaceAll('__MCP_URL__', server.href));
  if (local) {
    if (host === 'claude') template.mcpServers['territorio-digital'].oauth = { clientId: 'territorio-digital-dev' };
    else template.mcpServers['territorio-digital'].extensions = { 'com.openai': { auth: {
      type: 'oauth', client: { mode: 'provided', clientId: 'territorio-digital-dev', tokenEndpointAuthMethod: 'none' },
      resource: server.href, baseScopes: ['catalog:read', 'catalog:write', 'offline_access'],
    } } };
  }
  await writeFile(resolve(destination, host === 'openai' ? 'mcp.json' : '.mcp.json'), JSON.stringify(template, null, 2));
  await rm(resolve(destination, 'mcp.template.json'));
  await mkdir(resolve(destination, 'skills/territorio-digital'), { recursive: true });
  await cp(resolve(root, 'integrations/plugins/openai/skills/territorio-digital/SKILL.md'), resolve(destination, 'skills/territorio-digital/SKILL.md'));
  const manifest = JSON.parse(await readFile(resolve(destination, host === 'openai' ? 'plugin.json' : '.claude-plugin/plugin.json'), 'utf8'));
  if (host === 'openai') {
    Object.assign(manifest.extensions['com.openai'].interface, listingUrls);
    if (local) manifest.extensions['com.openai'].interface.displayName = 'Território Digital · local';
    await writeFile(resolve(destination, 'plugin.json'), JSON.stringify(manifest, null, 2));
  }
  if (host === 'openai' && manifest.extensions['com.openai'].interface.shortDescription.length > 30) throw new Error('Subtítulo excede 30 caracteres');
  const zip = `${destination}.zip`;
  execFileSync('python3', ['-c', 'import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.write(f,f.relative_to(p)) for f in p.rglob("*") if f.is_file()]; z.close()', destination, zip]);
  const inventory = await readdir(destination);
  console.log(`${host}: ${zip} (${inventory.join(', ')})`);
}
await mkdir(resolve(target, '.claude-plugin'), { recursive: true });
await writeFile(resolve(target, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'territorio-digital', owner: { name: 'Wilson Felipe da Silva' }, plugins: [{ name: 'territorio-digital', source: './claude-territorio-digital', description: 'Cadastro da congregação via MCP/OAuth' }] }, null, 2));
await mkdir(resolve(target, '.agents/plugins'), { recursive: true });
await writeFile(resolve(target, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'territorio-digital', interface: { displayName: 'Território Digital' }, plugins: [{ name: 'territorio-digital', source: { source: 'local', path: './openai-territorio-digital' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }, null, 2));
console.log(local ? 'Pacotes locais para Codex/ChatGPT desktop e Claude Code. ChatGPT na web exige endpoint HTTPS público.' : 'Endpoint OAuth e páginas públicas verificados. Submissão ainda exige revisão dos textos públicos, conta de revisão, testes no cliente e vídeo real.');
