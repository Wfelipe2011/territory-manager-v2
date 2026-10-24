# Área de campo: links curtos e sincronização HTTP

O frontend ativo é `admin-territory-manager`. O repositório antigo do Client serve
como referência. Não há gateways Socket.IO na API.

## Acesso

- A geração de território/quadra mantém os endpoints existentes e retorna
  `{ signature, expirationDate }`. Novos códigos são `[A-Z0-9]{6}`, únicos em todos
  os tenants, gerados com `crypto.randomInt`. Colisões têm até dez tentativas.
- `GET /v1/signature/:code` aceita códigos curtos sem distinção de caixa e UUIDs
  antigos enquanto válidos. Retorna `{ token, roundInfo, access }`, sem cache,
  limitado a 30 consultas/minuto/IP.
- `access` contém `code`, `role`, `territoryId`, `blockId`, `round`, `expiresAt` e
  `overseer`. O JWT continua sendo validado pela API; o contexto do frontend não
  constitui autorização.
- `FieldAccessService` verifica a assinatura ativa e seus claims, tenant,
  território, rodada, quadra, rua, casa e vínculo normalizado em todas as rotas
  privadas acessadas por dirigentes/publicadores. O dirigente só gera links no
  território/rodada recebidos; o publicador não gera links nem acessa o Admin.
- Geração/revogação usa locks por território; criação de acesso derivado confere
  novamente o dirigente dentro da transação, inclusive durante revogação concorrente.

## Long polling

### Quadra completa (tela de ruas com accordion)

`GET /v1/field/blocks/:blockId/sync?clientId=...&tabId=...&cursor=...`
usa o mesmo controle de escopo, presença e espera de 25 segundos descrito abaixo.
O snapshot contém `territory`, `roundInfo`, `tenancy`, `block` e `streets[]`.
Cada rua inclui `id`, `name`, `completed`, `pending`, `firstNumber`, `lastNumber`
e `houses[]`; ruas sem casas também são retornadas. Não duplica casas em outra
lista nem faz consultas individuais por rua. Expandir ruas é uma ação local.

Cada casa inclui `canMark`, `canUnmark`, `blockedReason` (null, `dont_visit`,
`pending_approval`, `no_round`, `closed_round` ou `unmark_window_expired`) e `canUnmarkUntil`.
O cálculo é compartilhado com a validação da escrita. Preserva o prazo legado:
`diff(completedDate, 'hours') > SIGNATURE_EXPIRATION_HOURS`, com padrão de cinco
horas; como a diferença usa horas inteiras, o bloqueio começa em seis horas
completas na configuração padrão. O limite absoluto é enviado ao navegador.

O cursor da quadra completa inclui a configuração de prazo para detectar mudanças
de parâmetro no próximo polling, mesmo sem revisão de casa. Prazos que vencem
apenas pela passagem do tempo são bloqueados pelo navegador usando
`canUnmarkUntil`, que dispara uma atualização sem cursor. A escrita sempre
revalida a permissão atual. Nenhuma migration adicional é necessária.

### Endpoint compatível anterior

`GET /v1/field/sync`, com `Authorization: Bearer <token>`:

| Parâmetro | Uso |
| --- | --- |
| `scope` | `territory`, `block` ou `street` |
| `blockId` | Obrigatório para quadra/rua; publicador usa sua própria quadra |
| `addressId` | Obrigatório para rua |
| `clientId` | Identificação aleatória do navegador, entre 16 e 64 caracteres |
| `tabId` | Identificação aleatória da aba, entre 16 e 64 caracteres |
| `cursor` | Revisão recebida anteriormente; omitir para obter snapshot completo |

Sem cursor, ou com revisão diferente, retorna
`{ cursor, changed: true, data, presence }`. `data` contém território, rodada,
congregação, quadras e os dados da tela selecionada. Sem mudanças, aguarda até
25 segundos e retorna `{ cursor, changed: false, presence }`.

O navegador mantém uma consulta por tela, timeout de 35 segundos, reconexão
progressiva entre 1 e 15 segundos e pausa em segundo plano/sem rede. Marcações
suspendem snapshots durante a escrita e reconciliam o estado após a resposta.
Não existe fila offline nem confirmação de sucesso antes da resposta HTTP.

As revisões são persistidas em `field_revision`. Triggers PostgreSQL atualizam
as revisões na mesma transação das marcações, alterações administrativas,
solicitações, metadados e compartilhamentos, incluindo quadras vazias. Alterações
em lote de `round` são agrupadas por escopo usando transition tables. A API
consulta revisões a cada `FIELD_POLL_CHECK_MS` (padrão 2000 ms) e compartilha essas consultas por escopo
dentro de cada processo. Snapshots usam transações curtas `RepeatableRead`, sem
cache antigo. Nenhuma conexão/transação fica aberta durante a espera de 25 segundos.

## Presença e histórico

`field_session` registra períodos de atividade por navegador/aba. Presença exige
assinatura válida e atividade nos últimos 60 segundos; várias abas contam como
um navegador no mesmo escopo. `DELETE /v1/field/session?clientId=...&tabId=...`
encerra a sessão por melhor esforço. O prazo continua válido mesmo se a aba fechar
sem enviar o DELETE.

`field_session_history` reúne as sessões HTTP e o histórico preservado de `socket`.
A migração encerra sessões legadas que ainda estavam abertas no corte. O health
check expõe `activeSessions` e conserva `sockets` como alias de compatibilidade.

## Validação e publicação

- E2E cobrem códigos/colisões/concorrência, UUIDs, escopos, revogação, expiração,
  duas instâncias da aplicação, timeout, rollback, presença, quadras vazias e histórico.
- No workspace, `bash dev/test-api.sh` usa PostgreSQL isolado na porta 5544.
  O limpador recusa qualquer banco cujo nome não seja `territory_manager_test`.
- Aplicar migrations e publicar a API juntamente com o Admin antes do corte de
  tráfego. Durante uma publicação gradual, manter o release anterior da API e
  o Client antigo juntos até o novo par API/Admin estar validado.
- No corte, os dois domínios devem apontar para o mesmo deploy do Admin. O host
  `app.territory-manager.com.br` redireciona para o domínio administrativo e
  `/home?s=UUID&p=...` resolve somente `s`, ignorando o destino antigo `p`.
- Retirar o serviço/deploy antigo do Client no proxy/Portainer depois de mudar
  o tráfego. A alteração de DNS/proxy e a publicação em produção não são feitas
  automaticamente pelos scripts locais.
- Reverter aplicação exige restaurar API e frontend anteriores juntos. As
  tabelas novas são aditivas; não apagar `socket`, assinaturas ou dados de campo.
  Antes de reverter para uma API que não mantém revisões, retirar o tráfego da
  área nova. Preservar migrations e backup até encerrar a validação.

## Solicitações e catálogo sem rodada

O catálogo e as permissões estruturais foram ampliados em [change-requests.md](change-requests.md). Casas sem participação aparecem em cinza; correções pendentes preservam o trabalho. Links sem rodada acompanham a última rodada aberta compatível.
