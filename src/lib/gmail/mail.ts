import { ImapFlow } from "imapflow";
import { lerEml } from "../eml.ts";
import type { MensagemGraph } from "../graph/mail.ts";

/**
 * Leitura da caixa do Gmail por IMAP, com uma palavra-passe de app.
 *
 * Devolve o mesmo formato que o leitor do Graph, para a recolha não saber de
 * onde vêm os emails. Lê a caixa de entrada (onde o Gmail também guarda as
 * Promoções) e o Spam: uma newsletter que cai no Spam continua a ter saído.
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

/** "Nome <endereco@x.pt>" → "endereco@x.pt". */
function endereco(de: string): string {
  const m = de.match(/<([^>]+)>/);
  return (m ? m[1] : de).trim().toLowerCase();
}

async function pastas(c: ImapFlow): Promise<string[]> {
  // O nome da pasta de Spam depende da língua da conta; o atributo \Junk não.
  const lista = await c.list();
  const spam = lista.find((p) => p.specialUse === "\\Junk")?.path;
  return spam ? ["INBOX", spam] : ["INBOX"];
}

export async function lerCaixa(horas = 24): Promise<MensagemGraph[]> {
  const desde = new Date(Date.now() - horas * 3_600_000);
  const c = cliente();
  await c.connect();

  const mensagens: MensagemGraph[] = [];
  try {
    for (const pasta of await pastas(c)) {
      const trinco = await c.getMailboxLock(pasta);
      try {
        // O SINCE do IMAP só olha para o dia; o corte fino faz-se a seguir.
        const uids = await c.search({ since: desde }, { uid: true });
        if (!uids || uids.length === 0) continue;

        for await (const msg of c.fetch(uids, { source: true, internalDate: true }, { uid: true })) {
          const recebido = msg.internalDate ? new Date(msg.internalDate) : null;
          if (!recebido || recebido < desde || !msg.source) continue;

          let lido;
          try {
            lido = lerEml(msg.source.toString("latin1"));
          } catch {
            continue; // sem Message-ID ou Date: não dá para deduplicar
          }

          mensagens.push({
            internetMessageId: lido.internetMessageId,
            receivedDateTime: recebido.toISOString(),
            from: { emailAddress: { address: endereco(lido.remetente) } },
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
