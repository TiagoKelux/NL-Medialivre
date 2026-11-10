import { db } from "./db.ts";
import { NEWSLETTERS, newsletterPorId } from "../../config/newsletters.ts";
import { criarPausa, erroDaPausa } from "./pausas.ts";
import { ErroInterpretacao, interpretarAviso, modeloIA, temChaveIA, type PropostaBruta } from "./interpretar-aviso.ts";
import { dataLocal } from "./tempo.ts";

/**
 * Avisos do cliente por email: "a newsletter X não sai no dia Y".
 *
 *   1. Um email de um remetente autorizado (`AVISOS_REMETENTES`,
 *      avisos-remetentes.ts) que chega à caixa fica registado aqui (recolha.ts)
 *      e não conta como edição de nenhuma newsletter.
 *   2. Com `ANTHROPIC_API_KEY`, o ciclo pede ao Claude que o leia
 *      (interpretar-aviso.ts) e guarda as propostas de pausa. Sem chave, o
 *      aviso fica «para tratar à mão» e quem o lê cria a pausa no painel.
 *   3. Cada proposta valida-se com as mesmas regras de uma pausa criada à mão
 *      e, além disso, a citação tem de existir no email. Uma pessoa aplica ou
 *      rejeita cada uma em /avisos. Nada se aplica sozinho.
 *
 * Estados de um aviso: pendente → proposto | sem-ia | erro → tratado.
 */

export type EstadoAviso = "pendente" | "sem-ia" | "proposto" | "erro" | "tratado";
export type EstadoProposta = "por-decidir" | "aplicada" | "rejeitada" | "invalida";

export interface Proposta {
  newsletterId: string;
  de: string;
  ate: string;
  motivo: string;
  citacao: string;
  estado: EstadoProposta;
  erro?: string;
  pausaId?: number;
  decididaPor?: string | null;
  decididaEm?: string;
}

export interface Aviso {
  id: number;
  emailId: number;
  remetente: string;
  assunto: string;
  recebidoEm: string;
  estado: EstadoAviso;
  tentativas: number;
  interpretadoEm: string | null;
  modelo: string | null;
  resumo: string | null;
  propostas: Proposta[];
  outros: string[];
  erro: string | null;
  tratadoEm: string | null;
  tratadoPor: string | null;
  texto: string;
}

/** Tentativas por aviso antes de desistir (cada ciclo tenta outra vez). */
const MAX_TENTATIVAS = 3;
/** Avisos lidos pela IA por ciclo: um email estranho não pode ocupar o ciclo. */
const POR_CICLO = 3;
/** Texto acima disto não se manda: avisa-se em vez de cortar em silêncio. */
const MAX_TEXTO = 60_000;

// ── Texto do email ─────────────────────────────────────────────────────────

const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", ordf: "ª", ordm: "º", euro: "€",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};
/** &atilde; &ccedil; &Eacute;…: a letra com o acento combinado. */
const ACENTOS: Record<string, string> = { acute: "́", grave: "̀", circ: "̂", tilde: "̃", uml: "̈", cedil: "̧" };

function entidade(nome: string): string | undefined {
  const direta = ENTIDADES[nome] ?? ENTIDADES[nome.toLowerCase()];
  if (direta) return direta;
  const m = /^([a-zA-Z])(acute|grave|circ|tilde|uml|cedil)$/.exec(nome);
  return m ? (m[1] + ACENTOS[m[2]]).normalize("NFC") : undefined;
}

/** O HTML do email como texto corrido, com as quebras de parágrafo. */
export function textoDoEmail(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const cod = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(cod) ? String.fromCodePoint(cod) : m;
      }
      return entidade(e) ?? m;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const compacto = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

// ── Validação das propostas (pura) ───────────────────────────────────────────

/**
 * Transforma o que o modelo devolveu em propostas, marcando como inválidas
 * (com o motivo) as que não passam nas regras. Pura, para os testes.
 */
