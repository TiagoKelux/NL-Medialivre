#!/usr/bin/env bash
# Peças próprias da VM no Google Cloud, a correr depois do instalar.sh:
#
#   sudo bash instalar-gcp.sh <bucket-das-copias> [fail2ban]
#
# A palavra-passe do painel NÃO vai em argumento (ficava à vista no `ps` e no
# histórico da shell). Pede-se no terminal, ou lê-se da entrada:
#
#   sudo bash instalar-gcp.sh <bucket> < /caminho/ficheiro-so-com-a-senha
#
# Guarda-se só o hash (bcrypt) em /etc/nwl/painel.hash, só legível pelo root.
# Ao correr outra vez sem dar palavra-passe nova, fica a que já estava.
#
# - Caddy à frente do monitor: HTTPS automático e palavra-passe no painel.
#   O endereço é <ip>.sslip.io, que aponta sozinho para o IP da VM; com um
#   domínio próprio, basta trocar a primeira linha do Caddyfile.
# - /api/saude fica fora da palavra-passe, para a verificação do Google Cloud
#   Monitoring a poder ler (só diz se está saudável; o detalhe está em
#   /api/estado, com palavra-passe).
# - /api/arranque, /api/ciclo e /api/gerar-dia são só para dentro da máquina:
#   de fora dão 404.
# - Cabeçalhos de segurança e registo de acessos em /var/log/caddy/access.log.
# - Com `fail2ban` como segundo argumento: bane por 1 h quem acumular 10
#   respostas 401 (palavra-passe errada) em 10 minutos.
# - Cópias diárias da base de dados levadas para um bucket do Cloud Storage.
#
# Pode correr-se outra vez sem estragar nada.
set -euo pipefail

BUCKET="${1:?Uso: sudo bash instalar-gcp.sh <bucket-das-copias> [fail2ban]}"
EXTRA="${2:-}"
if [ -n "$EXTRA" ] && [ "$EXTRA" != "fail2ban" ]; then
  echo "O segundo argumento só pode ser 'fail2ban'." >&2
  echo "A palavra-passe do painel já não vai em argumento: pede-se no terminal" >&2
  echo "ou lê-se da entrada (sudo bash instalar-gcp.sh <bucket> < ficheiro)." >&2
  exit 1
fi
APP=/opt/nwl
UTILIZADOR=monitor
HASH_FICHEIRO=/etc/nwl/painel.hash

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

# A palavra-passe: da entrada se vier por lá, senão do terminal (só se ainda
# não houver uma guardada). Nunca passa por argumentos de nenhum comando: o
# `printf` é da própria shell e o `caddy hash-password` lê-a da entrada.
SENHA=""
if [ ! -t 0 ]; then
  IFS= read -r SENHA || true
elif [ ! -s "$HASH_FICHEIRO" ]; then
  read -rsp "Palavra-passe do painel (utilizador medialivre): " SENHA
  echo
fi
if [ -n "$SENHA" ]; then
  install -d -m 700 -o root -g root /etc/nwl
  NOVO=$(printf '%s\n' "$SENHA" | caddy hash-password)
  unset SENHA
  ( umask 077; printf '%s\n' "$NOVO" > "$HASH_FICHEIRO" )
fi
if [ ! -s "$HASH_FICHEIRO" ]; then
  echo "Falta a palavra-passe do painel (ver o início deste script)." >&2
  exit 1
fi
HASH=$(cat "$HASH_FICHEIRO")

IP=$(curl -fsS -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)
ENDERECO="${IP//./-}.sslip.io"

install -d -m 750 -o caddy -g caddy /var/log/caddy

cat > /etc/caddy/Caddyfile <<EOF
$ENDERECO {
	encode gzip

	# Registo de acessos (o Authorization não aparece: o Caddy tapa-o).
	log {
		output file /var/log/caddy/access.log {
			roll_size 20MiB
			roll_keep 10
			roll_keep_for 720h
		}
	}

	# Com "?": só se a aplicação não tiver posto o seu (o /api/email e o
	# /api/conteudo trazem uma Content-Security-Policy mais apertada).
	header {
		?Strict-Transport-Security "max-age=31536000"
		?X-Frame-Options "DENY"
		?X-Content-Type-Options "nosniff"
		?Referrer-Policy "same-origin"
		?Content-Security-Policy "frame-ancestors 'none'"
		-Server
	}

	# Só para o próprio processo (instrumentation.ts, em 127.0.0.1).
	@internas path /api/arranque /api/arranque/* /api/ciclo /api/ciclo/* /api/gerar-dia /api/gerar-dia/*
	handle @internas {
		respond 404
	}

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
chown root:caddy /etc/caddy/Caddyfile
chmod 640 /etc/caddy/Caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

echo "== 3. Cópias para o Cloud Storage, todos os dias às 04h00"
cat > /etc/cron.d/nwl-copias <<EOF
0 4 * * * root gcloud storage rsync $APP/data/copias gs://$BUCKET/copias --quiet >> /var/log/nwl-copias.log 2>&1
EOF
chmod 644 /etc/cron.d/nwl-copias

if [ "$EXTRA" = "fail2ban" ]; then
  echo "== 4. fail2ban: 10 respostas 401 em 10 min → 1 h de castigo"
  command -v fail2ban-server >/dev/null || apt-get install -yq fail2ban

  # O registo do Caddy é JSON, uma linha por pedido; o `request` começa pelo
  # remote_ip. As aspas dos cabeçalhos vêm escapadas (\"), por isso um
  # cabeçalho forjado não consegue imitar estes campos.
  # O /api/saude não pede palavra-passe (dá 200/503, nunca 401), por isso a
  # verificação do Google nunca conta — e o ignoreregex garante-o na mesma.
  cat > /etc/fail2ban/filter.d/nwl-caddy-401.conf <<'EOF'
[Definition]
failregex = "request":\{"remote_ip":"<HOST>",.*"status":401[,}]
ignoreregex = "uri":"/api/saude[?"]
datepattern = "ts":{EPOCH}
EOF

  cat > /etc/fail2ban/jail.d/nwl-caddy-401.local <<'EOF'
[nwl-caddy-401]
enabled  = true
port     = http,https
filter   = nwl-caddy-401
logpath  = /var/log/caddy/access.log
backend  = polling
maxretry = 10
findtime = 10m
bantime  = 1h
EOF

  fail2ban-client -t >/dev/null
  systemctl enable fail2ban
  systemctl restart fail2ban
fi

echo
echo "Painel: https://$ENDERECO  (utilizador: medialivre)"
