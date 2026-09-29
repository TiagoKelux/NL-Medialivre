/**
 * Passo 2 da ordem de implementação: listar emails na consola, sem gravar.
 * Serve para descobrir os `remetentes` e o `padraoAssunto` reais de cada
 * newsletter, que são o único bloqueio da configuração.
 *   npm run listar [horas]
 */
import { temGmail } from "../src/lib/gmail/config.ts";

const horas = Number(process.argv[2] ?? 24);
const { lerCaixa } = temGmail()
  ? await import("../src/lib/gmail/mail.ts")
  : await import("../src/lib/graph/mail.ts");

const mensagens = await lerCaixa(horas);
console.log(`${mensagens.length} mensagens nas últimas ${horas} h:\n`);
for (const m of mensagens) {
  const de = m.from?.emailAddress?.address ?? "(sem remetente)";
  console.log(`${m.receivedDateTime}  ${de.padEnd(38)}  ${m.subject ?? ""}`);
}
