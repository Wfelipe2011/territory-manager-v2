# AGENTS.md

## Stack

NestJS (TypeScript) + Prisma/PostgreSQL. Socket.io (`src/modules/gateway/event.gateway.ts`) para tempo real, nodemailer para e-mail, Firebase para uploads. Aplicação single-package: `src/` é o app, `test/` tem os E2E.

## Comandos

- `npm run start:dev` — dev server
- `npm test` — unit tests (jest, `src/**/*.spec.ts`)
- `npm run lint` — eslint com `--fix`
- `npm run test:integration` — suíte E2E completa (sobe banco, migra, gera Prisma, testa, derruba). **Requer o plugin `docker compose` v2** — sem ele o script falha em silêncio e fica preso no `wait-on` por 2min.
- `npm run build` — `nest build`

## Testes E2E (integração)

Banco isolado em container Postgres na porta **5433** (não usa o banco de dev). Config em `.env.test` (`JWT_SECRET=test_secret`, `PORT=3001`, `NODEMAILER_USER`/`NODEMAILER_APP_PASS` vazios).

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
- Os E2E mockam `FirebaseService` e `EventsGateway` via `test/utils/app-helper.ts`; tokens são gerados com `createTestToken` (test/utils/auth-helper.ts).
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