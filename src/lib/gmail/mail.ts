import { createHash } from "node:crypto";
import { ImapFlow } from "imapflow";
import { lerEml } from "../eml.ts";
import type { MensagemGraph } from "../graph/mail.ts";

/**
 * Leitura da caixa do Gmail por IMAP, com uma palavra-passe de app.
 *
 * Devolve o mesmo formato que o leitor do Graph, para a recolha não saber de
 * onde vêm os emails.
 *
 * Lê "Todo o correio", o Spam e o Lixo — não só a caixa de entrada. Um email
 * que alguém arquive, ou que um filtro tire da entrada, ou que seja apagado
 * antes da leitura seguinte, continua a ter chegado. Lendo só a entrada, isso
 * dava "Não Saiu" falsos. O mesmo email visto em duas pastas conta uma vez
 * (Message-ID).
 */

function cliente(): ImapFlow {
  return new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER ?? "",
      // O Google mostra a palavra-passe de app em grupos de quatro.
      pass: (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, ""),
    },
    logger: false,
  });
}

async function pastas(c: ImapFlow): Promise<string[]> {
  // O nome das pastas depende da língua da conta; os atributos especiais não.
  const lista = await c.list();
  const especial = (uso: string) => lista.find((p) => p.specialUse === uso)?.path;
  // Sem "Todo o correio" visível no IMAP (definição do Gmail), fica a entrada.
  const principal = especial("\\All") ?? "INBOX";
  return [principal, especial("\\Junk"), especial("\\Trash")].filter(
    (p): p is string => Boolean(p),
  );
}

/**
 * Identificador para um email sem Message-ID — raro, mas saltá-lo seria um
 * falso "Não Saiu". Estável entre leituras: depende só do que não muda.
 */
function idSintetico(remetente: string, assunto: string, recebido: Date): string {
  const h = createHash("sha256").update(`${remetente}|${assunto}|${recebido.toISOString()}`);
  return `sintetico-${h.digest("hex").slice(0, 32)}@media-livre`;
}

/**
 * `conhecido` diz se um Message-ID já está gravado. Com a janela de 7 dias,
 * descarregar o email inteiro de todos a cada 5 minutos seria desperdício:
 * primeiro lê-se só o envelope, e o corpo só se pede para os que faltam.
 */
export async function lerCaixa(
  horas = 24,
  conhecido?: (internetMessageId: string) => boolean,
): Promise<MensagemGraph[]> {
  const desde = new Date(Date.now() - horas * 3_600_000);
  const c = cliente();
  await c.connect();

  const mensagens: MensagemGraph[] = [];
  try {
    for (const pasta of await pastas(c)) {
      const trinco = await c.getMailboxLock(pasta);
      try {
        // O SINCE do IMAP só olha para o dia, e não diz em que fuso; um dia de
        // folga e o corte fino pela hora de chegada faz-se a seguir.
        const folga = new Date(desde.getTime() - 86_400_000);
        const encontrados = await c.search({ since: folga }, { uid: true });
        if (!encontrados || encontrados.length === 0) continue;

        const uids: number[] = [];
        for await (const msg of c.fetch(encontrados, { envelope: true, internalDate: true }, { uid: true })) {
          const recebido = msg.internalDate ? new Date(msg.internalDate) : null;
          if (!recebido || recebido < desde) continue;
          const id = (msg.envelope?.messageId ?? "").replace(/^<|>$/g, "").trim();
          // Sem Message-ID no envelope, segue para a leitura completa, que decide.
          if (id && conhecido?.(id)) continue;
          uids.push(msg.uid);
        }
        if (uids.length === 0) continue;

        for await (const msg of c.fetch(uids, { source: true, internalDate: true }, { uid: true })) {
          const recebido = msg.internalDate ? new Date(msg.internalDate) : null;
          if (!recebido || recebido < desde || !msg.source) continue;

          // A data que conta é a de chegada ao Gmail; o cabeçalho Date e o
          // Message-ID não são obrigatórios aqui.
          const lido = lerEml(msg.source.toString("latin1"), { tolerante: true });

          mensagens.push({
            internetMessageId:
              lido.internetMessageId || idSintetico(lido.remetente, lido.assunto, recebido),
            receivedDateTime: recebido.toISOString(),
            // Fica o cabeçalho inteiro, "Nome <endereco>": o nome é o que distingue
            // newsletters da mesma marca que partilham o endereço.
            from: { emailAddress: { address: lido.remetente } },
            subject: lido.assunto,
            body: { contentType: "html", content: lido.corpoHtml },
          });
        }
      } finally {
        trinco.release();
      }
    }
  } finally {
    await c.logout();
  }

  return mensagens;
}
