#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
agent_test_port="${AGENT_TEST_DB_PORT:-5554}"
agent_test_container="territory-agent-tests-$$"
trap 'docker rm -f "$agent_test_container" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$agent_test_container" --tmpfs /var/lib/postgresql/data \
  -p "127.0.0.1:${agent_test_port}:5432" -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=territory_manager_test postgres:16-alpine >/dev/null
for attempt in $(seq 1 40); do
  if docker exec "$agent_test_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.25
done
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${agent_test_port}/territory_manager_test"
export DIRECT_URL="$DATABASE_URL"
export JWT_SECRET=test_secret
export NODE_OPTIONS="${NODE_OPTIONS:-} --experimental-vm-modules --max-old-space-size=4096"
npx prisma migrate deploy
npx prisma generate
if [[ $# -eq 0 ]]; then set -- test/agent-integrations.e2e-spec.ts test/agent-isolation.e2e-spec.ts; fi
if [[ $# -eq 1 && "$1" == 'test/' ]]; then
  # Recycle Jest/VM state between batches; Nest + Prisma suites retain substantial memory.
  mapfile -t agent_test_files < <(node -e 'const fs=require("fs"),path=require("path"); const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(f=>f.isDirectory()?walk(path.join(d,f.name)):f.name.endsWith(".e2e-spec.ts")?[path.join(d,f.name)]:[]); console.log(walk("test").sort().join("\n"));')
  for ((offset=0; offset<${#agent_test_files[@]}; offset+=4)); do
    npx jest --config ./test/jest-e2e.config.js --runInBand --runTestsByPath "${agent_test_files[@]:offset:4}"
  done
else
  npx jest --config ./test/jest-e2e.config.js --runInBand "$@"
fi
