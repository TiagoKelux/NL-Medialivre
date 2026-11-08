# O monitor no servidor (Google Cloud)

O monitor corre 24 h numa máquina virtual do Google Cloud e não depende de
nenhum PC. Este documento diz como está montado, como se atualiza, como se
verifica e o que fazer quando alguma coisa corre mal.

> **A transferir na entrega** — marcado assim ao longo do documento: o que
> ainda está em contas da Kelux e tem de passar para a Medialivre.

## Montagem

| Peça | Valor | O que resolve |
|---|---|---|
| Projeto Google Cloud | `medialivre-nl-monitor` | Agrupa a VM, o bucket das cópias e o alerta. **A transferir na entrega:** está na conta `ogrupoatila@gmail.com`, em período de avaliação gratuita faturado à Kelux |
| Máquina virtual | `nwl-monitor` — e2-micro, zona `us-east1-b`, Ubuntu 24.04, 2 GB de swap | Corre 24 h |
| IP fixo | `34.148.158.177` | O endereço do painel não muda quando a VM reinicia |
| Painel | https://34-148-158-177.sslip.io | O sslip.io traduz o nome para o IP, sem ser preciso domínio próprio |
| Código | `/opt/nwl`, dono `monitor` (utilizador sem privilégios) | `/opt/nwl/VERSAO` tem o commit instalado |
| Processo | pm2, app `media-livre-monitor`, porta 3001 só em `127.0.0.1` (`ecosystem.config.cjs`) | Reinicia sozinho se cair; `pm2-logrotate` roda os logs |
| Arranque com a máquina | serviço systemd `pm2-monitor` | Depois de um reinício da VM, o monitor volta sozinho |
| Caddy | HTTPS (Let's Encrypt) + palavra-passe (utilizador `medialivre`) | O painel mostra conteúdo de newsletters pagas: só entra quem tem a palavra-passe. O hash está em `/etc/nwl/painel.hash` |
| `/api/saude` | público, sem palavra-passe | Só diz se a leitura está boa (200 / 503); é o que o alerta lê |
| `/api/arranque`, `/api/ciclo`, `/api/gerar-dia` | 404 de fora | Só o próprio processo os chama |
| Firewall (ufw) | entram só 22, 80 e 443 | |
| Atualizações | `unattended-upgrades` | As correções de segurança do Ubuntu aplicam-se sozinhas |
| Caixa de correio | `nlmedialivre@gmail.com` por IMAP (`GMAIL_USER` e `GMAIL_APP_PASSWORD` no `/opt/nwl/.env`) | Lê "Todo o correio", Spam e Lixo de 5 em 5 minutos. Acesso premium às pagas desde 05/11/2026, por um ano |
| Cópias da base de dados | todos os dias às 03h30 para `/opt/nwl/data/copias` (ficam as últimas 30) | Feitas pelo próprio monitor (`src/lib/copias.ts`), seguras com o monitor a escrever |
| Cópias fora da máquina | cron às 04h00 (`/etc/cron.d/nwl-copias`): `gcloud storage rsync` para `gs://medialivre-nl-monitor-copias/copias` | Se a VM se perder, as cópias não se perdem. Registo em `/var/log/nwl-copias.log` |
| Alerta | verificação de disponibilidade `nwl-saude` do Cloud Monitoring sobre `/api/saude` | Se o monitor parar, ou a leitura da caixa estiver mais de 15 min sem uma leitura boa, chega um email. **A transferir na entrega:** os avisos vão só para `tb@kelux.ai` |
| Código-fonte | repositório GitHub `TiagoKelux/NL-Medialivre` | **A transferir na entrega** |

A máquina e o painel estão em hora de Lisboa (`timedatectl` e `TZ` do pm2),
mas o monitor não depende disso: calcula tudo em `Europe/Lisbon`
(`src/lib/tempo.ts`).

O fail2ban (bane 1 h quem errar a palavra-passe 10 vezes em 10 min) é
opcional no `instalar-gcp.sh`. Para saber se está ligado:
`sudo fail2ban-client status nwl-caddy-401`.

O `vigia.ts` ainda aceita um `HEALTHCHECK_URL` (healthchecks.io). No Google
Cloud não é usado: o alerta é o do Cloud Monitoring.

## Entrar na máquina

Com o [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) instalado
e a sessão iniciada numa conta com acesso ao projeto:

```bash
gcloud config set project medialivre-nl-monitor
gcloud config set compute/zone us-east1-b
gcloud compute ssh nwl-monitor
```

Os comandos do monitor correm como `monitor`:

```bash
sudo -u monitor bash -lc 'cd /opt/nwl && <comando>'
```

**No Windows**, o `gcloud compute ssh --command "…"` estraga comandos com `|`
(e outras aspas). Põe-se os passos num ficheiro, copia-se e corre-se:

```bash
gcloud compute scp passos.sh nwl-monitor:/tmp/passos.sh
gcloud compute ssh nwl-monitor --command "sudo bash /tmp/passos.sh"
```

## Ver se está tudo bem

| O quê | Como |
|---|---|
| Está a ler a caixa? | `curl https://34-148-158-177.sslip.io/api/saude` → `{"saudavel":true,…}` e HTTP 200. Dá 503 só depois de 15 min sem uma leitura boa (uma falha isolada do Gmail recupera no ciclo seguinte) |
| Detalhe (erro da leitura, editores que deixaram de mandar diárias) | `curl -u medialivre https://34-148-158-177.sslip.io/api/estado` — campos `falha`, `caixa` e `caixaCortada` |
| O processo | `sudo -u monitor pm2 status` |
| O que o monitor escreve | `sudo -u monitor pm2 logs media-livre-monitor --lines 200` (ficheiros em `/home/monitor/.pm2/logs/`). Uma linha por ciclo com o que leu; `CAIXA CORTADA …` quando um editor deixa de mandar as diárias |
| Versão instalada | `cat /opt/nwl/VERSAO` |
| Acessos ao painel | `/var/log/caddy/access.log` |
| Cópias | `ls -lh /opt/nwl/data/copias` e `gcloud storage ls gs://medialivre-nl-monitor-copias/copias/` |
| Disco e memória | `df -h /` e `free -h` |

O próprio painel avisa no topo se a leitura está a falhar ou parada (ver
`docs/MANUAL-CLIENTE.md`).

## Atualizar o código

Do PC, na pasta do projeto, com o código já no git (`git status` limpo).

1. Fazer o pacote e copiá-lo, com o script de instalação:

   ```bash
   git archive --format=tar.gz -o nwl.tar.gz HEAD
   git rev-parse --short HEAD          # o commit, para o passo 2
   gcloud compute scp nwl.tar.gz deploy.sh nwl-monitor:/tmp/
   gcloud compute ssh nwl-monitor --command "sudo bash /tmp/deploy.sh <commit>"
   ```

2. O `deploy.sh` (não está no repositório; guardar ao lado do pacote):

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   COMMIT="${1:?commit}"
   APP=/opt/nwl
   TS=$(date +%Y%m%d-%H%M%S)

   tar -xzf /tmp/nwl.tar.gz -C "$APP"
   echo "$COMMIT" > "$APP/VERSAO"
   chown -R monitor:monitor "$APP"

   # Cópia da base antes de mexer em nada (segura com o monitor a correr).
   sudo -u monitor sqlite3 "$APP/data/monitor.db" ".backup '$APP/data/copias/antes-deploy-$TS.db'"

   sudo -u monitor bash -lc "cd $APP && npm ci && npm test && pm2 stop media-livre-monitor && rm -rf .next && npm run build && pm2 restart media-livre-monitor"
   ```

3. Confirmar: `curl https://34-148-158-177.sslip.io/api/saude` e as últimas
   linhas do `pm2 logs` (`Jobs agendados. Fuso: Europe/Lisbon …`).

Notas:

- O pacote não leva o `.env` nem `data/` (não estão no git): ficam os do
  servidor.
- Os testes correm antes de parar o monitor: se falharem, o que está em
  produção fica como estava. Se for o **build** a falhar, o monitor fica
  parado — corrigir e voltar a instalar, ou instalar o commit anterior.
- No arranque, o monitor recalcula os últimos 45 dias com a configuração
  nova e tapa os dias em falta.
- Quando muda o `ecosystem.config.cjs`, o `pm2 restart` não o relê:
  `sudo -u monitor bash -lc 'cd /opt/nwl && pm2 delete media-livre-monitor && pm2 start ecosystem.config.cjs && pm2 save'`.
- As cópias `antes-deploy-*.db` não são apagadas automaticamente (só as
  `monitor-AAAA-MM-DD.db`). Apagar as antigas de vez em quando.

## Cópias e como repor uma

Há três lugares com cópias:

- `/opt/nwl/data/copias/monitor-AAAA-MM-DD.db` — uma por dia, as últimas 30;
- `/opt/nwl/data/copias/antes-deploy-<data-hora>.db` — uma por atualização;
- `gs://medialivre-nl-monitor-copias/copias/` — o mesmo, levado às 04h00. O
  `rsync` não apaga no bucket o que se apagou na máquina, por isso o bucket
  guarda mais do que 30 dias.

Repor (perde-se o que o monitor gravou depois da cópia; os emails voltam a
ser lidos da caixa nas leituras seguintes, até 45 dias para trás):

1. Entrar na máquina (`gcloud compute ssh nwl-monitor`).
2. Escolher a cópia: `ls -lh /opt/nwl/data/copias`. Se não estiver lá,
   trazê-la do bucket:

   ```bash
   sudo gcloud storage cp gs://medialivre-nl-monitor-copias/copias/monitor-2026-11-07.db /opt/nwl/data/copias/
   ```

3. Parar o monitor:

   ```bash
   sudo -u monitor pm2 stop media-livre-monitor
   ```

4. Pôr a base atual de lado (não apagar — pode ser precisa):

   ```bash
   cd /opt/nwl/data
   sudo mkdir -p antes-restauro
   sudo mv monitor.db monitor.db-wal monitor.db-shm antes-restauro/ 2>/dev/null || true
   ```

5. Copiar a cópia escolhida para o lugar da base e verificá-la:

   ```bash
   sudo cp copias/monitor-2026-11-07.db monitor.db
   sudo chown -R monitor:monitor /opt/nwl/data
   sudo -u monitor sqlite3 monitor.db "PRAGMA integrity_check;"     # deve dizer: ok
   ```

6. Arrancar e confirmar:

   ```bash
   sudo -u monitor pm2 start media-livre-monitor
   sudo -u monitor pm2 logs media-livre-monitor --lines 50
   curl https://34-148-158-177.sslip.io/api/saude
   ```

7. Quando estiver confirmado, apagar `data/antes-restauro/`.

## O que fazer se…

### …a palavra-passe de app do Gmail foi revogada (ou a da conta mudou)

Sinal: o painel mostra "A leitura da caixa está a falhar"; o `/api/estado`
traz um erro de autenticação; ao fim de 15 min chega o alerta. Mudar a
palavra-passe da conta Google revoga todas as palavras-passe de app.

1. Entrar em `nlmedialivre@gmail.com` e criar uma palavra-passe de app em
   https://myaccount.google.com/apppasswords (exige a verificação em dois
   passos ligada).
