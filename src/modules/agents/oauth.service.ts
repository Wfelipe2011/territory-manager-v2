import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { agentConfig, AgentPrincipal, AGENT_SCOPES, digest, nativeImport } from './agent.config';
import { oauthAdapter } from './oauth-adapter';
import { AgentCatalogService } from './catalog.service';

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

@Injectable()
export class AgentOAuthService {
  provider: any;
  readonly config = agentConfig();
  constructor(private readonly prisma: PrismaService, private readonly catalog: AgentCatalogService) {}

  async initialize() {
    if (!this.config.enabled) return;
    const { Provider, errors } = await nativeImport('oidc-provider');
    const config = this.config;
    this.provider = new Provider(config.issuer, {
      adapter: oauthAdapter(this.prisma, config.encryptionKey),
      clients: config.clients,
      jwks: config.jwks,
      cookies: { keys: config.cookieKeys, short: { sameSite: 'lax' }, long: { sameSite: 'lax' } },
      responseTypes: ['code'],
      grantTypes: ['authorization_code', 'refresh_token'],
      // Resource scopes belong exclusively to the MCP resource, not the OIDC UserInfo grant.
      scopes: ['openid', 'offline_access'],
      claims: { openid: ['sub'] },
      pkce: { required: () => true, methods: ['S256'] },
      features: {
        devInteractions: { enabled: false },
        userinfo: { enabled: false },
        revocation: { enabled: true },
        clientIdMetadataDocument: {
          enabled: true, ack: 'draft-02',
          allowFetch: (_ctx: unknown, clientId: string) => config.allowedCimdOrigins.includes(new URL(clientId).origin),
          allowClient: (_ctx: unknown, client: any) => config.allowedCimdOrigins.includes(new URL(client.clientId).origin),
        },
        resourceIndicators: {
          enabled: true,
          defaultResource: () => config.resource,
          useGrantedResource: () => true,
          getResourceServerInfo: (_ctx: unknown, resource: string) => {
            if (resource !== config.resource) throw new errors.InvalidTarget();
            return { scope: AGENT_SCOPES.join(' '), audience: config.resource, accessTokenFormat: 'opaque', accessTokenTTL: 900 };
          },
        },
      },
      ttl: { AccessToken: 900, AuthorizationCode: 120, Grant: 2592000, RefreshToken: 2592000, Interaction: 600, Session: 86400 },
      issueRefreshToken: () => true,
      rotateRefreshToken: true,
      interactions: { url: (_ctx: unknown, interaction: any) => `${config.origin}/agent/interaction/${interaction.uid}` },
      findAccount: async (_ctx: unknown, id: string) => {
        const user = await this.prisma.user.findUnique({ where: { id: Number(id) } });
        return user ? { accountId: id, claims: () => ({ sub: id }) } : undefined;
      },
      // Reuse only the consent submitted in this interaction, never a prior session grant.
      loadExistingGrant: async (ctx: any) => ctx.oidc.result?.consent?.grantId ? this.provider.Grant.find(ctx.oidc.result.consent.grantId) : undefined,
      extraTokenClaims: async (_ctx: unknown, token: any) => {
        try { await this.principalForGrant(token.grantId, token.clientId, token.accountId); }
        catch { throw new errors.InvalidGrant('Autorização revogada ou conta alterada'); }
        return {};
      },
      renderError: (ctx: any) => {
        ctx.type = 'html';
        ctx.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" });
        ctx.body = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conexão não autorizada</title><h1>Conexão não autorizada</h1><p>Confira a configuração e inicie a conexão novamente no seu agente.</p></html>';
      },
    });
    this.provider.proxy = true;
    // Only trust proxy headers after the ingress has overwritten them (see deployment guide).
  }

