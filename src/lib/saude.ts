import { estadoLeitura } from "./leitura.ts";
import { saudeCaixa, type CaixaCortada, type EstadoDominio } from "./caixa.ts";

/** Acima disto sem uma leitura boa, alguma coisa parou: o ciclo é de 5 min. */
const MAXIMO_MIN = 15;

/**
 * O que o /api/saude devolve. É público (a verificação do Google Cloud
 * Monitoring lê-o sem palavra-passe), por isso só leva o essencial: nem a
 * mensagem de erro em bruto, nem os domínios dos editores.
 */
export interface RespostaSaude {
  saudavel: boolean;
  ultimaLeitura: string | null;
  minutosDesdeLeitura: number | null;
  /** Código genérico se a última leitura falhou; nunca o erro em bruto. */
  falha: "leitura_falhou" | null;
}

/** O que o /api/estado devolve, já atrás da palavra-passe: o detalhe todo. */
export interface EstadoCompleto {
  saudavel: boolean;
  ultimaLeitura: string | null;
  minutosDesdeLeitura: number | null;
  /** A mensagem de erro da última leitura, tal como veio. */
  falha: string | null;
  /** Por domínio do editor: última edição e dias esperados sem diária (caixa.ts). */
  caixa: EstadoDominio[] | null;
  /** Domínios cujas diárias deixaram de chegar (≥ 2 dias esperados). */
  caixaCortada: CaixaCortada[] | null;
}

function leituraAgora(agora: Date) {
  const { ok, falha } = estadoLeitura();
  const minutos = ok ? Math.floor((agora.getTime() - new Date(ok).getTime()) / 60_000) : null;
  // Uma falha isolada do Gmail ("Connection not available") recupera no ciclo
  // seguinte e não é o monitor parado: só conta o tempo desde a última
  // leitura boa. A falha continua a aparecer em `falha` e no painel.
  const saudavel = minutos !== null && minutos <= MAXIMO_MIN;
  return { ok, falha, minutos, saudavel };
}

/**
 * O estado HTTP (200/503) depende SÓ da leitura da caixa — é dele que a
 * verificação externa de disponibilidade depende (procura `"saudavel":true`).
 */
export function respostaSaude(agora: Date = new Date()): { status: 200 | 503; corpo: RespostaSaude } {
  const { ok, falha, minutos, saudavel } = leituraAgora(agora);
  return {
    status: saudavel ? 200 : 503,
    corpo: {
      saudavel,
      ultimaLeitura: ok,
      minutosDesdeLeitura: minutos,
      falha: falha ? "leitura_falhou" : null,
    },
  };
}

/**
 * O detalhe para quem está no painel, com o mesmo 200/503. `caixa` e
 * `caixaCortada` são informação extra: uma caixa cortada pelo editor não é o
 * monitor parado, e não mexe no estado HTTP. Se o cálculo falhar, vêm a null.
 */
export function estadoCompleto(agora: Date = new Date()): { status: 200 | 503; corpo: EstadoCompleto } {
  const { ok, falha, minutos, saudavel } = leituraAgora(agora);

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