export function validarPropostas(
  brutas: PropostaBruta[],
  texto: string,
  hoje: string,
  existe = (id: string) => !!newsletterPorId(id),
): Proposta[] {
  const corpo = compacto(texto);
  return brutas.map((b) => {
    const p: Proposta = {
      newsletterId: String(b.newsletter_id ?? ""),
      de: String(b.de ?? ""),
      ate: String(b.ate ?? ""),
      motivo: String(b.motivo ?? "").trim().slice(0, 200),
      citacao: String(b.citacao ?? "").trim(),
      estado: "por-decidir",
    };
    const erro = erroDaPausa(p, hoje, existe);
    if (erro) return { ...p, estado: "invalida", erro };
    if (!p.citacao || !corpo.includes(compacto(p.citacao))) {
      return { ...p, estado: "invalida", erro: "A citação não aparece no email: a proposta não tem apoio no texto." };
    }
    return p;
  });
}

// ── Base de dados ─────────────────────────────────────────────────────────────

interface Linha {
  id: number;
  email_id: number;
  remetente: string;
  assunto: string;
  recebido_em: string;
  estado: EstadoAviso;
  tentativas: number;
  interpretado_em: string | null;
  modelo: string | null;
  resumo: string | null;
  propostas: string | null;
  outros: string | null;
  erro: string | null;
  tratado_em: string | null;
  tratado_por: string | null;
}

function json<T>(s: string | null, vazio: T): T {
  if (!s) return vazio;
  try {
    return JSON.parse(s) as T;
  } catch {
    return vazio;
  }
}

function corpoDoEmail(emailId: number): string {
  const e = db().prepare(`SELECT corpo_html FROM emails WHERE id = ?`).get(emailId) as { corpo_html: string } | undefined;
  return e ? textoDoEmail(e.corpo_html) : "";
}

function paraAviso(l: Linha): Aviso {
  return {
    id: l.id,
    emailId: l.email_id,
    remetente: l.remetente,
    assunto: l.assunto,
    recebidoEm: l.recebido_em,
    estado: l.estado,
    tentativas: l.tentativas,
    interpretadoEm: l.interpretado_em,
    modelo: l.modelo,
    resumo: l.resumo,
    propostas: json<Proposta[]>(l.propostas, []),
    outros: json<string[]>(l.outros, []),
    erro: l.erro,
    tratadoEm: l.tratado_em,
    tratadoPor: l.tratado_por,
    texto: corpoDoEmail(l.email_id),
  };
}

/** Os avisos dos últimos `dias`, os por tratar primeiro. */
export function listarAvisos(dias = 90): Aviso[] {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const linhas = db()
    .prepare(
      `SELECT * FROM avisos WHERE recebido_em >= ?
        ORDER BY estado = 'tratado', recebido_em DESC LIMIT 200`,
    )
    .all(desde) as Linha[];
  return linhas.map(paraAviso);
}

function lerAviso(id: number): Linha | undefined {
  return db().prepare(`SELECT * FROM avisos WHERE id = ?`).get(id) as Linha | undefined;
}

function registar(acao: string, detalhe: string, quem: string | null): void {
  db()
    .prepare(`INSERT INTO alteracoes (em, quem, acao, detalhe) VALUES (?, ?, ?, ?)`)
    .run(new Date().toISOString(), quem, acao, detalhe);
}

/** Regista os emails novos de remetentes autorizados (chamado pela recolha). */
export function registarAvisos(emails: { id: number; remetente: string; assunto: string; recebidoEm: string }[]): number {
  const inserir = db().prepare(
    `INSERT OR IGNORE INTO avisos (email_id, remetente, assunto, recebido_em) VALUES (?, ?, ?, ?)`,
  );
  let n = 0;
  for (const e of emails) n += inserir.run(e.id, e.remetente, e.assunto, e.recebidoEm).changes;
  return n;
}

// ── Interpretação (ciclo) ─────────────────────────────────────────────────────

