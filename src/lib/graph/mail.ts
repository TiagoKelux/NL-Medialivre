import { Client } from "@microsoft/microsoft-graph-client";
import { obterAccessToken } from "./auth.ts";

/**
 * Leitura da caixa de entrada (§6 da spec).
 *
 * Sem delta queries. A janela de 24 h com deduplicação por `internetMessageId`
 * cobre o caso e não obriga a gerir estado de sincronização.
 */

export interface MensagemGraph {
  id?: string;
  internetMessageId?: string;
  receivedDateTime: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  subject?: string;
  body?: { contentType?: string; content?: string };
}

async function graph(): Promise<Client> {
  const token = await obterAccessToken();
  return Client.init({ authProvider: (done) => done(null, token) });
}

export async function lerCaixa(horas = 24): Promise<MensagemGraph[]> {
  const cliente = await graph();
  const desde = new Date(Date.now() - horas * 3_600_000).toISOString();

  const mensagens: MensagemGraph[] = [];
  let resposta = await cliente
    .api("/me/mailFolders/inbox/messages")
    .filter(`receivedDateTime ge ${desde}`)
    .select("id,internetMessageId,receivedDateTime,from,subject,body")
    .top(100)
    .get();

  while (resposta) {
    mensagens.push(...((resposta.value ?? []) as MensagemGraph[]));
    const proxima = resposta["@odata.nextLink"] as string | undefined;
    if (!proxima) break;
    resposta = await cliente.api(proxima).get();
  }

  return mensagens;
}

/** Diagnóstico do passo 2 da ordem de implementação: listar sem gravar. */
export async function listarNaConsola(horas = 24): Promise<void> {
  const mensagens = await lerCaixa(horas);
  console.log(`${mensagens.length} mensagens nas últimas ${horas} h:\n`);
  for (const m of mensagens) {
    const de = m.from?.emailAddress?.address ?? "(sem remetente)";
    console.log(`${m.receivedDateTime}  ${de.padEnd(38)}  ${m.subject ?? ""}`);
  }
}
