#!/usr/bin/env bash
# Relatório de chegadas por newsletter: o que chegou desde uma data (por
# omissão, as últimas 24 h) e as listas que estão em silêncio.
#
#   gcloud compute scp scripts/servidor/chegadas.sh nwl-monitor:/tmp/ --zone us-east1-b
#   gcloud compute ssh nwl-monitor --zone us-east1-b --command "sudo bash /tmp/chegadas.sh 2026-11-12"
#
# Só lê a base de dados; não muda nada.
set -euo pipefail
DB=/opt/nwl/data/monitor.db
DESDE="${1:-$(date -u -d '24 hours ago' +%Y-%m-%dT%H)}"

echo "== Chegaram desde $DESDE (UTC) =="
sqlite3 -column -header "$DB" "
  SELECT newsletter_id AS newsletter, count(*) AS emails, min(recebido_em) AS primeiro, max(recebido_em) AS ultimo
    FROM emails WHERE recebido_em >= '$DESDE' AND newsletter_id IS NOT NULL
   GROUP BY newsletter_id ORDER BY newsletter_id;"

echo
echo "== Por atribuir desde $DESDE =="
sqlite3 -column -header "$DB" "
  SELECT recebido_em, remetente, substr(assunto, 1, 70) AS assunto
    FROM emails WHERE recebido_em >= '$DESDE' AND newsletter_id IS NULL ORDER BY recebido_em;"

echo
echo "== Sem nenhum email desde $DESDE (última chegada de sempre) =="
sqlite3 -column -header "$DB" "
  SELECT r.newsletter_id AS newsletter, (SELECT max(recebido_em) FROM emails e WHERE e.newsletter_id = r.newsletter_id) AS ultima_de_sempre
    FROM (SELECT DISTINCT newsletter_id FROM registos WHERE data_prevista >= substr('$DESDE', 1, 10) AND codigo_estado <> 6) r
   WHERE NOT EXISTS (SELECT 1 FROM emails e WHERE e.newsletter_id = r.newsletter_id AND e.recebido_em >= '$DESDE')
   ORDER BY ultima_de_sempre;"
