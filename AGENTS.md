# AGENTS.md

## Stack

NestJS (TypeScript) + Prisma/PostgreSQL. Sincronização mobile via long polling HTTP (`src/modules/field/`), nodemailer para e-mail e Firebase para uploads. O frontend ativo é o Admin, com área de campo própria; o Client antigo é referência. Aplicação single-package: `src/` é o app, `test/` tem os E2E.

## Comandos

- `npm run start:dev` — dev server
- `npm test` — unit tests (jest, `src/**/*.spec.ts`)
- `npm run lint` — eslint com `--fix`
- `npm run test:integration` — suíte E2E completa (sobe banco, migra, gera Prisma, testa, derruba). **Requer o plugin `docker compose` v2** — sem ele o script falha em silêncio e fica preso no `wait-on` por 2min.
- `npm run build` — `nest build`

## Testes E2E (integração)

Banco isolado de teste (compose interno usa **5433**; no workspace compartilhado use **5544** com `bash dev/test-api.sh` da raiz) (não usa o banco de dev). Config em `.env.test` (`JWT_SECRET=test_secret`, `PORT=3001`, `NODEMAILER_USER`/`NODEMAILER_APP_PASS` vazios).

Para rodar um arquivo específico, siga esta ordem obrigatória:

```bash
npm run test:db:up
npx wait-on tcp:127.0.0.1:5433 && sleep 2
npm run test:db:migrate
npx prisma generate
npm run test:e2e -- test/<arquivo>.e2e-spec.ts
npm run test:db:down
```

- `--runInBand` é essencial (já vem no script `test:e2e`); sem ele há concorrência no banco de teste.
- Testes são escritos em **pt-BR**, máx. 4–5 por arquivo.
- Os E2E mockam `FirebaseService` via `test/utils/app-helper.ts`; tokens são gerados com `createTestToken` (test/utils/auth-helper.ts).
- Extensão `pg_trgm` é criada no `beforeAll` dos testes que usam similaridade.

### Testes com e-mail (SKIP)

Três testes dependem de credenciais SMTP reais (`NODEMAILER_USER`/`NODEMAILER_APP_PASS`) e estão marcados como **`it.skip`** — não rodam na suíte normal:

- `test/auth.e2e-spec.ts` → `should register a new admin successfully`
- `test/auth.e2e-spec.ts` → `should register a new user and tenant successfully`
- `test/password-recovery.e2e-spec.ts` → `should trigger forgot-password for Wilson`

Rode-os manualmente (removendo o `skip`) **apenas quando o fluxo de e-mail/registro/recuperação for alterado**. Envios de e-mail em endpoints que retornam 500 com credenciais vazias são comportamento esperado no ambiente de teste — não é regressão.

## Hooks

- **Pre-push (husky)** roda `npm run test:integration` em todo push — a suíte E2E inteira é requisito para publicar.
- CI publica imagem Docker no push para `master` (`.github/workflows/ci.yml`) e `acp` (`.github/workflows/ci.acp.yml`).

## Prisma

- Migrations em `prisma/migrations`; aplicar com `npm run test:db:migrate` (env de teste) ou `npx prisma migrate deploy`.
- `npx prisma generate` é necessário após mudar `prisma/schema.prisma`.
- Scripts utilitários em `scripts/` (ex.: `validate-leave-letter.ts`, `migrateParameters.ts`).

## Área de campo (frontend unificado)

- Contratos, sincronização e corte de tráfego: `docs/field-http.md`.
- Links novos usam seis caracteres alfanuméricos; UUIDs antigos continuam válidos até expirar.
- `FieldAccessService` valida assinatura e escopo das rotas de dirigente/publicador. Não confiar em IDs enviados pelo frontend.
- Revisões são mantidas por triggers SQL, na mesma transação dos dados, inclusive alterações administrativas. Preservar triggers/índices parciais/view ao criar migrations.
- `socket` é somente histórico; presença atual usa `field_session` com prazo de 60 segundos.
- A integração PayPal foi desacoplada em `src/modules/paypal/`; não há gateways WebSocket.
- Os E2E exigem banco `territory_manager_test`; o limpador bloqueia qualquer outro nome.
- Solicitações e catálogo sem rodada: `docs/change-requests.md`. Revisões usam
  versões, locks e comparação com o estado atual; preservar a proteção contra
  edições administrativas concorrentes e a confirmação de impacto de exclusão.

## Casas provisórias e carga

Casas provisórias podem trabalhar antes da revisão, inclusive sob pais provisórios.
Cadastro sem rodada aberta compatível inicia rodada padrão do mesmo tipo em toda a
congregação, sob o mesmo lock da criação manual. Aprovação preserva marcações;
rejeição de inclusão apaga cadastro/marcações após confirmação de impacto atual.
O compose em `load-tests/compose.yml` usa duas APIs somente no teste, banco
`territory_manager_load` sintético e limites fixos. Nunca apontar k6 ao banco/link
restaurado. `FIELD_POLL_CHECK_MS` configura a verificação; espera HTTP permanece 25s.
