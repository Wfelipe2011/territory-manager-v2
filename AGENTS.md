# Territory Manager

NestJS 10 + Prisma + PostgreSQL API for managing congregation territories (WebSocket presence, ephemeral signature links, multi-tenancy). See `README.md` for product context and `docs/REALTIME_INVESTIGATION.md` for the real-time layer deep-dive.

## Environment

- **Node**: v20 (see `.nvmrc`).
- **TZ**: hardcoded to `America/Sao_Paulo` in `src/main.ts:16` — ignore host TZ.
- **`.env`** is committed to the repo (dev placeholders); copy from `.env.example` for your own overrides. Never log JWT/API secrets.
- **Winston logging**: Console always; AWS CloudWatch transport is added only when `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are both set (`src/app.module.ts:64`).
- **Body parser limit**: 10mb (json + urlencoded). Raise here if uploading larger spreadsheets.

## Commands

| Task | Command |
|---|---|
| Dev (local, watch) | `npm run start:dev` |
| Dev (full Docker stack) | `npm run docker:app:dev` |
| Lint (with autofix) | `npm run lint` |
| Format | `npm run format` |
| Unit tests | `npm run test` |
| E2E full cycle (db up → migrate → test → db down) | `npm run test:integration` |
| Prisma Studio | `npm run prisma:studio` |

`npm run build` uses `nest build` (swc builder, `typeCheck: true` — strict TS errors fail the build). `nest-cli.json` also copies `views/**` and `public/**` into `dist/`; keep these folders referenced relatively.

## E2E testing — required order

The test DB is a `tmpfs` Postgres 13.2 container on port `5433`, completely separate from dev DB. Do these in order:

1. `npm run test:db:up`
2. `npx wait-on tcp:127.0.0.1:5433 && sleep 2`
3. `npm run test:db:migrate` (runs `prisma migrate deploy`)
4. `npx prisma generate` (needed before the suite, see `scripts/test-integration.sh:14`)
5. Run tests: `npm run test:e2e -- test/<file>.e2e-spec.ts` (single file) or `npm run test:e2e` (full suite)
6. `npm run test:db:down`

`--runInBand` is mandatory (see `test:e2e` script) — parallel suites will corrupt the shared DB. Tests live in `test/*.e2e-spec.ts`; the helper utilities are in `test/utils/` (`db-cleaner.ts` truncates all tables except `_prisma_migrations`).

The `pg_trgm` extension is created in `beforeAll` of the test files (not via migrations) — re-create the container if you see similarity errors.

## Architecture quirks

- **Multi-tenancy**: every domain table has `tenantId`; isolation is enforced by `PrismaConnectionMiddleware` (`src/infra/prisma/prisma-connection.middleware.ts`), wired globally in `src/app.module.ts:164`. Tenant context is set per-request — don't bypass it with raw SQL.
- **PgBouncer**: dev compose uses `session` pool, prod uses `transaction` pool (`docker-compose.yml:14`). Prisma `DATABASE_URL` goes through PgBouncer; `DIRECT_URL` (set via `DIRECT_URL` env) bypasses it and is required for `prisma migrate`. App code uses the pooled URL.
- **Legacy routes**: `transactions.controller.ts` and `transactions.service.ts` sit at `src/` root, outside any module — keep them there when editing.
- **Migrations**: `prisma/migrations/` is the source of truth. Use `prisma migrate dev --name <name>` locally; CI/dev compose uses `migrate deploy`.
- **Views/static**: `views/` (Handlebars templates + `partials/` subfolder), `public/` static assets — both are wired in `src/main.ts:39-42`.
- **Swagger UI**: `/api` (URI versioning enabled in `src/main.ts:35`).
- **WebSocket**: `socket.io` v4 with JWT auth (`src/modules/gateway/`). Real-time layer is single-instance only — no Redis adapter (see `docs/REALTIME_INVESTIGATION.md`). Don't propose scale-out without revisiting that doc.
- **Cron**: `@nestjs/schedule` only; no `pg-boss`/queue system.

## Conventions

- **ESLint** (`@typescript-eslint` + `standard` + `prettier`):
  - `max-len: 160`, `max-params: 3` (warn).
  - Import order is enforced via `import-helpers/order-imports`: groups are `module` → `@shared` → `parent/sibling/index`, alphabetical within group, newline between groups.
  - `space-before-function-paren`: `asyncArrow: always`, `anonymous: always`, `named: never`.
- **Tests**: pt-BR, max 4–5 cases per file (per `.github/copilot-instructions.md`); split when growing.
- **Coverage**: only collected when `CI=true`; ignored paths are `interfaces/`, `entities/`, `dtos/`, `infra/`.
- **Pre-push hook**: `npm run test:integration` runs automatically before `git push` — expect slow pushes. Bypass with `git push --no-verify` only when justified.
- **Commits**: conventional (`feat:`, `fix:`, `refactor:`, `chore:`, etc.) — visible across recent log.

## Spec workflow

Specs and changes live under `openspec/`. Skill definitions are duplicated at `.github/skills/openspec-*` and `.codex/skills/openspec-*` (`SKILL.md`). Use the explore → propose → apply → archive flow when adding/changing behavior; do not edit code without a corresponding change entry.

## CI

- `.github/workflows/ci.yml` — pushes Docker image `wfelipe2011/territorio-digital-prod` on push to `master`.
- `.github/workflows/ci.acp.yml` — pushes `…-acceptance` on push to `acp`.
- Both build from `Dockerfile.production`; do not break that Dockerfile or the prod compose when refactoring.

## Versionamento

A versão da API é exposta no endpoint `GET /v1/dashboard/health` (campo `version`) e lida diretamente de `package.json`.

- **Ferramenta**: `standard-version` (devDep).
- **Padrão**: SemVer (`MAJOR.MINOR.PATCH`), tag prefixada com `v` (ex: `v1.2.3`).
- **Conventional Commits** (mapeamento automático):
  - `feat:` → MINOR
  - `fix:`, `perf:` → PATCH
  - `feat!:`/`BREAKING CHANGE:` → MAJOR
  - `docs:`, `chore:`, `refactor:`, `test:`, `ci:`, `build:`, `style:` → não bumpam
- **Automatização**: o workflow `ci.yml` (e `ci.acp.yml`) roda `npx standard-version` em todo push para `master` ou `acp`, gerando tag `vX.Y.Z` + commit `chore(release): v{{currentTag}}` + `CHANGELOG.md` automaticamente. O push da tag é feito com `--follow-tags`.
- **Loop infinito evitado**: o step de bump está protegido pelo `if: "!contains(github.event.head_commit.message, 'chore(release)')"` — o commit gerado pelo `standard-version` não dispara novo bump.
- **Comandos úteis**:
  - `npm run release:dry` — preview do próximo bump sem alterar nada.
  - `npm run release` — bump manual local (não commita tag; só com `git push --follow-tags`).
  - `npm run release:first` — força uma primeira tag `v1.0.0` se o repo nunca usou.
- **Primeira release**: como o repositório já tem `1.0.0` em `package.json`, rode `npm run release:first` uma vez para criar a tag `v1.0.0` antes do CI começar a funcionar.

## Files an agent usually misses

- `src/main.ts` — bootstraps cookies, version, swagger, body limits, hbs.
- `src/infra/envs.ts` — central env access (no `dotenv` import here; loaded once in `main.ts`).
- `src/middleware/all-exceptions.filter.ts` — global error handling (requires `TraceService`).
- `src/transactions.controller.ts` — orphan controller outside any module.
- `scripts/test-integration.sh` — exact orchestration order for tests; mirror it when scripting custom runs.
- `.husky/pre-push` — auto-runs integration tests on push.
- `.versionrc.json` — config do `standard-version` (mapeamento de tipos, formato de commit, skip).