2. Na máquina: `sudo nano /opt/nwl/.env` e trocar `GMAIL_APP_PASSWORD=` (os
   espaços são ignorados).
3. `sudo -u monitor pm2 restart media-livre-monitor` e confirmar no
   `pm2 logs` uma linha `… vistas, … novas …`.

Nada se perde: enquanto a leitura falha, os registos ficam "Por confirmar",
e a primeira leitura boa vai buscar o que ficou por ler (até 45 dias).

### …o monitor está em baixo (chegou o alerta, ou o painel não abre)

1. `curl -sS https://34-148-158-177.sslip.io/api/saude`.
   - Não responde de todo → a VM ou o Caddy (passo 2).
   - Responde 503 → o processo está vivo mas não lê a caixa: ver `falha` em
     `/api/estado` e o `pm2 logs`. Quase sempre é a palavra-passe do Gmail
     (acima) ou um problema temporário do Gmail.
2. Entrar na máquina. Se não entrar, ver "a VM parou" abaixo.
3. `sudo -u monitor pm2 status`. Se `media-livre-monitor` não estiver
   `online`: `sudo -u monitor pm2 logs media-livre-monitor --lines 200` para
   ver porquê, e `sudo -u monitor pm2 restart media-livre-monitor`.
4. Se o pm2 não tiver a app (a lista vem vazia):
   `sudo -u monitor bash -lc 'cd /opt/nwl && pm2 start ecosystem.config.cjs && pm2 save'`.
