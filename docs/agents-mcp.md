# Agentes MCP e plugins — v0.1.0

Integração para administradores de uma congregação. Consulta, criação e edição
pontuais de territórios, quadras, vínculos de ruas e casas. Não oferece exclusões,
movimentação entre pais, importações, marcações, assinaturas ou troca de tenant.

## Desenvolvimento local

Na API: `node scripts/setup-agents.mjs`. Cria `.agent-runtime/local.env` privado,
ignorado no Git, com chaves persistentes e uma configuração OAuth exclusivamente
local. Não sobrescreve chaves existentes. Depois, no workspace:

```bash
docker compose up --build -d api field-worker
```

O compose lê esse arquivo opcional. Sem configuração, o MCP fica desabilitado.
Reconstruir o worker mantém o domínio compilado na mesma revisão da API.

Para uma fixture independente dos dados restaurados, execute no host da API:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/territory_manager_production npx tsx scripts/seed-agent-demo.ts
```

Cria somente `QA Integrações MCP principal` e `QA Integrações MCP isolamento`.
Credenciais ficam em `.agent-runtime/demo-accounts.json` (0600), nunca no pacote.
Reexecutar o seed rotaciona as senhas das contas de demonstração.

Endereços locais:

- Público: `http://localhost:4800/integracoes`, `/integracoes/privacidade`,
  `/integracoes/termos` e `/integracoes/suporte`.
- Gestão autenticada: `http://localhost:4800/gestao/integracoes`.
- MCP: `http://localhost:3001/mcp`.
- Recurso protegido: `http://localhost:3001/.well-known/oauth-protected-resource`.
- Descoberta OAuth/OIDC: `http://localhost:3001/oauth/.well-known/openid-configuration`.

O ChatGPT hospedado precisa de HTTPS acessível publicamente; localhost é para
clientes locais. No Claude Code, a conexão de desenvolvimento pode usar:

```bash
claude mcp add --transport http territorio-digital http://localhost:3001/mcp --client-id territorio-digital-dev
```

Autentique pelo `/mcp` do Claude Code. O cliente de desenvolvimento é público,
exige PKCE e aceita apenas callbacks nativos de loopback `/callback`.

## Configuração de produção

Executar o gerador em diretório seguro com as origens HTTPS reais da API e do Admin:
`node scripts/setup-agents.mjs https://ORIGEM_DA_API https://ORIGEM_DO_ADMIN`.
Os valores acima são parâmetros de operação, não endpoints já publicados.
Entregar os valores gerados ao mecanismo de segredos/configuração da stack, sem
commitar o arquivo, abrir o banco nem expor chaves em logs.

| Variável | Função |
| --- | --- |
| `AGENT_MCP_ENABLED` | Interruptor global; padrão `false` |
| `AGENT_MCP_ALLOWED_TENANT_IDS` | IDs autorizados separados por vírgula, por exemplo `1,23`. Vazio bloqueia todos; não aceita `*` |
| `AGENT_PUBLIC_ORIGIN` | Origem externa canônica da API; recurso `/mcp`, issuer `/oauth` |
| `AGENT_ADMIN_PUBLIC_ORIGIN` | Origem pública do Admin e das páginas informativas |
| `AGENT_OAUTH_ENCRYPTION_KEY` | 32 bytes hex; AES-256-GCM dos artefatos no PostgreSQL |
| `AGENT_OAUTH_COOKIE_KEYS` | Chaves de assinatura, separadas por vírgula; primeira assina, demais permitem rotação |
| `AGENT_OAUTH_JWKS` | JWKS privado persistente do autorizador; não reutilizar JWT_SECRET |
| `AGENT_OAUTH_CLIENTS` | Clientes OAuth previamente registrados, quando necessário; JSON sem valores em pacotes |
| `AGENT_OAUTH_CIMD_ORIGINS` | Origens de metadados aprovadas; padrão ChatGPT e Claude; redirecionamentos de fetch não são seguidos |

Aplicar as migrations aditivas `20261026230000_agent_integrations` e
`20261026233000_agent_rate_limit` antes da ativação. O proxy existente encaminha
`/mcp`, `/oauth/*`, `/agent/interaction/*` e `/.well-known/*` ao NestJS; não ao Bun.
Não aplicar cache no ingresso. Sobrescrever Host e X-Forwarded-* no proxy confiável;
não permitir que clientes cheguem à API interna com cabeçalhos de proxy arbitrários.
Não substituir o issuer ou o resource pela origem interna do container.

OAuth é fornecido por oidc-provider 9.13.0, com CIMD draft-02 fixado no lockfile.
API passa a usar Node 22 nos Dockerfiles. Alterações de versões experimentais
exigem repetir os testes reais de conexão.

## Contrato e autorização

18 ferramentas: `connection_context`, `list_territory_types` e
`list/get/create/update` para `territory`, `block`, `street`, `house`.
As listagens retornam `data,total,page,limit` (tipos limitados a 100 registros).
Resultados MCP têm `structuredContent.result`, além de conteúdo textual.
Os schemas completos são descobertos por `tools/list`.

- `catalog:read`: consultas. `catalog:write`: criação e edição.
- Nenhuma entrada aceita `tenantId`, token, usuário ou papel de autorização.
- `streetId` e `get_street.id` identificam `territory_block_address`, não `address`.
- Escritas exigem `idempotencyKey`; editar exige `expectedVersion` da consulta.
  Chaves repetidas devolvem o resultado original por 24h. Reutilização com payload
  diferente é conflito. Versão é hash dos campos editáveis e dos pais relevantes.
