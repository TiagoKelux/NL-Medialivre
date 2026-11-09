import { db } from "./db.ts";
import type { MensagemGraph } from "./graph/mail.ts";
import { corresponder } from "./correspondencia.ts";
import { processarCorpo } from "./conteudo.ts";
import { esquecerCampanhas, extrairMarcas, garantirMarcas, marcasDoEmail, type Marcas } from "./marcas.ts";
import { podeSerDe } from "./prova.ts";
import { abrirPendentes, pixelDeAbertura, SEM_PIXEL, type Pedir } from "./abertura.ts";
import { reavaliar, registoDe } from "./registos.ts";
import { dataEdicao, edicaoAnteriorEmFalta } from "./edicao.ts";
import { NEWSLETTERS, newsletterPorId } from "../../config/newsletters.ts";
import { paraIso, somarDias } from "./tempo.ts";
import type { Newsletter } from "./tipos.ts";

/**
 * Chaves dos registos a reavaliar: a newsletter e o dia da edição do email e,
 * se esse dia não tem edição própria, a edição anterior — o email pode ser
 * ela a sair tarde (`emailsDaEdicao`).
 */
function chaves(n: Newsletter, recebido: Date): string[] {
  const dia = dataEdicao(n, recebido);
  const anterior = edicaoAnteriorEmFalta(n, dia);
  return anterior ? [`${n.id}|${dia}`, `${n.id}|${anterior}`] : [`${n.id}|${dia}`];
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
  /**
   * Emails marcados como abertos no editor neste ciclo (`abertura.ts`): os
   * novos e os da última semana cujo pixel tinha falhado.
   */
  abertos: number;
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
 *
 * Não lê o `corpo_html`: usa as marcas extraídas à entrada (`emails.marcas`).
 * As que faltem ou sejam de outra configuração extraem-se primeiro, uma vez.
 */
export function reclassificar(): Set<string> {
  const bd = db();
  garantirMarcas();
  esquecerCampanhas();
  const emails = bd
    // O índice de cobertura (db.ts) evita atravessar as páginas de overflow
    // dos corpos; `INDEXED BY` impede o planeador de preferir a tabela.
    .prepare(
      `SELECT id, remetente, assunto, marcas, recebido_em, newsletter_id
         FROM emails INDEXED BY idx_emails_identificacao`,
    )
    .all() as {
      id: number;
      remetente: string;
      assunto: string;
      marcas: string | null;
      recebido_em: string;
      newsletter_id: string | null;
    }[];

  const atualizar = bd.prepare(`UPDATE emails SET newsletter_id = ? WHERE id = ?`);
  const afetados = new Set<string>();

  for (const e of emails) {
    const m = marcasDoEmail(e.id, e.marcas);
    const novo = corresponder(e.remetente, e.assunto, m)?.id ?? null;
    if (novo === e.newsletter_id) continue;
    atualizar.run(novo, e.id);
    esquecerCampanhas();
    const recebido = new Date(e.recebido_em);
    const antiga = e.newsletter_id ? newsletterPorId(e.newsletter_id) : undefined;
    if (antiga) for (const c of chaves(antiga, recebido)) afetados.add(c);
    const nova = novo ? newsletterPorId(novo) : undefined;
    if (nova) for (const c of chaves(nova, recebido)) afetados.add(c);
    // Deixou de contar para uma newsletter: pode travar o "Não Saiu" de outras.
    if (!novo) for (const c of plausiveis(e.remetente, e.assunto, m, recebido)) afetados.add(c);
  }

  return afetados;
}

/** Quem lê a caixa: o Gmail, o Graph, ou (nos testes) uma lista fixa. */
export type LeitorCaixa = (
  horas: number,
  conhecido?: (internetMessageId: string) => boolean,
) => Promise<MensagemGraph[]>;

async function leitorPadrao(): Promise<LeitorCaixa> {
  // Carregado só aqui: o MSAL arrasta dependências pesadas que nao devem
  // entrar no grafo estatico do arranque do Next. O Gmail tem precedência
  // quando está configurado.
  const { temGmail } = await import("./gmail/config.ts");
  const { lerCaixa } = temGmail()
    ? await import("./gmail/mail.ts")
    : await import("./graph/mail.ts");
  return lerCaixa;
}

/**
 * Um email que ficou por atribuir pode ser a edição de uma newsletter cujo
 * "Não Saiu" já fechou (chegou mais tarde na janela, com um nome que nenhuma
 * regra conhece). A prova de ausência dessas newsletters tem de ser revista:
 * devolve os pares newsletter|dia a reavaliar, só dos registos que existem.
 */
function plausiveis(remetente: string, assunto: string, marcas: Marcas, recebido: Date): string[] {
  const chaves: string[] = [];
  for (const n of NEWSLETTERS) {
    if (!n.ativa || !podeSerDe(n, remetente, assunto, marcas)) continue;
    const dia = dataEdicao(n, recebido);
    if (registoDe(n.id, dia)) chaves.push(`${n.id}|${dia}`);
  }
  return chaves;
}

export async function recolher(horas = 24, ler?: LeitorCaixa, pedir?: Pedir): Promise<ResumoRecolha> {
  const bd = db();
  const lerCaixa = ler ?? (await leitorPadrao());
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
       corpo_html, corpo_normalizado, hash_conteudo, newsletter_id, marcas, abertura_falhas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const resumo: ResumoRecolha = {
    vistas: mensagens.length + jaGravados,
    novas: 0,
    repetidas: jaGravados,
    atribuidas: 0,
    registosAtualizados: 0,
    abertos: 0,
  };
  // O mais antigo dos novos: um email que só agora se leu (o monitor esteve
  // parado) abre-se na mesma, mesmo que seja de antes da última semana.
  let novoMaisAntigo: Date | null = null;

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
      const marcas = extrairMarcas(html);
      const n = corresponder(remetente, assunto, marcas);

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
        JSON.stringify(marcas),
        // Sem o pixel do SES não há nada a abrir: nem chega a ser candidato.
        pixelDeAbertura(html) ? 0 : SEM_PIXEL,
      );

      // changes === 0 significa que o UNIQUE rejeitou: é o mesmo email outra
      // vez. Não conta como ocorrência (critério 5).
      if (res.changes === 0) {
        resumo.repetidas++;
        continue;
      }

      resumo.novas++;
      const recebido = new Date(m.receivedDateTime);
      if (!novoMaisAntigo || recebido < novoMaisAntigo) novoMaisAntigo = recebido;
      if (n) {
        resumo.atribuidas++;
        for (const c of chaves(n, new Date(m.receivedDateTime))) afetados.add(c);
      } else {
        for (const c of plausiveis(remetente, assunto, marcas, new Date(m.receivedDateTime))) afetados.add(c);
      }
    }
  });
  gravar();

  for (const c of reclassificar()) afetados.add(c);

  resumo.registosAtualizados = reavaliarAfetados(afetados);
  // Depois de tudo gravado: abrir os novos e voltar a tentar os da última
  // semana cujo pixel falhou, para o editor não cortar as listas.
  resumo.abertos = (await abrirPendentes(new Date(), pedir, novoMaisAntigo)).abertos;
  return resumo;
}

