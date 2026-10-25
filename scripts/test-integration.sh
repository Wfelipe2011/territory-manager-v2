#!/bin/bash

# The shared workspace reserves 5433 for another project. Its runner executes
# this same E2E suite against an isolated PostgreSQL on 5544 instead.
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$PROJECT_ROOT/../dev/test-api.sh" ]]; then
  exec bash "$PROJECT_ROOT/../dev/test-api.sh"
fi

# Sobe o banco de dados
npm run test:db:up

# Aguarda o banco estar pronto
npx wait-on tcp:127.0.0.1:5433
sleep 2

# Roda as migrações
npm run test:db:migrate

# Gera os clientes do Prisma
npx prisma generate

# Executa os testes e captura o exit code
npm run test:e2e:cov
TEST_EXIT_CODE=$?

# Derruba o banco de dados (limpeza)
npm run test:db:down

# Sai com o código de erro dos testes
exit $TEST_EXIT_CODE
