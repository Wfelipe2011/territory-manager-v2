#!/bin/bash

# Garante a derrubada do banco mesmo em falha ou interrupção (evita container vivo
# e conexões vazadas acumulando entre execuções)
CLEANED_UP=0

cleanup() {
  if [ "$CLEANED_UP" -eq 0 ]; then
    CLEANED_UP=1
    npm run test:db:down
  fi
}

trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

# Sobe o banco de dados
npm run test:db:up

# Aguarda o banco estar pronto (timeout evita hang indefinido)
npx wait-on --timeout 120000 tcp:127.0.0.1:5433
sleep 2

# Roda as migrações
npm run test:db:migrate

# Gera os clientes do Prisma
npx prisma generate

# Executa os testes e captura o exit code
npm run test:e2e:cov
TEST_EXIT_CODE=$?

# Sai com o código de erro dos testes (limpeza via trap EXIT)
exit $TEST_EXIT_CODE
