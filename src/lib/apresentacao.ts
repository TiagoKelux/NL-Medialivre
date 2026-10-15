import { DESIGNACOES, type CodigoEstado, type Ressalva } from "./tipos.ts";

/**
 * Como se mostra um registo, para lá do código. Partilhado pelo painel e pelo
 * Excel, para os dois dizerem exatamente o mesmo. Sem base de dados: corre
 * também no browser.
 *
 * - "controlo": newsletter paga (`config/pagas.ts`), "Não Saiu" fechado. A
 *   caixa não está inscrita nelas de propósito; o 5 é o grupo de controlo que
 *   mostra que o motor deteta ausências. Mostra-se o 5, com a indicação.
 * - "sem-email": newsletter gratuita sem remetente configurado — o monitor
 *   não reconhece os seus emails, nenhum estado dela quer dizer nada;
 * - "aguarda": registo ainda antes da hora limite. Na base de dados nasce com
 *   o código 5, mas "Não Saiu" só é verdade depois de fechar;
 * - "sem-prova": a hora limite passou, nada chegou, mas não há prova de
 *   ausência (caixa não inscrita, editor deixou de enviar, sem canário, email
 *   por atribuir que pode ser dela… — o detalhe diz qual);
 * - "por-confirmar": a hora limite passou mas ainda não houve uma leitura da
 *   caixa depois dela (monitor parado, PC desligado, leitura a falhar);
 * - "sem-comparacao": chegou (código 1) mas não havia edição anterior
 *   comparável — "conteúdo atualizado" não está provado.
 * O código 6 (não é dia, desativada) mostra-se sempre como está.
 */
export type Variante =
  | "controlo"
  | "sem-email"
  | "aguarda"
  | "sem-prova"
  | "por-confirmar"
  | "sem-comparacao"
  | null;

export interface Factos {
  codigo: CodigoEstado;
  fechado: boolean;
  limitePassou: boolean;
  /** Newsletter sem remetente configurado. */
  semEmail: boolean;
  paga: boolean;
  ressalva: Ressalva | null;
}

export function variante(f: Factos): Variante {
  if (f.codigo === 6) return null;
  if (f.paga) {
    if (f.codigo === 5 && f.fechado) return "controlo";
  } else if (f.semEmail) {
    return "sem-email";
  }
  if (!f.fechado && f.codigo === 5) {
    if (!f.limitePassou) return "aguarda";
    return f.ressalva === "sem-prova" ? "sem-prova" : "por-confirmar";
  }
  if (f.codigo === 1 && f.ressalva === "sem-comparacao") return "sem-comparacao";
  return null;
}

export const ROTULO: Record<Exclude<Variante, null>, { digito: string; texto: string }> = {
  controlo: { digito: "5", texto: `${DESIGNACOES[5]} (controlo)` },
  "sem-email": { digito: "–", texto: "Não assinada no email" },
  aguarda: { digito: "…", texto: "A aguardar" },
  "sem-prova": { digito: "∅", texto: "Não recebida – sem prova" },
  "por-confirmar": { digito: "?", texto: "Por confirmar" },
  "sem-comparacao": { digito: "S", texto: "Saiu (sem termo de comparação)" },
};

/**
 * O código que o registo pode afirmar, ou null quando a variante o
 * substitui. O "controlo" é um 5 verdadeiro e conta como 5.
 */
export function codigoMostrado(f: Factos): CodigoEstado | null {
  const v = variante(f);
  if (v === null || v === "controlo") return f.codigo;
  return null;
}
