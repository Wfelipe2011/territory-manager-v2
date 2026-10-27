# Validação local de MCP e plugins — 27/10/2026

Escopo: integração de administradores com cadastro de territórios, quadras, ruas e
casas; OAuth, isolamento entre congregações, páginas públicas e revogação. Ambiente
local do workspace, sem deploy de produção ou submissão a diretórios.

## Comportamento verificado

| Módulo | Evidência | Limite da conclusão |
| --- | --- | --- |
| OAuth | Login real em navegador, consentimento com nome da congregação, callback nativo com PKCE e troca do código | Cliente sintético local; não é uma sessão no ChatGPT ou Claude Code |
| MCP | Inicialização, descoberta das 18 ferramentas e chamada autenticada | Transporte HTTP local pelo proxy em 3001 |
| Isolamento | IDs e relações de outra congregação são recusados, inclusive nas rotas REST compartilhadas; cache autenticado separado | Testes com duas congregações sintéticas |
| Escritas | Cadastro completo, idempotência concorrente, rejeição de versão antiga, preservação de casas e marcações ao corrigir rua | Sem exclusões, importações ou movimentação de pais |
| Ciclo de credenciais | Renovação, replay de refresh token, revogação, mudança de senha e de vínculo de usuário | Verificação por requisição, com tokens opacos e artefatos persistidos |
| Gestão | Listagem e revogação pela interface; access token revogado passa a receber 401 | Cookie administrativo permanece igual durante o OAuth |
| Informações públicas | Apresentação, privacidade, termos e suporte sem login; sessão inválida não fecha as páginas públicas | Textos implementados localmente, ainda não publicados no domínio HTTPS |
| Pacotes | ZIP Claude local inspecionado, com manifesto, MCP e skill; sem chaves ou contas de teste | CLI Claude não instalada; templates OpenAI dependem do endpoint público |

## Reprodução e evidências

Na API:

```bash
npm test -- --runInBand
npm run build
bash scripts/test-agents.sh test/
node scripts/build-agent-plugins.mjs http://localhost:3001/mcp --local
```

O runner cria PostgreSQL descartável em 5554, aplica migrations e executa os E2E
em lotes de quatro suítes. A transformação de imports ESM é restrita ao bridge do
provider OAuth; imports dinâmicos dos testes antigos continuam compatíveis.

No Admin:

```bash
npm run build
AGENT_DEMO_FILE=/CAMINHO_PRIVADO/demo-accounts.json PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npx playwright test -c playwright.integrations.config.ts
```

No workspace: `bash dev/test-field.sh`. Apenas fixtures QA foram usadas nas
mutações. A validação de interface usa o Playwright existente com Chrome headless.
Os testes OAuth desabilitam traces de rede para não registrar senhas ou tokens.

Logs locais ficam em `territory-manager-v2/.agent-runtime/` (ignorado no Git):
`unit-tests.log`, `api-build-final.log`, `admin-build-final.log`,
`full-e2e-verified.log`, `mcp-final.log`, `browser-verified.log`, `field-browser-final.log` e
`field-browser-retry.log`. Capturas das páginas públicas e da gestão ficam em
`admin-territory-manager/test-results-integrations/`.

Builds API e Admin passaram. Unitários: oito suítes, 34 testes aprovados.
A suíte E2E completa da API terminou com 49 suítes aprovadas, 245 testes aprovados
e três testes ignorados. As cinco verificações de navegador da integração passaram:
OAuth/MCP/revogação, navegação pública, proteção da gestão e telas em 360/1280px.
Após corrigir a renderização da página de erro OAuth, os dez testes específicos
de MCP e isolamento passaram novamente, incluindo a recusa legível de cliente
OAuth não registrado, sem armazenamento em cache.
O build do Admin mantém três avisos de dependências de hooks em componentes
anteriores, fora das páginas de integração. O Compose local foi validado; o
manifesto de produção teve sua sintaxe validada com valores fictícios, sem aplicar
configurações ou conectar a serviços externos.

Na regressão de campo, 39 de 41 casos passaram inicialmente; dois casos visuais
excederam o tempo durante execução simultânea de builds. Ambos passaram na repetição
isolada, sem mudança no produto. Uma execução anterior teve colisão entre diretórios
de traces; os testes de integração agora usam uma saída própria.

## Revisão de cores

Revisão visual de 27/10: páginas públicas usam uma paleta verde com variáveis
limitadas ao layout de integrações, com texto, bordas, botões e fundos coerentes.
Quatro testes de navegação/responsividade passaram em 360/1280px; lint dos cinco
componentes sem avisos. Contraste medido no navegador: 5,32:1 no botão principal e
6,17:1 no texto de apresentação. A classe `dark` externa preserva essa paleta clara.
Logs: `integration-colors-tests.log` e `integration-colors-lint.log` na pasta local
`.agent-runtime/`; capturas mais recentes em `test-results-integrations/` do Admin.

A revisão seguinte abrangeu a gestão autenticada `/gestao/integracoes`, identificada
na captura do usuário: cartões brancos, endereço MCP destacado, estados de conexão
e ausência de conexões apresentados visualmente. A paleta agora é compartilhada
pelas páginas públicas e pela gestão. Capturas do estado vazio com resposta sintética
foram conferidas em 1366/390px, sem rolagem horizontal; o fluxo OAuth/MCP/revogação
também passou contra a API real usando a conta QA. Lint dos componentes alterados
sem avisos. Uma execução pública recebeu 500 durante recompilação do Next dev;
a conferência final passou nos cinco casos e está registrada em
`integration-management-ui-verified.log`.

## Pendências para publicação pública

1. Corte coordenado de API, Admin e worker, com HTTPS, chaves persistentes privadas,
   migrations e encaminhamento correto do proxy; repetir descoberta e conexão no
   domínio real. O MCP permanece desabilitado por padrão sem configuração.
2. Conferência dos textos públicos pelo responsável. Identidade informada:
   Wilson Felipe da Silva, pessoa física. Distribuição e cobrança já confirmadas:
   Brasil (`BR`), sem cobrança pela integração; ferramentas sem compras ou pagamentos.
3. Executar os cinco casos positivos e três negativos nos clientes de destino;
   gravar demonstração real e preparar acesso sintético para revisores. Credenciais
   de revisão devem ficar somente em campos privados do portal.
4. Gerar e verificar o pacote público com as URLs HTTPS reais, completar a
   verificação do desenvolvedor e os requisitos do portal. Não houve upload,
   submissão para revisão ou publicação de plugin nesta entrega local.

Configuração, contratos e fontes oficiais: [agents-mcp.md](agents-mcp.md).
