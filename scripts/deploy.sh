#!/usr/bin/env bash
# Deploy do WhatsOn com gate de testes.
# Roda TODOS os testes (backend + frontend). Só faz o deploy se tudo passar.
# Uso:  bash scripts/deploy.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() { echo -e "\n[DEPLOY ABORTADO] $1" >&2; exit 1; }

echo "==> 1/3  Testes do backend (jest)"
( cd "$root/backend" && npm test ) || fail "Testes do backend falharam."

echo -e "\n==> 2/3  Testes + build do frontend (vitest + tsc + vite)"
( cd "$root/frontend" && npm run test && npm run build ) || fail "Testes/build do frontend falharam."

echo -e "\n==> 3/3  Todos os testes passaram. Subindo containers..."
docker compose up -d --build || fail "docker compose falhou."

echo -e "\n[DEPLOY OK] Containers atualizados."
docker compose ps
