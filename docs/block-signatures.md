# Links de quadra por rodada

O vínculo de acesso de publicador é `block_signature`, único por congregação,
vínculo território/quadra e rodada. `round_number=0` representa o cadastro sem
rodada fixa; não representa a rodada atualmente resolvida para marcações.
O campo legado `territory_block.signature_id` permanece para importação e auditoria,
mas os novos links são escritos somente na associação por rodada.

## Contratos

- POST `/v1/territories/:territoryId/blocks/:blockId/signature/:round` e variante
  sem `/:round`: cria ou retorna o link válido do mesmo escopo, sem renovar prazo.
  Mantém HTTP 201 e `{signature, expirationDate}` em criação e repetição.
- Dirigentes usam a rodada de sua credencial, incluindo `null` para cadastro.
  Não podem escolher o escopo pelo corpo, query ou path. Rodada encerrada não
  permite criar/reemitir links. Tipo, tenant e permissões continuam verificados.
- DELETE da quadra sem rodada: dirigente revoga somente seu escopo; administrador
  revoga todos os escopos dessa quadra. A variante `/:round` permite ao administrador
  revogar somente uma rodada. O path é validado também pelo guard de campo.
- DELETE `/v1/territories/:territoryId/signature/:round`: administrador revoga os
  dirigentes e publicadores dessa rodada. A variante sem rodada mantém a operação
  administrativa geral, abrangendo também o cadastro sem rodada.
- Encerrar rodada revoga dirigentes e filhos dessa rodada na mesma transação,
  inclusive quando o dirigente já expirou ou foi removido. As demais rodadas ficam
  intactas. A geração e o encerramento são serializados por locks de território.
- Snapshots, consultas legadas e worker retornam apenas o link correspondente ao
  escopo da credencial. Os tokens não entram no read model persistido. Triggers
  transacionais mantêm revisões de território/quadra e notificações após commit.

## Migração e publicação

Migration aditiva `20261027130000_block_signatures_per_round`:

1. Backup validado, imagens compatíveis de API/worker/Admin e janela coordenada.
2. Executar com a conexão do ambiente, sem imprimir credenciais:
   `node scripts/check-legacy-block-signatures.cjs`.
   É somente leitura; saída contém contagens e IDs de vínculos, nunca códigos/JWTs.
   `ready: false` / exit 2 exige revisar os IDs relatados antes da migração.
3. Pausar tráfego e aplicar `prisma migrate deploy`. A migração repete a verificação
   dentro de sua transação e aborta em vínculo legado ativo inconsistente. Importa
   a rodada dos claims legados sem alterar código, token, vencimento ou marcações.
   Claims são usados apenas para classificar a associação; autenticação continua
   verificando assinatura JWT e validade em cada acesso. Vínculos expirados
   inconsistentes permanecem preservados no campo legado e não são importados.
4. Subir API e worker da mesma revisão e Admin compatível. O worker exige as
   migrations de read model e de assinaturas antes de iniciar. Rebuild obrigatório.
5. Validar em tenant QA: coexistência de duas rodadas, reenvio do mesmo link,
   revogação isolada, snapshot via worker e propagação de mudanças. Conferir
   healthchecks e listener antes de reabrir tráfego.

Não executar limpeza global de UUIDs, reatribuir links antigos à rodada atual ou
alterar o prazo dos acessos existentes. Não atualizar o campo legado ao gerar um
novo link: um ponteiro único não representa várias rodadas.

Rollback de tráfego para o NestJS **desta versão** é suportado, conservando a tabela
aditiva. Não voltar a imagens que usam somente `territory_block.signature_id` após
criar links por rodada: isso esconde links novos e pode revogar a rodada errada.
Não excluir tabelas nem restaurar dump sobre marcações novas como rollback rotineiro.

## Testes

Da raiz da API:

```bash
npm --prefix field-worker ci --ignore-scripts
bash scripts/test-agents.sh test/block-signatures-rounds.e2e-spec.ts test/block-signatures-migration.e2e-spec.ts test/block-signatures-worker.e2e-spec.ts
node --test field-worker/tests/*.test.cjs
npm run build
```

O runner usa PostgreSQL descartável em 5554 e banco `territory_manager_test`.
O teste de migração recria somente a associação nova nesse banco isolado e verifica
aborto transacional com legado inconsistente antes de importar um UUID válido.
A equivalência cobre API/pg/SQL agregado/read model, rodadas distintas, cadastro,
expiração e revogação. Browser QA: `bash dev/test-field.sh` na raiz do workspace.

Para reproduzir o caso no navegador, após preparar o tenant QA com
`dev/test-field.sh`, executar o seed local `scripts/seed-block-signatures-demo.ts`
na API, salvar a última linha JSON em arquivo temporário com modo 600 e informar
`BLOCK_SIGNATURES_DEMO_FILE` ao executar
`npm run test:e2e -- tests/field/block-signatures.spec.ts` no Admin.
A fixture cria apenas cadastros identificados como QA no tenant de demonstração.
