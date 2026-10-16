#!/usr/bin/env bash
# Inspeção SOMENTE LEITURA do servidor: padrão de publicação (Nginx, portas, SSL, apps).
echo "### SO"; uname -sr; nproc; free -h | sed -n 2p; df -h / | tail -1
echo; echo "### Portas em escuta (porta -> processo)"
ss -ltnpH | awk '{print $4, $6}' | sed -E 's/users:\(\("([^"]+)".*/\1/' | sort -t: -k2 -n -u
echo; echo "### Nginx: sites-enabled"
ls -la /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null
echo; echo "### Nginx: server_name / listen / proxy_pass / ssl por arquivo"
for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
  [ -e "$f" ] || continue
  echo "--- $f"
  grep -nE "^\s*(server_name|listen|proxy_pass|root|ssl_certificate|include|return)\b" "$f"
done
echo; echo "### Exemplo completo: primeiro site com proxy_pass"
f=$(grep -lE "proxy_pass" /etc/nginx/sites-enabled/* 2>/dev/null | head -1); [ -n "$f" ] && { echo "--- $f"; cat "$f"; }
echo; echo "### Certificados"
ls /etc/letsencrypt/live 2>/dev/null; certbot --version 2>&1 | head -1
echo; echo "### Docker"
docker ps --format '{{.Names}} | {{.Image}} | {{.Ports}}' 2>/dev/null
echo; echo "### PM2"
pm2 jlist 2>/dev/null | grep -oE '"name":"[^"]+"|"PORT":"?[0-9]+' | paste - - 2>/dev/null | head -30 || pm2 list
echo; echo "### /home/deploy"
ls /home/deploy
echo; echo "### SSH por chave (diagnóstico)"
grep -iE "^\s*(PubkeyAuthentication|AuthorizedKeysFile|PermitRootLogin|StrictModes)" /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
ls -ld /root /root/.ssh; ls -l /root/.ssh/authorized_keys 2>/dev/null; grep -c whatson-hml /root/.ssh/authorized_keys 2>/dev/null
