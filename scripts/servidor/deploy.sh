#!/usr/bin/env bash
# Instala uma versão nova no servidor. Ver docs/SERVIDOR.md, "Atualizar o código".
#   sudo bash /tmp/deploy.sh <commit>      (com /tmp/nwl-<commit>.tar ao lado)
#
# O monitor continua a correr enquanto se instala e constrói: o build vai para
# a pasta que não está em uso (.next-a ou .next-b) e só no fim se troca e
# reinicia. Se os testes ou o build falharem, fica a versão anterior a correr
# (mas com o código novo na pasta: voltar a instalar o commit anterior).
set -euo pipefail
COMMIT="${1:?commit}"
APP=/opt/nwl
PACOTE="/tmp/nwl-$COMMIT.tar"
TS=$(date -u +%Y%m%d-%H%M)

# Cópia da base antes de mexer em nada (segura com o monitor a correr).
sudo -u monitor bash -lc "cd $APP && node -e \"require('better-sqlite3')('data/monitor.db').backup('data/copias/antes-deploy-$TS.db').then(()=>console.log('copia ok'))\""

tar -x -C "$APP" -f "$PACOTE"
chown -R monitor:monitor "$APP"

ATIVA=$(cat "$APP/.next-ativa" 2>/dev/null || echo .next)
if [ "$ATIVA" = .next-a ]; then NOVA=.next-b; else NOVA=.next-a; fi
echo "build ativo: $ATIVA → novo: $NOVA"

sudo -u monitor bash -lc "cd $APP && npm ci --no-audit --no-fund 2>&1 | tail -2 && { npm test >/tmp/nwl-testes.log 2>&1 || { tail -40 /tmp/nwl-testes.log; echo 'testes falharam: fica a versão anterior'; exit 1; }; } && grep -E '^ℹ (pass|fail)' /tmp/nwl-testes.log && rm -rf $NOVA && NEXT_DIST_DIR=$NOVA npm run build 2>&1 | tail -3"
test -f "$APP/$NOVA/BUILD_ID" || { echo "build falhou: fica $ATIVA"; exit 1; }

# A troca: só aqui o monitor pára, segundos.
echo "$NOVA" > "$APP/.next-ativa"
chown monitor:monitor "$APP/.next-ativa"
echo "$COMMIT" > "$APP/VERSAO"
sudo -u monitor bash -lc "cd $APP && pm2 restart media-livre-monitor >/dev/null && pm2 ls"
[ "$ATIVA" != "$NOVA" ] && rm -rf "${APP:?}/$ATIVA"
rm -f "$PACOTE"
echo FIM