- Edição de quadra não sincroniza arrays; renomear rua atua no vínculo e preserva
  casas e marcações. Quadra compartilhada exige revisão no Admin. Mesclar ruas não
  é oferecido. Tipo de território com casas/histórico não é alterável pelo agente.
- Casa criada usa `CatalogRoundService.attachHouse` sob lock da congregação e
  retorna `affectedRoundNumbers`. Pode abrir rodada do mesmo tipo automaticamente.
- As ferramentas não oferecem telefones, observações, credenciais, links de campo,
  dados financeiros nem marcações.

O endpoint valida o access token opaco destinado ao recurso. Cada ferramenta
revalida, em transação, concessão, usuário, tenant, senha e escopos. Revogação e
alteração da conta invalidam chamadas novas, inclusive tokens ainda não expirados.
O contexto pertence a uma requisição; não há estado global de tenant nem cache
de autorização. O JWT administrativo não é aceito no MCP.

Access tokens: 15min. Códigos: 2min. Refresh tokens rotativos e conexão:
máximo 30 dias. Reutilização de refresh token revoga a família.
Cookies/consentimento são ligados à interação; CSRF e alteração de tenant entre
exibição e autorização são rejeitados. CIMD aceita somente origens aprovadas.
MCP: 120 chamadas/min/conexão. OAuth: 300/min/origem de rede interna. Login:
10 tentativas/min/identificador. Contadores ficam no PostgreSQL, entre instâncias.

Auditoria guarda identificadores, ferramenta, data e resultado, sem conteúdo da
conversa. Limpeza horária: artefatos expirados, idempotência após 24h, auditoria
após 90 dias e metadados de conexões após 90 dias da expiração.

## Plugins e publicação

Fontes em `integrations/plugins`. `mcp.template.json` é template, não configuração
publicada. A identidade informada é Wilson Felipe da Silva; site fornecido e
verificado por HTTP: `https://td.territory-manager.com.br/`. O suporte público usa
o canal WhatsApp já divulgado nesse site. Distribuição confirmada pelo responsável:
Brasil (`BR`), sem cobrança pela integração. As ferramentas não oferecem compras
ou pagamentos; o manifesto declara `review.commerce: false`.

Depois que o endpoint estiver ativo:

```bash
node scripts/build-agent-plugins.mjs http://localhost:3001/mcp --local
# Somente após deploy coordenado e validação do domínio HTTPS:
node scripts/build-agent-plugins.mjs https://ORIGEM_DA_API/mcp
```

O gerador verifica metadados, identidade do recurso e desafio 401 antes de gerar.
Em produção verifica também as quatro páginas públicas sem login e preenche as
URLs reais no manifesto OpenAI. Produz pacotes e catálogo Claude em
`.agent-runtime/plugins/`, sem segredos ou fixtures. O modo local gera versões de
desenvolvimento para Codex/ChatGPT desktop e Claude, com cliente OAuth público
pré-registrado e PKCE. Esses pacotes HTTP locais não são pacotes de submissão pública.
No Codex desktop:

```bash
codex plugin marketplace add CAMINHO/.agent-runtime/plugins
codex plugin add territorio-digital@territorio-digital
```

No Claude: `claude plugin marketplace add CAMINHO/.agent-runtime/plugins`
e `claude plugin install territorio-digital@territorio-digital`.

Ainda são necessários antes de submissão pública: revisar o texto público de
privacidade/termos, disponibilizar conta
sintética de revisão no ambiente público e gravar demonstração real nos clientes.
O manifesto contém cinco casos positivos e três negativos; os prompts ainda devem
ser executados no ChatGPT e Claude contra o endpoint publicado. Os E2E de protocolo
não substituem essa evidência. Credenciais dos revisores só entram nos campos
privados do portal, nunca no ZIP.

## Validação e rollback

`bash scripts/test-agents.sh` cria PostgreSQL descartável em 5554, separado de 5544,
migra, gera Prisma e executa os testes novos. Para a suíte inteira:
`bash scripts/test-agents.sh test/`. O runner usa VM modules no Jest para o provider
ESM; o runtime normal não depende dessa opção. `npm run test:integration`, inclusive
no hook de pre-push, delega ao mesmo runner completo e isolado em 5554.
Unitários: `npm test -- --runInBand`.
Admin: typecheck, build e `npx playwright test -c playwright.integrations.config.ts`.
Campo: `bash dev/test-field.sh` no workspace, somente na congregação QA.
Evidências, resultados e limites da entrega local:
[agents-validation.md](agents-validation.md).

Deploy exige corte coordenado API/Admin/worker com as versões correspondentes.
Liberação gradual: configure `AGENT_MCP_ENABLED=true` e
`AGENT_MCP_ALLOWED_TENANT_IDS=1,23` na stack e recrie a API. A lista vazia
bloqueia todas as congregações. O tenant vem exclusivamente da conta autenticada;
nenhum parâmetro enviado pelo agente escolhe a congregação. A lista é validada
no login, no consentimento, na emissão/renovação de tokens e em cada operação.
A retirada de um ID bloqueia suas conexões existentes após a atualização da API,
sem apagar cadastros. O interruptor global continua prevalecendo.

O gerador local aceita a lista como quarto argumento:
`node scripts/setup-agents.mjs http://localhost:3001 http://localhost:4800 1,23`.
Sem esse argumento, o arquivo gerado mantém todos os tenants bloqueados.

Rollback inicial: desabilitar `AGENT_MCP_ENABLED` e recriar a API, preservando as
tabelas e as chaves. Revogar conexões quando necessário. Não remover tabelas nem
reverter alterações cadastrais já confirmadas automaticamente.

Fontes oficiais consultadas:
- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/deploy/submission
- https://code.claude.com/docs/en/mcp
- https://code.claude.com/docs/en/plugins/publish
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