  async principalForGrant(id: string, clientId: string, accountId: string): Promise<AgentPrincipal> {
    const connection = await this.prisma.agent_connection.findUnique({ where: { id } });
    if (!connection || connection.clientId !== clientId || String(connection.userId) !== accountId) throw new UnauthorizedException('Conexão inválida');
    const principal = { userId: connection.userId, tenantId: connection.tenantId, clientId, connectionId: id, scopes: connection.scopes };
    await this.catalog.assertConnection(this.prisma, principal);
    return principal;
  }

  async authenticate(req: Request): Promise<AgentPrincipal> {
    const header = req.headers.authorization;
    if (!header || !/^Bearer [^\s]+$/i.test(header)) throw new UnauthorizedException('Conecte sua conta');
    const token = await this.provider.AccessToken.find(header.slice(7));
    if (!token || token.isExpired || token.aud !== this.config.resource || token.kind !== 'AccessToken') throw new UnauthorizedException('Token inválido');
    const principal = await this.principalForGrant(token.grantId, token.clientId, token.accountId);
    return { ...principal, scopes: principal.scopes.filter(scope => String(token.scope || '').split(' ').includes(scope)) };
  }

  challenge(scope = 'catalog:read', error?: string) {
    return `Bearer resource_metadata="${this.config.origin}/.well-known/oauth-protected-resource", scope="${scope}"${error ? `, error="${error}"` : ''}`;
  }

  private consentBinding(uid: string, user: any) { return createHmac('sha256', this.config.encryptionKey).update(`${uid}:${user.id}:${user.tenantId}:${digest(user.password)}`).digest('hex'); }
  private csrf(uid: string) { return createHmac('sha256', this.config.encryptionKey).update(`interaction:${uid}`).digest('hex'); }
  private validateCsrf(uid: string, supplied: unknown) {
    const expected = Buffer.from(this.csrf(uid));
    const input = Buffer.from(typeof supplied === 'string' ? supplied : '');
    if (input.length !== expected.length || !timingSafeEqual(input, expected)) throw new UnauthorizedException('Formulário expirado');
  }

