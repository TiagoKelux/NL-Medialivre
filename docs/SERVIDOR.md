# O monitor num servidor sempre ligado

O monitor corre num servidor Ubuntu 24.04 (Hetzner, UE) e deixa de depender do
PC. Esta é a montagem e o porquê de cada peça.

| Peça | O que resolve |
|---|---|
| Servidor com pm2 + systemd | Corre 24 h; reinicia sozinho se o processo cair ou o servidor reiniciar |
| Cloudflare Tunnel | O painel fica acessível por um endereço próprio sem abrir portas no servidor |
| Cloudflare Access | Só entram os emails autorizados — o painel mostra conteúdo de newsletters pagas |
| `HEALTHCHECK_URL` (healthchecks.io) | Se o monitor parar ou a leitura falhar, chega um email — um monitor parado não se pode avisar a si próprio |
| `/api/saude` | Estado em JSON (200 / 503), para qualquer verificação externa |
| Cópia diária às 03h30 | 30 cópias da base de dados em `data/copias`, e uma cópia fora do servidor |
| Atualizações automáticas + firewall | Só SSH entra; correções de segurança aplicam-se sozinhas |

## Instalar

1. Criar o servidor (Ubuntu 24.04, CX22 chega) com a chave SSH.
2. Do PC, copiar o código, o `.env` e a base de dados:

   ```bash
   git archive --format=tar HEAD | ssh root@SERVIDOR "mkdir -p /opt/nwl && tar -x -C /opt/nwl"
   scp .env root@SERVIDOR:/opt/nwl/.env
   # Parar o monitor no PC antes, para a cópia não ficar a meio de uma escrita.
   pm2 stop media-livre-monitor
   ssh root@SERVIDOR "mkdir -p /opt/nwl/data"
   scp data/monitor.db root@SERVIDOR:/opt/nwl/data/monitor.db
   ```

3. No servidor: `sudo bash /opt/nwl/scripts/servidor/instalar.sh`.
4. Túnel: `cloudflared service install <TOKEN>` (o token vem do túnel criado na conta Cloudflare).
5. Só depois de o servidor estar a ler a caixa: `pm2 delete media-livre-monitor` no PC — dois monitores a ler a mesma caixa não estragam nada, mas o do PC deixa de ser preciso.

## Atualizar o código

```bash
git archive --format=tar HEAD | ssh root@SERVIDOR "tar -x -C /opt/nwl && chown -R monitor:monitor /opt/nwl"
ssh root@SERVIDOR "sudo -u monitor bash -lc 'cd /opt/nwl && npm ci && npm test && pm2 stop media-livre-monitor && rm -rf .next && npm run build && pm2 restart media-livre-monitor'"
```

Os testes correm antes do build: se falharem, o monitor em produção fica como estava.
