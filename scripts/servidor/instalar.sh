#!/usr/bin/env bash
# Prepara um servidor Ubuntu 24.04 limpo para o monitor e põe-no a correr.
#
#   sudo bash instalar.sh
#
# Pressupõe o código já copiado para /opt/nwl, com o .env e, se houver
# histórico a migrar, data/monitor.db. Pode correr-se outra vez sem estragar
# nada: cada passo verifica o que já está feito.
set -euo pipefail

APP=/opt/nwl
UTILIZADOR=monitor

echo "== 1. Sistema: atualizações de segurança automáticas e firewall"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq curl ca-certificates git build-essential unattended-upgrades ufw sqlite3
dpkg-reconfigure -f noninteractive unattended-upgrades
timedatectl set-timezone Europe/Lisbon
# Só SSH entra; o painel sai pelo túnel do Cloudflare, sem portas abertas.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

echo "== 2. Node 24 e pm2"
if ! node --version 2>/dev/null | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -yq nodejs
fi
npm install -g pm2@latest

echo "== 3. Utilizador próprio, sem privilégios"
id "$UTILIZADOR" &>/dev/null || useradd --system --create-home --shell /bin/bash "$UTILIZADOR"
chown -R "$UTILIZADOR:$UTILIZADOR" "$APP"
chmod 600 "$APP/.env"

echo "== 4. Dependências, testes e build"
sudo -u "$UTILIZADOR" bash -lc "cd $APP && npm ci && npm test && rm -rf .next && npm run build"

echo "== 5. Arranque automático com o servidor"
sudo -u "$UTILIZADOR" bash -lc "cd $APP && pm2 startOrReload ecosystem.config.cjs && pm2 save"
pm2 startup systemd -u "$UTILIZADOR" --hp "/home/$UTILIZADOR" >/dev/null
systemctl enable "pm2-$UTILIZADOR"
sudo -u "$UTILIZADOR" bash -lc "pm2 install pm2-logrotate >/dev/null 2>&1 || true"

echo "== 6. Verificação"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/saude >/dev/null 2>&1; then break; fi
  sleep 5
done
curl -sS http://127.0.0.1:3001/api/saude || true
echo
echo "Feito. Falta o túnel do Cloudflare (cloudflared) — ver docs/SERVIDOR.md."
