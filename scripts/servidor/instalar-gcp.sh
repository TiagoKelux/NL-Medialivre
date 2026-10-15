#!/usr/bin/env bash
# Peças próprias da VM no Google Cloud, a correr depois do instalar.sh:
#
#   sudo bash instalar-gcp.sh <bucket-das-copias> <palavra-passe-do-painel>
#
# - Caddy à frente do monitor: HTTPS automático e palavra-passe no painel.
#   O endereço é <ip>.sslip.io, que aponta sozinho para o IP da VM; com um
#   domínio próprio, basta trocar a primeira linha do Caddyfile.
# - /api/saude fica fora da palavra-passe, para a verificação do Google Cloud
#   Monitoring a poder ler (não devolve conteúdo de emails).
# - Cópias diárias da base de dados levadas para um bucket do Cloud Storage.
#
# Pode correr-se outra vez sem estragar nada.
set -euo pipefail

BUCKET="$1"
SENHA="$2"
APP=/opt/nwl
UTILIZADOR=monitor

echo "== 1. Firewall da máquina: abrir HTTP e HTTPS"
ufw allow 80/tcp
ufw allow 443/tcp

echo "== 2. Caddy"
if ! command -v caddy >/dev/null; then
  apt-get install -yq debian-keyring debian-archive-keyring apt-transport-https gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -yq caddy
fi

IP=$(curl -fsS -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)
ENDERECO="${IP//./-}.sslip.io"
HASH=$(caddy hash-password --plaintext "$SENHA")

cat > /etc/caddy/Caddyfile <<EOF
$ENDERECO {
	encode gzip
	@saude path /api/saude
	handle @saude {
		reverse_proxy 127.0.0.1:3001
	}
	handle {
		basic_auth {
			medialivre $HASH
		}
		reverse_proxy 127.0.0.1:3001
	}
}
EOF
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

echo "== 3. Cópias para o Cloud Storage, todos os dias às 04h00"
cat > /etc/cron.d/nwl-copias <<EOF
0 4 * * * root gcloud storage rsync $APP/data/copias gs://$BUCKET/copias --quiet >> /var/log/nwl-copias.log 2>&1
EOF
chmod 644 /etc/cron.d/nwl-copias

echo
echo "Painel: https://$ENDERECO  (utilizador: medialivre)"
