import { db } from "./db.ts";
import { newsletterPorId } from "../../config/newsletters.ts";
import { reavaliar, registoDe } from "./registos.ts";
import { dataLocal, somarDias } from "./tempo.ts";

/**
 * Pausas: dias em que uma newsletter, por decisão do cliente, não se espera
 * (feriado, Natal, férias da redação). Entram no motor de estados como um
 * feriado: sem email nesse dia o registo é 6 («não prevista — pausa»), nunca
 * "Não Saiu"; se o email chegar na mesma, conta como saída.
 *
 * Nascem de duas maneiras, sempre por alguém no painel:
 *   - criadas à mão em /avisos;
 *   - aplicadas a partir de uma proposta de um aviso por email (avisos.ts).
 * Nunca se criam sozinhas. Cada uma deixa uma linha em `alteracoes`, e
 * anular não apaga: marca `anulada_em`, para o rasto ficar.
 */

export interface Pausa {
  id: number;
  newsletter_id: string;
  de: string;
  ate: string;
  motivo: string;
  origem: "painel" | "aviso";
  aviso_id: number | null;
  criada_em: string;
  criada_por: string | null;
  anulada_em: string | null;
  anulada_por: string | null;
}

export interface PedidoPausa {
  newsletterId: string;
  de: string;
  ate: string;
  motivo: string;
}

/** Máximo de dias de uma pausa: um engano não pode apagar meses de controlo. */
export const MAX_DIAS_PAUSA = 92;
/** Até quantos dias para trás se aceita uma pausa (o histórico reavaliado é de 45). */
export const MAX_DIAS_PARA_TRAS = 60;
/** Até quantos dias para a frente. */
export const MAX_DIAS_PARA_A_FRENTE = 400;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(d: string): boolean {
  if (!ISO.test(d)) return false;
  const t = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

/**
 * O que está mal no pedido, ou null. Pura: serve ao painel e à validação das
 * propostas da IA, que passam pelas mesmas regras.
 */
export function erroDaPausa(p: PedidoPausa, hoje: string, existe = (id: string) => !!newsletterPorId(id)): string | null {
  if (!existe(p.newsletterId)) return `Newsletter desconhecida: «${p.newsletterId}».`;
  if (!dataValida(p.de) || !dataValida(p.ate)) return "Datas inválidas (AAAA-MM-DD).";
  if (p.ate < p.de) return "A data final é anterior à inicial.";
  if (diasEntre(p.de, p.ate) + 1 > MAX_DIAS_PAUSA) return `Uma pausa não pode passar de ${MAX_DIAS_PAUSA} dias.`;
  if (diasEntre(p.de, hoje) > MAX_DIAS_PARA_TRAS) return `Só se aceitam pausas até ${MAX_DIAS_PARA_TRAS} dias para trás.`;
  if (diasEntre(hoje, p.de) > MAX_DIAS_PARA_A_FRENTE) return "A pausa começa demasiado longe no futuro.";
  const motivo = p.motivo.trim();
  if (motivo.length === 0) return "Falta o motivo.";
  if (motivo.length > 200) return "O motivo é demasiado longo (máximo 200 caracteres).";
  return null;
}

/** A pausa ativa que cobre este dia desta newsletter, se houver. */
export function pausaNoDia(newsletterId: string, data: string): Pausa | null {
  return (
    (db()
      .prepare(
        `SELECT * FROM pausas
          WHERE newsletter_id = ? AND anulada_em IS NULL AND de <= ? AND ate >= ?
          ORDER BY id DESC LIMIT 1`,
      )
      .get(newsletterId, data, data) as Pausa | undefined) ?? null
  );
}

export function listarPausas(): Pausa[] {
  return db().prepare(`SELECT * FROM pausas ORDER BY anulada_em IS NOT NULL, de DESC, id DESC LIMIT 300`).all() as Pausa[];
}

function registar(acao: string, detalhe: string, quem: string | null): void {
  db()
    .prepare(`INSERT INTO alteracoes (em, quem, acao, detalhe) VALUES (?, ?, ?, ?)`)
    .run(new Date().toISOString(), quem, acao, detalhe);
}

/** Reavalia os registos que já existem no intervalo (os futuros nascem com a pausa). */
function reavaliarIntervalo(newsletterId: string, de: string, ate: string): number {
  let n = 0;
  for (let d = de; d <= ate; d = somarDias(d, 1)) {
    if (registoDe(newsletterId, d) && reavaliar(newsletterId, d)) n++;
  }
  return n;
}

export interface ResultadoPausa {
  ok: boolean;
  mensagem: string;
  id?: number;
}

export function criarPausa(
  p: PedidoPausa,
  origem: { tipo: "painel" | "aviso"; avisoId?: number | null },
  quem: string | null,
): ResultadoPausa {
  const erro = erroDaPausa(p, dataLocal());
  if (erro) return { ok: false, mensagem: erro };
  const n = newsletterPorId(p.newsletterId)!;
  const motivo = p.motivo.trim();
  const res = db()
    .prepare(
      `INSERT INTO pausas (newsletter_id, de, ate, motivo, origem, aviso_id, criada_em, criada_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(n.id, p.de, p.ate, motivo, origem.tipo, origem.avisoId ?? null, new Date().toISOString(), quem);
  const id = Number(res.lastInsertRowid);
  registar(
    "pausa-criada",
    `${n.marca} · ${n.nome}: ${p.de}${p.ate !== p.de ? ` a ${p.ate}` : ""} — ${motivo}` +
      (origem.tipo === "aviso" ? ` (aviso #${origem.avisoId})` : ""),
    quem,
  );
  const revistos = reavaliarIntervalo(n.id, p.de, p.ate);
  return {
    ok: true,
    id,
    mensagem: `Pausa registada: ${n.marca} · ${n.nome}, ${p.de}${p.ate !== p.de ? ` a ${p.ate}` : ""}.` +
      (revistos > 0 ? ` ${revistos} dia(s) já registado(s) reavaliado(s).` : ""),
  };
}

export function anularPausa(id: number, quem: string | null): ResultadoPausa {
  const p = db().prepare(`SELECT * FROM pausas WHERE id = ?`).get(id) as Pausa | undefined;
  if (!p) return { ok: false, mensagem: "Pausa não encontrada." };
  if (p.anulada_em) return { ok: false, mensagem: "Essa pausa já estava anulada." };
  db().prepare(`UPDATE pausas SET anulada_em = ?, anulada_por = ? WHERE id = ?`).run(new Date().toISOString(), quem, id);
  const n = newsletterPorId(p.newsletter_id);
  registar("pausa-anulada", `${n ? `${n.marca} · ${n.nome}` : p.newsletter_id}: ${p.de} a ${p.ate} (#${id})`, quem);
  const revistos = reavaliarIntervalo(p.newsletter_id, p.de, p.ate);
  return { ok: true, mensagem: `Pausa anulada.${revistos > 0 ? ` ${revistos} dia(s) reavaliado(s).` : ""}` };
}
