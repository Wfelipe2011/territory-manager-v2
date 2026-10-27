#!/usr/bin/env bash
set -euo pipefail

# OAuth uses an ESM provider. Keep the full pre-push suite on the same isolated
# PostgreSQL/VM runner used by MCP tests, without touching shared local databases.
exec bash "$(dirname "$0")/test-agents.sh" test/
