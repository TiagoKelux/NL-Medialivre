import { estadoLeitura } from "./leitura.ts";
import { saudeCaixa, type CaixaCortada, type EstadoDominio } from "./caixa.ts";

/** Acima disto sem uma leitura boa, alguma coisa parou: o ciclo é de 5 min. */
const MAXIMO_MIN = 15;

export interface RespostaSaude {
  saudavel: boolean;
  ultimaLeitura: string | null;
  minutosDesdeLeitura: number | null;
  falha: string | null;
  /** Por domínio do editor: última edição e dias esperados sem diária (caixa.ts). */
  caixa: EstadoDominio[] | null;
  /** Domínios cujas diárias deixaram de chegar (≥ 2 dias esperados). */
  caixaCortada: CaixaCortada[] | null;
}

/**
 * O que o /api/saude devolve. O estado HTTP (200/503) depende SÓ da leitura
 * da caixa — é dele que a verificação externa de disponibilidade depende.
 * `caixa` e `caixaCortada` são informação extra: uma caixa cortada pelo
 * editor não é o monitor parado. Se o cálculo falhar, vêm a null.
 */
export function respostaSaude(agora: Date = new Date()): { status: 200 | 503; corpo: RespostaSaude } {
  const { ok, falha } = estadoLeitura();
  const minutos = ok ? Math.floor((agora.getTime() - new Date(ok).getTime()) / 60_000) : null;
  const saudavel = !falha && minutos !== null && minutos <= MAXIMO_MIN;

  let caixa: ReturnType<typeof saudeCaixa> | null = null;
  try {
    caixa = saudeCaixa(agora);
  } catch {
    caixa = null;
  }

  return {
    status: saudavel ? 200 : 503,
    corpo: {
      saudavel,
      ultimaLeitura: ok,
      minutosDesdeLeitura: minutos,
      falha: falha?.erro ?? null,
      caixa: caixa?.dominios ?? null,
      caixaCortada: caixa?.caixaCortada ?? null,
    },
  };
}
