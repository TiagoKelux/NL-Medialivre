import { db } from "./db.ts";
import type { MensagemGraph } from "./graph/mail.ts";
import { corresponder } from "./correspondencia.ts";
import { processarCorpo } from "./conteudo.ts";
import { reavaliar, registoDe } from "./registos.ts";
import { dataEdicao } from "./edicao.ts";
import { newsletterPorId } from "../../config/newsletters.ts";
import { paraIso, somarDias } from "./tempo.ts";
import type { Newsletter } from "./tipos.ts";

/** Chave do registo a reavaliar: a newsletter e o dia da edição do email. */
function chave(n: Newsletter, recebido: Date): string {
  return `${n.id}|${dataEdicao(n, recebido)}`;
}

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
 * Volta a classificar todos os emails gravados com a configuração atual.
 *
 * Quando se preenchem `remetentes` e padrões, os emails que ficaram a null
 * passam a ter newsletter; quando se aperta a regra (uma promoção que passava
 * por edição), os que estavam mal atribuídos saem. Devolve os pares
 * newsletter|dia a reavaliar — o de antes e o de depois.
 */
export function reclassificar(): Set<string> {
  const bd = db();
  const emails = bd
    .prepare(`SELECT id, remetente, assunto, recebido_em, newsletter_id FROM emails`)
    .all() as {
      id: number;
      remetente: string;
      assunto: string;
      recebido_em: string;
      newsletter_id: string | null;
    }[];

  const atualizar = bd.prepare(`UPDATE emails SET newsletter_id = ? WHERE id = ?`);
  const afetados = new Set<string>();

  for (const e of emails) {
    const novo = corresponder(e.remetente, e.assunto)?.id ?? null;
    if (novo === e.newsletter_id) continue;
    atualizar.run(novo, e.id);
    const recebido = new Date(e.recebido_em);
    const antiga = e.newsletter_id ? newsletterPorId(e.newsletter_id) : undefined;
    if (antiga) afetados.add(chave(antiga, recebido));
    const nova = novo ? newsletterPorId(novo) : undefined;
    if (nova) afetados.add(chave(nova, recebido));
  }

  return afetados;
}

export async function recolher(horas = 24): Promise<ResumoRecolha> {
  const bd = db();
  // Carregado só aqui: o MSAL arrasta dependências pesadas que nao devem
  // entrar no grafo estatico do arranque do Next. O Gmail tem precedência
  // quando está configurado.
  const { temGmail } = await import("./gmail/config.ts");
  const { lerCaixa } = temGmail()
    ? await import("./gmail/mail.ts")
    : await import("./graph/mail.ts");
  // Os já gravados nem chegam a ser descarregados; contam como repetidos.
  const existe = bd.prepare(`SELECT 1 FROM emails WHERE internet_message_id = ?`);
  let jaGravados = 0;
  const mensagens = await lerCaixa(horas, (id) => {
    const sim = existe.get(id) !== undefined;
    if (sim) jaGravados++;
    return sim;
  });

  const inserir = bd.prepare(`
    INSERT OR IGNORE INTO emails
      (internet_message_id, remetente, assunto, recebido_em,
       corpo_html, corpo_normalizado, hash_conteudo, newsletter_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const resumo: ResumoRecolha = {
    vistas: mensagens.length + jaGravados,
    novas: 0,
    repetidas: jaGravados,
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
        afetados.add(chave(n, new Date(m.receivedDateTime)));
      }
    }
  });
  gravar();

  for (const c of reclassificar()) afetados.add(c);

  // Um email novo num dia muda também a comparação de conteúdo da edição
  // seguinte (o "conteúdo repetido" compara com a anterior). Só se reavalia o
  // que já existe: não se criam registos de dias futuros.
  for (const c of [...afetados]) {
    const separador = c.lastIndexOf("|");
    const id = c.slice(0, separador);
    const seguinte = somarDias(c.slice(separador + 1), 1);
    if (registoDe(id, seguinte)) afetados.add(`${id}|${seguinte}`);
  }

  for (const c of afetados) {
    const separador = c.lastIndexOf("|");
    const newsletterId = c.slice(0, separador);
    const data = c.slice(separador + 1);
    if (reavaliar(newsletterId, data)) resumo.registosAtualizados++;
  }

  return resumo;
}