/**
 * Lê os avisos por interpretar. Sem chave, passam a «sem-ia» (o painel mostra
 * o texto para tratar à mão). Com chave, até POR_CICLO por ciclo, incluindo os
 * «sem-ia» de antes de a chave existir e os «erro» com tentativas por gastar.
 * Nunca lança: um erro fica no aviso e o ciclo continua.
 */
export async function interpretarPendentes(): Promise<string | null> {
  const bd = db();
  if (!temChaveIA()) {
    const r = bd.prepare(`UPDATE avisos SET estado = 'sem-ia' WHERE estado = 'pendente'`).run();
    return r.changes > 0 ? `${r.changes} aviso(s) por email para tratar à mão (sem chave de IA)` : null;
  }
  const fila = bd
    .prepare(
      `SELECT * FROM avisos
        WHERE estado IN ('pendente', 'sem-ia') OR (estado = 'erro' AND tentativas < ?)
        ORDER BY recebido_em ASC LIMIT ?`,
    )
    .all(MAX_TENTATIVAS, POR_CICLO) as Linha[];
  if (fila.length === 0) return null;

  const hoje = dataLocal();
  const ativas = NEWSLETTERS.filter((n) => n.ativa);
  let lidos = 0;
  let falhas = 0;
  for (const l of fila) {
    const texto = corpoDoEmail(l.email_id);
    if (texto.length > MAX_TEXTO) {
      bd.prepare(`UPDATE avisos SET estado = 'erro', tentativas = ?, erro = ? WHERE id = ?`).run(
        MAX_TENTATIVAS,
        `Email demasiado longo para ler automaticamente (${texto.length} caracteres): tratar à mão.`,
        l.id,
      );
      falhas++;
      continue;
    }
    try {
      const r = await interpretarAviso({
        assunto: l.assunto,
        texto,
        recebidoEm: dataLocal(new Date(l.recebido_em)),
        hoje,
        newsletters: ativas,
      });
      const propostas = validarPropostas(r.pausas, `${l.assunto}\n${texto}`, hoje);
      bd.prepare(
        `UPDATE avisos SET estado = 'proposto', interpretado_em = ?, modelo = ?, resumo = ?,
                propostas = ?, outros = ?, erro = NULL, tentativas = tentativas + 1
          WHERE id = ?`,
      ).run(new Date().toISOString(), r.modelo, r.resumo, JSON.stringify(propostas), JSON.stringify(r.outros), l.id);
      lidos++;
    } catch (erro) {
      const msg =
        erro instanceof ErroInterpretacao ? erro.message : `falha a chamar a IA: ${(erro as Error).message ?? erro}`;
      bd.prepare(`UPDATE avisos SET estado = 'erro', erro = ?, tentativas = tentativas + 1, modelo = ? WHERE id = ?`).run(
        msg.slice(0, 500),
        modeloIA(),
        l.id,
      );
      falhas++;
    }
  }
  return `${lidos} aviso(s) lido(s) pela IA${falhas > 0 ? `, ${falhas} com erro` : ""}`;
}

// ── Decisões (painel) ─────────────────────────────────────────────────────────

export interface ResultadoAviso {
  ok: boolean;
  mensagem: string;
}

function gravarPropostas(id: number, propostas: Proposta[], quem: string | null): void {
  const fechar = propostas.every((p) => p.estado !== "por-decidir");
  db()
    .prepare(
      `UPDATE avisos SET propostas = ?,
              estado = CASE WHEN ? THEN 'tratado' ELSE estado END,
              tratado_em = CASE WHEN ? THEN ? ELSE tratado_em END,
              tratado_por = CASE WHEN ? THEN ? ELSE tratado_por END
        WHERE id = ?`,
    )
    .run(JSON.stringify(propostas), fechar ? 1 : 0, fechar ? 1 : 0, new Date().toISOString(), fechar ? 1 : 0, quem, id);
}

