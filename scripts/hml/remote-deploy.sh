#!/usr/bin/env bash
# Executado NO SERVIDOR por scripts/deploy-hml.ps1 (via ssh).
# Instala/atualiza a homologação em /home/deploy/whatson2-hml sem tocar no WhatsOn antigo.
set -euo pipefail

DOMAIN="hmlwhatson.connectmulti.com.br"
APP_DIR="/home/deploy/whatson2-hml"
REPO="https://github.com/mateusmeneses/WhatsOn_v3.git"
BRANCH="main"
NGINX_SITE="/etc/nginx/sites-available/whatson2-hml"

# Portas só em 127.0.0.1 e diferentes das do WhatsOn antigo (3000/4003).
FRONTEND_PORT=3010
BACKEND_PORT=4010
POSTGRES_PORT=5434
REDIS_PORT=6381
EVOLUTION_PORT=8081

step() { echo; echo "==> $*"; }
die() { echo "[ERRO] $*" >&2; exit 1; }

step "Pré-requisitos"
for bin in git docker nginx curl openssl; do
  command -v "$bin" >/dev/null || die "'$bin' não está instalado no servidor."
done
docker compose version >/dev/null 2>&1 || die "'docker compose' (plugin v2) não está disponível."

step "Código ($BRANCH)"
if [ ! -d "$APP_DIR/.git" ]; then
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"   # .env é ignorado pelo git e é preservado
git log --oneline -1

if [ ! -f .env ]; then
  step "Criando .env com segredos novos (só no servidor)"
  rnd() { openssl rand -hex "$1"; }
  ADMIN_PASS="$(rnd 8)"
  BULL_PASS="$(rnd 8)"
  umask 077
  cat > .env <<EOF
COMPOSE_PROJECT_NAME=whatson2-hml
FRONTEND_BIND=127.0.0.1:$FRONTEND_PORT
BACKEND_BIND=127.0.0.1:$BACKEND_PORT
POSTGRES_BIND=127.0.0.1:$POSTGRES_PORT
REDIS_BIND=127.0.0.1:$REDIS_PORT
EVOLUTION_BIND=127.0.0.1:$EVOLUTION_PORT

DB_USER=whatson
DB_PASS=$(rnd 24)
DB_NAME=whatson
EVOLUTION_API_KEY=$(rnd 32)
JWT_SECRET=$(rnd 32)
JWT_REFRESH_SECRET=$(rnd 32)
FRONTEND_URL=https://$DOMAIN
LOG_LEVEL=info

SEED_ADMIN_EMAIL=admin@whatson.local
SEED_ADMIN_PASSWORD=$ADMIN_PASS
BULL_BOARD_USER=admin
BULL_BOARD_PASS=$BULL_PASS
EOF
  chmod 600 .env
  echo "------------------------------------------------------------"
  echo " Admin inicial:   admin@whatson.local / $ADMIN_PASS"
  echo " Bull Board:      admin / $BULL_PASS"
  echo " (anote agora; ficam só em $APP_DIR/.env)"
  echo "------------------------------------------------------------"
fi

step "Conferindo portas"
if [ -z "$(docker compose ps -q 2>/dev/null)" ]; then
  for p in $FRONTEND_PORT $BACKEND_PORT $POSTGRES_PORT $REDIS_PORT $EVOLUTION_PORT; do
    if ss -ltn "( sport = :$p )" | grep -q LISTEN; then
      die "porta $p já está em uso por outro serviço. Ajuste as portas em remote-deploy.sh e no .env."
    fi
  done
fi
echo "ok"

step "Build e subida dos containers"
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null || true

step "Aguardando o backend (/health)"
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1; then echo "backend ok"; break; fi
  [ "$i" -eq 40 ] && { docker compose logs --tail 60 backend; die "backend não respondeu em /health."; }
  sleep 3
done
curl -fsS -o /dev/null "http://127.0.0.1:$FRONTEND_PORT/" || die "frontend não respondeu na porta $FRONTEND_PORT."
echo "frontend ok"

step "Nginx ($DOMAIN)"
if [ ! -f "$NGINX_SITE" ]; then
  cat > "$NGINX_SITE" <<EOF
map \$http_upgrade \$whatson2_hml_connection {
  default upgrade;
  ""      close;
}

server {
  listen 80;
  server_name $DOMAIN;
  client_max_body_size 20m;

  location / {
    proxy_pass http://127.0.0.1:$FRONTEND_PORT;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$whatson2_hml_connection;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 3600s;
  }
}
EOF
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/whatson2-hml
fi
nginx -t
systemctl reload nginx

step "SSL"
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "certificado já existe"
elif command -v certbot >/dev/null; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
    || echo "[AVISO] certbot falhou. Site segue em HTTP na origem; confira o modo SSL na Cloudflare."
else
  echo "[AVISO] certbot não instalado; site segue em HTTP na origem."
fi

step "Status"
docker compose ps
echo
echo "[REMOTO OK] $DOMAIN atualizado para $(git log --oneline -1)"