5. O Caddy: `systemctl status caddy` e `sudo systemctl restart caddy`.
6. Disco cheio impede a base de dados de gravar: ver abaixo.

### …a VM parou (faturação, avaliação gratuita, manutenção)

1. Na consola do Google Cloud (projeto `medialivre-nl-monitor`) → Compute
   Engine → Instâncias de VM. Ou: `gcloud compute instances describe nwl-monitor --format="value(status)"`.
2. Se o projeto estiver suspenso por faturação, resolver primeiro a conta
   de faturação (Faturação → a conta associada ao projeto). **A transferir
   na entrega:** hoje é a avaliação gratuita da conta `ogrupoatila@gmail.com`,
   paga pela Kelux; quando a avaliação acabar, sem uma conta paga ligada, a
   VM para. A e2-micro em `us-east1` cabe no nível gratuito do Google Cloud,
   mas o IP fixo, o disco além do incluído e o Cloud Storage podem ter
   custos pequenos: confirmar em Faturação → Relatórios.
3. Arrancar: `gcloud compute instances start nwl-monitor`. O pm2 arranca
   sozinho com a máquina, e o IP é fixo: o endereço do painel não muda.
4. Confirmar o `/api/saude`. O monitor gera os dias em falta e lê o que
   chegou enquanto esteve parado (até 45 dias).