/** Aplica uma proposta: cria a pausa (com as regras de sempre) e reavalia os dias. */
export function aplicarProposta(avisoId: number, indice: number, quem: string | null): ResultadoAviso {
  const l = lerAviso(avisoId);
  if (!l) return { ok: false, mensagem: "Aviso não encontrado." };
  const propostas = json<Proposta[]>(l.propostas, []);
  const p = propostas[indice];
  if (!p) return { ok: false, mensagem: "Proposta não encontrada." };
  if (p.estado !== "por-decidir") return { ok: false, mensagem: "Essa proposta já foi decidida." };
  const r = criarPausa(p, { tipo: "aviso", avisoId }, quem);
  if (!r.ok) return r;
  propostas[indice] = { ...p, estado: "aplicada", pausaId: r.id, decididaPor: quem, decididaEm: new Date().toISOString() };
  gravarPropostas(avisoId, propostas, quem);
  return r;
}

export function rejeitarProposta(avisoId: number, indice: number, quem: string | null): ResultadoAviso {
  const l = lerAviso(avisoId);
  if (!l) return { ok: false, mensagem: "Aviso não encontrado." };
  const propostas = json<Proposta[]>(l.propostas, []);
  const p = propostas[indice];
  if (!p) return { ok: false, mensagem: "Proposta não encontrada." };
  if (p.estado !== "por-decidir") return { ok: false, mensagem: "Essa proposta já foi decidida." };
  propostas[indice] = { ...p, estado: "rejeitada", decididaPor: quem, decididaEm: new Date().toISOString() };
  gravarPropostas(avisoId, propostas, quem);
  const n = newsletterPorId(p.newsletterId);
  registar("aviso-proposta-rejeitada", `aviso #${avisoId}: ${n ? `${n.marca} · ${n.nome}` : p.newsletterId} ${p.de} a ${p.ate}`, quem);
  return { ok: true, mensagem: "Proposta rejeitada." };
}

/** Dá o aviso por tratado (o que faltava decidir fica rejeitado). */
export function arquivarAviso(avisoId: number, quem: string | null): ResultadoAviso {
  const l = lerAviso(avisoId);
  if (!l) return { ok: false, mensagem: "Aviso não encontrado." };
  if (l.estado === "tratado") return { ok: false, mensagem: "Esse aviso já estava tratado." };
  const agora = new Date().toISOString();
  const propostas = json<Proposta[]>(l.propostas, []).map((p) =>
    p.estado === "por-decidir" ? { ...p, estado: "rejeitada" as const, decididaPor: quem, decididaEm: agora } : p,
  );
  db()
    .prepare(`UPDATE avisos SET estado = 'tratado', propostas = ?, tratado_em = ?, tratado_por = ? WHERE id = ?`)
    .run(JSON.stringify(propostas), agora, quem, avisoId);
  registar("aviso-tratado", `aviso #${avisoId}: «${l.assunto.slice(0, 120)}»`, quem);
  return { ok: true, mensagem: "Aviso dado por tratado." };
}

/** Volta a pedir a leitura à IA (por exemplo, depois de configurar a chave). */
export function reinterpretarAviso(avisoId: number, quem: string | null): ResultadoAviso {
  const l = lerAviso(avisoId);
  if (!l) return { ok: false, mensagem: "Aviso não encontrado." };
  if (!temChaveIA()) return { ok: false, mensagem: "Sem chave de IA configurada: o aviso trata-se à mão." };
  if (json<Proposta[]>(l.propostas, []).some((p) => p.estado === "aplicada")) {
    return { ok: false, mensagem: "Este aviso já tem propostas aplicadas: anule as pausas primeiro, se for o caso." };
  }
  db()
    .prepare(`UPDATE avisos SET estado = 'pendente', tentativas = 0, erro = NULL, tratado_em = NULL, tratado_por = NULL WHERE id = ?`)
    .run(avisoId);
  registar("aviso-reinterpretar", `aviso #${avisoId}`, quem);
  return { ok: true, mensagem: "Pedido registado: o aviso volta a ser lido no próximo ciclo (até 5 minutos)." };
}
