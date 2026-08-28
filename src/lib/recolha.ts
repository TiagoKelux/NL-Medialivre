import { db } from "./db.ts";
import type { MensagemGraph } from "./graph/mail.ts";
import { corresponder } from "./correspondencia.ts";
import { processarCorpo } from "./conteudo.ts";
import { reavaliar } from "./registos.ts";
import { dataLocal, paraIso } from "./tempo.ts";

/**
 * O passo 3 e 4 da spec: gravar em `emails` com deduplicação e fazer
 * corresponder cada email à sua newsletter.
 *
 * O corpo grava-se desde o primeiro dia, mesmo antes de a comparação de
 * conteúdo funcionar. Sem histórico não há comparação possível depois, e este
 * histórico não se recupera retroativamente.
 */

export interface ResumoRecolha {
  vistas: number;
  novas: number;
  repetidas: number;
  atribuidas: number;
  registosAtualizados: number;
}

function identificador(m: MensagemGraph): string | null {
  // O internetMessageId é o que vem do servidor de origem e é estável entre
  // entregas repetidas. O id do Graph é o recurso na caixa e não serve.
  return m.internetMessageId ?? m.id ?? null;
}

/**
 * Volta a tentar classificar os emails que ficaram sem newsletter.
 *
 * Enquanto `remetentes` e `padraoAssunto` estiverem por preencher, tudo o que
 * entra fica com `newsletter_id` a null. Quando esses campos forem preenchidos,
 * isto recupera o histórico já gravado em vez de o desperdiçar.
 */
export function reclassificarNaoAtribuidos(): Set<string> {
  const bd = db();
  const orfaos = bd
    .prepare(
      `SELECT id, remetente, assunto, recebido_em FROM emails WHERE newsletter_id IS NULL`,
    )
    .all() as { id: number; remetente: string; assunto: string; recebido_em: string }[];

  const atualizar = bd.prepare(`UPDATE emails SET newsletter_id = ? WHERE id = ?`);
  const afetados = new Set<string>();

  for (const e of orfaos) {
    const n = corresponder(e.remetente, e.assunto);
    if (!n) continue;
    atualizar.run(n.id, e.id);
    afetados.add(`${n.id}|${dataLocal(new Date(e.recebido_em))}`);
  }

  return afetados;
}

export async function recolher(horas = 24): Promise<ResumoRecolha> {
  const bd = db();
  // Carregado só aqui: o MSAL arrasta dependências pesadas que nao devem
  // entrar no grafo estatico do arranque do Next.
  const { lerCaixa } = await import("./graph/mail.ts");
  const mensagens = await lerCaixa(horas);

  const inserir = bd.prepare(`
    INSERT OR IGNORE INTO emails
      (internet_message_id, remetente, assunto, recebido_em,
       corpo_html, corpo_normalizado, hash_conteudo, newsletter_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const resumo: ResumoRecolha = {
    vistas: mensagens.length,
    novas: 0,
    repetidas: 0,
    atribuidas: 0,
    registosAtualizados: 0,
  };

  // Chave `newsletterId|data` dos registos que é preciso reavaliar.
  const afetados = new Set<string>();

  const gravar = bd.transaction(() => {
    for (const m of mensagens) {
      const msgId = identificador(m);
      if (!msgId) continue;

      const remetente = m.from?.emailAddress?.address ?? "";
      const assunto = m.subject ?? "";
      const html = m.body?.content ?? "";
      const { normalizado, hash } = processarCorpo(html);
      const n = corresponder(remetente, assunto);

      const recebidoEm = paraIso(new Date(m.receivedDateTime));
      const res = inserir.run(
        msgId,
        remetente,
        assunto,
        recebidoEm,
        html,
        normalizado,
        hash,
        n?.id ?? null,
      );

      // changes === 0 significa que o UNIQUE rejeitou: é o mesmo email outra
      // vez. Não conta como ocorrência (critério 5).
      if (res.changes === 0) {
        resumo.repetidas++;
        continue;
      }

      resumo.novas++;
      if (n) {
        resumo.atribuidas++;
        afetados.add(`${n.id}|${dataLocal(new Date(m.receivedDateTime))}`);
      }
    }
  });
  gravar();

  for (const chave of reclassificarNaoAtribuidos()) afetados.add(chave);

  for (const chave of afetados) {
    const separador = chave.lastIndexOf("|");
    const newsletterId = chave.slice(0, separador);
    const data = chave.slice(separador + 1);
    if (reavaliar(newsletterId, data)) resumo.registosAtualizados++;
  }

  return resumo;
}
