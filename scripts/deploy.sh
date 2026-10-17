#!/usr/bin/env bash
# Deploy do WhatsOn com gate de testes e versão yyyy.MM.dd.N (mesmo padrão do MultiComércio).
# Monta a versão com a data de hoje + o contador N, grava version.txt (fonte da verdade) e
# só faz o deploy se TODOS os testes (backend + frontend) passarem.
# Lembre de registrar a versão em frontend/public/changelog.json (mantendo só as 3 mais recentes).
# Uso:  bash scripts/deploy.sh 1              # -> 2026.10.17.1 (se hoje for 17/10/2026)
#       bash scripts/deploy.sh 2 2026.10.17
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() { echo -e "\n[DEPLOY ABORTADO] $1" >&2; exit 1; }

[ $# -ge 1 ] || fail "Informe o contador do dia. Uso: bash scripts/deploy.sh N [yyyy.MM.dd]"
version="${2:-$(date +%Y.%m.%d)}.$1"
[[ "$version" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]+$ ]] || fail "Versão inválida: '$version'. Esperado yyyy.MM.dd.N."
echo "==> Versão: $version"

echo "==> 1/3  Testes do backend (jest)"
( cd "$root/backend" && npm test ) || fail "Testes do backend falharam."

echo -e "\n==> 2/3  Testes + build do frontend (vitest + tsc + vite)"
( cd "$root/frontend" && npm run test && npm run build ) || fail "Testes/build do frontend falharam."

# version.txt só é gravado depois do gate: deploy abortado não deixa versão nova para trás.
printf '%s' "$version" > "$root/version.txt"
export APP_VERSION="$version"
APP_BUILD_TIME="$(date '+%d/%m/%Y %H:%M')"
export APP_BUILD_TIME

echo -e "\n==> 3/3  Todos os testes passaram. Subindo containers..."
docker compose up -d --build || fail "docker compose falhou."

echo -e "\n[DEPLOY OK] Versão $version no ar (rodapé, login e /api/version)."
docker compose ps