### …o disco encheu

Sinal: erros `SQLITE_FULL` ou `ENOSPC` no `pm2 logs`; `df -h /` a 100 %.

```bash
df -h /
sudo du -sh /opt/nwl/data/* /home/monitor/.pm2/logs /var/log/caddy /var/log/journal 2>/dev/null
```

Por ordem do que costuma pesar:

1. `/opt/nwl/data/copias/antes-deploy-*.db` — apagar as antigas (estão também
   no bucket).
2. Logs do pm2: `sudo -u monitor pm2 flush`.
3. Journal do sistema: `sudo journalctl --vacuum-size=200M`.
4. Pacotes: `sudo apt-get clean`.
5. Se não chegar, aumentar o disco na consola (Compute Engine → Discos →
   editar o tamanho) e depois `sudo growpart /dev/sda 1 && sudo resize2fs /dev/sda1`
   (confirmar o nome do disco com `lsblk`).

Depois: `sudo -u monitor pm2 restart media-livre-monitor`.

### …uma newsletter (ou uma marca inteira) deixou de chegar

Sinais: no painel, o aviso "A caixa monitorizada deixou de receber as
newsletters diárias de: …", ou uma newsletter com vários
"∅ Não recebida – sem prova" seguidos; no log, `CAIXA CORTADA …`.