/**
 * Reavalia os pares `newsletterId|data` afetados. Um email novo num dia muda
 * também a comparação de conteúdo da edição seguinte (o "conteúdo repetido"
 * compara com a anterior). Só se reavalia o que já existe: não se criam
 * registos de dias futuros. Devolve quantos registos foram atualizados.
 */
export function reavaliarAfetados(afetados: Iterable<string>): number {
  const todos = new Set(afetados);
  for (const c of [...todos]) {
    const separador = c.lastIndexOf("|");
    const id = c.slice(0, separador);
    const seguinte = somarDias(c.slice(separador + 1), 1);
    if (registoDe(id, seguinte)) todos.add(`${id}|${seguinte}`);
  }

  let atualizados = 0;
  for (const c of todos) {
    const separador = c.lastIndexOf("|");
    if (reavaliar(c.slice(0, separador), c.slice(separador + 1))) atualizados++;
  }
  return atualizados;
}

/**
 * Reavalia as edições destes emails (pelo id), por exemplo quando os seus
 * artigos ganharam data de publicação. Devolve quantos registos mudaram.
 */
export function reavaliarEmails(ids: number[]): number {
  const ler = db().prepare(`SELECT newsletter_id, recebido_em FROM emails WHERE id = ?`);
  const chavesAfetadas = new Set<string>();
  for (const id of ids) {
    const l = ler.get(id) as { newsletter_id: string | null; recebido_em: string } | undefined;
    const n = l?.newsletter_id ? newsletterPorId(l.newsletter_id) : undefined;
    if (!n || !l) continue;
    const dia = dataEdicao(n, new Date(l.recebido_em));
    if (registoDe(n.id, dia)) chavesAfetadas.add(`${n.id}|${dia}`);
  }
  return reavaliarAfetados(chavesAfetadas);
}
