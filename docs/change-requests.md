# Solicitações de endereços e catálogo independente de rodada

## Domínio

`change_request` mantém proposta, estado anterior, autor, origem do link,
dependência, versão e histórico de revisão. Os IDs das solicitações são distintos
dos IDs dos cadastros. As entidades são `block`, `street` e `house`; as operações
são `create`, `update` e `delete` (quadra permite cadastro).

Inclusões criam o cadastro real com `registration_status=pending`. Assim, uma
quadra pode receber ruas, casas e link de publicador imediatamente. A aprovação
publica os mesmos IDs. Rejeitar uma inclusão rejeita os descendentes pendentes e
remove os cadastros provisórios e suas marcações, preservando o histórico das solicitações.
Uma rua rejeitada pode ser reenviada com um novo vínculo.

Correções e exclusões são propostas: não alteram o catálogo nem bloqueiam casas
existentes enquanto aguardam análise. Há no máximo uma solicitação pendente por
cadastro. A revisão compara o cadastro atual com a cópia registrada ao solicitar;
uma alteração concorrente exige nova avaliação. A comparação normaliza as chaves
JSON, pois JSONB não preserva a ordem das propriedades.

## Permissões e escopo

- Administrador revisa somente a própria congregação.
- `signature.can_edit_structure` nasce desabilitado e é controlado apenas pelo
  administrador, inclusive em links já emitidos. Habilita quadras e ruas para o
  dirigente. A permissão é consultada no banco, não confiada ao navegador/JWT.
- Casas podem ser relatadas por dirigente e publicador independentemente da
  permissão estrutural, sempre no território/quadra/rua autorizados.
- Links sem `round` exibem o catálogo e acompanham a última rodada aberta do tipo
  do território. Links com rodada numérica preservam o contexto fixo.

## Rodadas e trabalho

`round_info` persiste `status`, `type_ids`, início e encerramento, mesmo quando não
há casas. Iniciar uma rodada vazia é permitido; o número é o maior existente mais
um. Rodadas legadas com múltiplos tipos preservam todos esses tipos.

A leitura de campo parte de `house`, não de `round`. Casas provisórias recebem
participação imediatamente e podem ser marcadas mesmo sob quadra/rua provisória.
Enquanto pendentes e não marcadas ficam cinza, com indicador de análise. Casas
sem participação continuam cinza e indisponíveis para marcação.
Se não houver rodada aberta compatível no cadastro de casa, a transação inicia
uma rodada padrão, incluindo casas elegíveis do mesmo tipo em toda a congregação.
O lock da congregação serializa cadastros e criação manual, evitando duplicação.
Links numéricos preservam seu contexto e rodadas encerradas não são reabertas.
`createMany(skipDuplicates)` na aprovação preserva participação, marcação e prazo.
A migration `20261024210000_provisional_house_work` vincula provisórias existentes
somente quando já houver rodada aberta compatível, sem iniciar rodada na migração.

## Revisão e exclusão

`POST /v1/change-requests/review` recebe decisão e itens `{id, version}`. Uma
transação bloqueia a congregação e os territórios em ordem, valida todo o lote e
aplica os pais antes dos filhos. Aprovação individual de filho exige pai aprovado.
Rejeitar um pai com filhos também selecionados não revisa os filhos duas vezes.

Alterar rua mantém o ID de `territory_block_address` e move somente as casas desse
vínculo para outro endereço; um `address` compartilhado não é renomeado globalmente.
Excluir rua remove fisicamente suas casas e rodadas somente no território/quadra
da solicitação. Solicitações pendentes das casas removidas são encerradas no
histórico. Um endereço ainda usado em outro vínculo permanece intacto.

O detalhe fornece impacto `{houses, rounds, token}`. Exclusões exigem
`confirmDeletion=true` e `impactToken` por item, conferidos novamente dentro da
transação. Se o conjunto de casas/rodadas mudar, a operação retorna 409 sem aplicar
o lote. Rejeitar qualquer inclusão também exige confirmação. O token inclui
marcações/datas das rodadas e é conferido sob lock das participações; novos cliques
exigem reconferência. Rejeitar pai remove dependentes somente no seu escopo.
Rejeitar correção de casa aprovada preserva seu cadastro e trabalho.

## HTTP e sincronização

- `POST /v1/change-requests`: solicitar.
- `GET /v1/change-requests`: paginação, filtros por estado, entidade, operação,
  território e período; campo limitado ao escopo do link.
- `GET /v1/change-requests/:id`: antes/proposta/atual, dependências, histórico e impacto.
- `GET /v1/change-requests/sync?cursor=...`: revisão da congregação e contagem pendente;
  long polling de até 25 segundos, cancelado ao desconectar.
- `PATCH /v1/signature/:code/permissions`: permissão estrutural administrativa.
- `GET /v1/territories/:id/signature`: link de catálogo atual (sem rodada).
- `/v1/reports`: adaptador de casas para compatibilidade. `id` identifica a
  solicitação; `houseId` identifica a casa. Aprovações/exclusões seguem as regras novas.

Revisões de catálogo usam `field_revision.round_number=0`. Triggers atualizam os
cursores dentro da transação de cadastro/revisão, inclusive antes de existir uma
rodada. Cada tela de campo mantém um único long polling. O Admin compartilha um
long polling entre a central e o contador de solicitações. Abort, pausa quando a
aba fica oculta e reconexão progressiva evitam consultas paralelas desnecessárias.

## Migração e validação local

`20261024190000_change_requests_catalog` importa os relatos antigos sem reverter
ou apagar casas/rodadas. Marca `is_legacy`, conserva backup e proposta na tabela
nova e mantém a data original desconhecida como nula. Revisar legado conserva a
semântica anterior: aprovação mantém a casa existente, rejeição restaura os campos
do backup ou remove a inclusão com confirmação explícita. Marcações não são resetadas.

Antes da aplicação local, foi restaurado um backup custom em banco separado na
porta 5544 e executado `prisma migrate deploy`. Evidência de 24/10/2026:

| Verificação | Antes | Depois |
|---|---:|---:|
| Casas | 60.921 | 60.921 |
| Registros de rodadas | 485.232 | 485.232 |
| Marcações concluídas | 111.316 | 111.316 |
| Relatos antigos / solicitações importadas | 459 | 459 |

O hash agregado dos backups permaneceu igual. Foram preservadas 26 rodadas com
múltiplos tipos e identificadas 23 rodadas sem participação como `uninitialized`.
O backup fica fora do Git, em `../backups/`, e contém dados reais: não publicar.

As suítes `change-request-tree` e `change-request-review` usam exclusivamente
`territory_manager_test`. A validação visual usa a congregação `QA Frontend
Unificado` no banco local; não altera casas das congregações restauradas.