Porque acontece: os editores deixam de mandar uma lista a quem não abre
6 envios seguidos. O monitor abre sozinho cada email novo (pede o pixel de
abertura do Amazon SES, `src/lib/abertura.ts`; desliga-se com
`MARCAR_ABERTURA=0`), mas uma lista que já foi cortada não volta sozinha.

1. Confirmar que é a caixa e não o monitor: o `/api/saude` está bom e as
   outras marcas continuam a chegar.
2. Entrar no Gmail `nlmedialivre@gmail.com` e procurar emails de
   reativação/reconquista desse editor ("Queremos garantir que continua
   connosco", "Notámos que há algum tempo…", "Sentimos a sua falta"…).
   **Abri-los** com as imagens à vista e, se tiverem um botão para continuar
   a receber, carregar nele.
3. Inscrever outra vez a caixa:
   - em https://aminhaconta.xl.pt, com a conta `nlmedialivre@gmail.com`, na
     gestão de newsletters: voltar a ligar as que estão desligadas;
   - ou pelos formulários de inscrição das newsletters, nos sites das marcas.
4. Inscrever **sempre** com `nlmedialivre@gmail.com`, exatamente assim. O
   Gmail ignora os pontos: `nl.medialivre@gmail.com` é a mesma caixa, mas
   para o editor é outro assinante — a caixa passa a receber cada edição
   duas vezes. O monitor conta só uma (e o detalhe avisa), mas convém
   desinscrever o endereço com pontos.
5. Confirmar: chega um email de boas-vindas e, na edição seguinte, a
   newsletter volta ao verde. O aviso desaparece sozinho (`Caixa normalizada`
   no log).

Os dias em que a caixa esteve cortada ficam "∅ Não recebida – sem prova":
é a verdade — não sabemos se saíram.

### …mudou a hora (verão/inverno)

Não há nada a fazer. O monitor calcula as horas em `Europe/Lisbon`; o ciclo
de 5 em 5 minutos não usa fuso (com fuso, a mudança de 25/10/2026 saltou
uma hora de leituras — corrigido); os trabalhos das 00h05 (gerar o dia) e das
03h30 (cópia) e o cron das 04h00 ficam fora da hora que muda (01h00–02h00).
No dia seguinte à mudança, confirmar no painel que a leitura está em dia.

### …é preciso corrigir o passado (o Excel tinha um calendário errado)

Depois de corrigir o Excel, `npm run importar` e instalar o código novo:

```bash
sudo -u monitor bash -lc 'cd /opt/nwl && npm run recalendarizar -- <id-da-newsletter|todas> 2026-09-01 2026-10-15'
```

Fica registado em "Últimas alterações" (página Por classificar).

## Instalar de raiz (numa VM nova)

1. Criar a VM (Ubuntu 24.04; uma e2-micro chega, com 2 GB de swap:
   `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`
   e a linha `/swapfile none swap sw 0 0` no `/etc/fstab`), com IP fixo e as
   regras de firewall da VPC para 80 e 443.
2. Copiar o código para `/opt/nwl` (`git archive`, como acima), o `.env` e a
   base de dados (de uma cópia, ou da máquina antiga com o monitor parado).
3. `sudo bash /opt/nwl/scripts/servidor/instalar.sh` — sistema, Node 24,
   pm2, utilizador `monitor`, testes, build e arranque com a máquina. (A
   mensagem final sobre o Cloudflare é antiga: ignorar.)
4. `sudo bash /opt/nwl/scripts/servidor/instalar-gcp.sh medialivre-nl-monitor-copias [fail2ban]`
   — Caddy com HTTPS e palavra-passe (pedida no terminal), portas 80/443 e
   cron das cópias. A conta de serviço da VM precisa de escrever no bucket.
5. No Cloud Monitoring, uma verificação de disponibilidade HTTPS sobre
   `/api/saude` que procure `"saudavel":true`, com um canal de alerta por
   email.
6. Com um IP novo, o endereço do painel muda para `<ip-com-hífenes>.sslip.io`.
