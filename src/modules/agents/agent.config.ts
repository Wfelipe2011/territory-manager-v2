import { createHash } from 'crypto';

export const AGENT_SCOPES = ['catalog:read', 'catalog:write'];
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const nativeImport = (specifier: string): Promise<any> => import(specifier);

export function agentConfig() {
  const enabled = process.env.AGENT_MCP_ENABLED === 'true';
  const origin = new URL(process.env.AGENT_PUBLIC_ORIGIN || 'http://localhost:3001');
  if (enabled && origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) {
    throw new Error('AGENT_PUBLIC_ORIGIN exige HTTPS fora de loopback');
  }
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('AGENT_PUBLIC_ORIGIN deve ser somente a origem');
  const encryptionKey = process.env.AGENT_OAUTH_ENCRYPTION_KEY || '';
  if (enabled && !/^[a-f0-9]{64}$/i.test(encryptionKey)) throw new Error('AGENT_OAUTH_ENCRYPTION_KEY exige 32 bytes em hexadecimal');
  const cookieKeys = (process.env.AGENT_OAUTH_COOKIE_KEYS || '').split(',').filter(Boolean);
  if (enabled && (!cookieKeys.length || cookieKeys.some(key => key.length < 32))) throw new Error('AGENT_OAUTH_COOKIE_KEYS exige chaves de pelo menos 32 caracteres');
  const jwks = process.env.AGENT_OAUTH_JWKS ? JSON.parse(process.env.AGENT_OAUTH_JWKS) : undefined;
  if (enabled && !jwks?.keys?.length) throw new Error('AGENT_OAUTH_JWKS exige chaves persistentes');
  const allowedCimdOrigins = (process.env.AGENT_OAUTH_CIMD_ORIGINS || 'https://chatgpt.com,https://claude.ai').split(',').map(value => new URL(value).origin);
  const clients = process.env.AGENT_OAUTH_CLIENTS ? JSON.parse(process.env.AGENT_OAUTH_CLIENTS) : [];
  const admin = new URL(process.env.AGENT_ADMIN_PUBLIC_ORIGIN || 'http://localhost:4800');
  if (enabled && origin.protocol === 'https:' && admin.protocol !== 'https:') throw new Error('AGENT_ADMIN_PUBLIC_ORIGIN exige HTTPS em publicação pública');
  if (admin.pathname !== '/' || admin.search || admin.hash || admin.username || admin.password) throw new Error('AGENT_ADMIN_PUBLIC_ORIGIN deve ser somente a origem');
  return { enabled, origin: origin.origin, adminOrigin: admin.origin, issuer: `${origin.origin}/oauth`, resource: `${origin.origin}/mcp`, encryptionKey, cookieKeys, jwks, allowedCimdOrigins, clients };
}

export type AgentPrincipal = { userId: number; tenantId: number; clientId: string; connectionId: string; scopes: string[] };