  async interaction(req: Request, res: Response) {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
    const details = await this.provider.interactionDetails(req, res);
    // Chrome applies form-action to the redirect chain too. The provider has already
    // validated this exact redirect URI against the requesting client's metadata.
    const callbackOrigin = new URL(String(details.params.redirect_uri)).origin;
    const nonce = randomBytes(18).toString('base64');
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self' ${callbackOrigin}; frame-ancestors 'none'; base-uri 'none'`);
    const action = `${this.config.origin}/agent/interaction/${encodeURIComponent(details.uid)}`;
    const formToken = `<input type="hidden" name="csrf" value="${this.csrf(details.uid)}">`;
    const html = (body: string, status = 200) => res.status(status).type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar Território Digital</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f5f8f3;color:#24302a;font:16px/1.6 system-ui,sans-serif;padding:32px 16px}main{max-width:600px;margin:5vh auto;background:white;border:1px solid #dde5d8;border-radius:20px;padding:32px;box-shadow:0 12px 40px #24302a08}h1{font-size:25px;line-height:1.3;margin:0 0 24px}p,li{color:#4c5d50}strong{color:#24302a}a{color:#386a32;text-underline-offset:3px}label{font-weight:600;display:block;color:#24302a}input:not([type=hidden]){display:block;width:100%;padding:12px;border:1px solid #a8b7a4;border-radius:8px;font:inherit;margin-top:6px}button{font:inherit;font-weight:600;cursor:pointer;padding:10px 20px;border:1px solid #44783c;border-radius:9px;background:#44783c;color:white;margin:12px 8px 0 0}button[value=deny]{background:white;color:#386a32}button:focus-visible,input:focus-visible{outline:3px solid #9fc48f;outline-offset:3px}ul{padding-left:24px}@media(max-width:450px){main{padding:24px;margin:16px auto}h1{font-size:23px}}</style></head><body><main><h1>Conectar Território Digital</h1>${body}</main></body></html>`);
    if (req.method === 'POST') {
      this.validateCsrf(details.uid, req.body?.csrf);
      if (req.body?.decision === 'deny') return this.provider.interactionFinished(req, res, { error: 'access_denied' }, { mergeWithLastSubmission: false });
    } else if (req.method !== 'GET') return res.sendStatus(405);
    if (details.prompt.name === 'login') {
      if (req.method === 'POST') {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const user = email.length <= 254 && password.length <= 1024 ? await this.prisma.user.findUnique({ where: { email } }) : null;
        if (user && await bcrypt.compare(password, user.password)) {
          return this.provider.interactionFinished(req, res, { login: { accountId: String(user.id), remember: false } }, { mergeWithLastSubmission: false });
        }
        return html('<p>E-mail ou senha inválidos. Volte e tente novamente.</p>', 401);
      }
      return html(`<p>Entre com sua conta de administrador. Sua senha é enviada somente ao Território Digital.</p><form method="post" action="${escapeHtml(action)}">${formToken}<p><label>E-mail <input name="email" type="email" autocomplete="username" required maxlength="254"></label></p><p><label>Senha <input name="password" type="password" autocomplete="current-password" required maxlength="1024"></label></p><button>Entrar</button><button name="decision" value="deny" formnovalidate>Cancelar</button></form>`);
    }
    if (details.prompt.name !== 'consent' || !details.session?.accountId) return html('<p>Interação não suportada. Inicie a conexão novamente.</p>', 400);
    const user = await this.prisma.user.findUnique({ where: { id: Number(details.session.accountId) }, include: { multitenancy: true } });
    if (!user) throw new UnauthorizedException('Usuário não encontrado');
    const client = await this.provider.Client.find(details.params.client_id);
    const scopes = String(details.params.scope || '').split(' ').filter((scope: string) => AGENT_SCOPES.includes(scope));
    const clientName = client.clientName || client.clientId;
    if (req.method === 'POST') {
      if (req.body?.consentBinding !== this.consentBinding(details.uid, user)) throw new UnauthorizedException('Conta ou congregação alterada. Inicie a conexão novamente');
      if (req.body?.decision !== 'allow') throw new UnauthorizedException('Consentimento necessário');
      const grant = new this.provider.Grant({ accountId: String(user.id), clientId: client.clientId });
      grant.addOIDCScope(String(details.params.scope || '').split(' ').filter((scope: string) => ['openid', 'offline_access'].includes(scope)).join(' '));
      grant.addResourceScope(this.config.resource, scopes.join(' '));
      const grantId = await grant.save();
      await this.prisma.agent_connection.create({ data: { id: grantId, userId: user.id, tenantId: user.tenantId, clientId: client.clientId, clientName, credentialVersion: digest(user.password), scopes, expiresAt: new Date(Date.now() + 2592000000) } });
      return this.provider.interactionFinished(req, res, { consent: { grantId } }, { mergeWithLastSubmission: true });
    }
    return html(`<p><strong>${escapeHtml(clientName)}</strong> solicita acesso à congregação <strong>${escapeHtml(user.multitenancy.name)}</strong> como ${escapeHtml(user.name)}.</p><ul>${scopes.map((scope: string) => `<li>${scope === 'catalog:read' ? 'Consultar territórios, quadras, ruas e casas.' : 'Cadastrar e editar territórios, quadras, ruas e casas. A inclusão de casas pode abrir uma rodada compatível automaticamente.'}</li>`).join('')}</ul><p><a href="${escapeHtml(this.config.adminOrigin)}/integracoes/privacidade">Privacidade</a> · <a href="${escapeHtml(this.config.adminOrigin)}/integracoes/termos">Termos de uso</a>. Dados retornados serão enviados ao cliente de IA. Nenhuma exclusão, marcação ou acesso a outra congregação será autorizado. Você pode revogar a conexão em Integrações no Admin.</p><form method="post" action="${escapeHtml(action)}">${formToken}<input type="hidden" name="consentBinding" value="${this.consentBinding(details.uid, user)}"><button name="decision" value="allow">Autorizar</button><button name="decision" value="deny">Cancelar</button></form>`);
  }
}
