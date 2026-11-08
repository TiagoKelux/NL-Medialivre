import type { Newsletter } from "./tipos.ts";
import { dataLocal, diaSemanaISO, paraInstante, somarDias } from "./tempo.ts";
import { feriado } from "./feriados.ts";
import { ehDiaEsperado } from "./classificacao.ts";

/**
 * A que edição (dia) pertence um email.
 *
 * Contar pelo dia do calendário falha nas pontas: a Edição Noite das 21h que
 * chegue às 00h30 caía no dia seguinte — "Não Saiu" num dia e "Duplicada" no
 * outro, os dois falsos. A edição de um dia D é tudo o que chega entre 6 h
 * antes e 18 h depois da hora prevista em D: cada instante pertence a uma
 * edição só, e uma newsletter que saia uma vez por dia nunca tem duas
 * edições na mesma janela.
 *
 * Regra do cliente (08/11/2026): até à hora limite (hora prevista + 30 min)
 * é "Saiu"; depois disso, nada recebido é "Não Saiu" (com prova), e um email
 * que chegue mais tarde — horas ou dias — passa o registo a "Saiu Atrasada"
 * (saiu tarde), retroativamente. Não há "Não Saiu" para um email que chegou.
 * As 6 h antes cobrem com folga os adiantamentos reais (29/09 a 15/10: o
 * maior foi 1 h 27 min, a Boa Tarde do CM).
 */
export const ANTECEDENCIA_MIN = 6 * 60;

/** A janela da hora prevista: depois disto é "Saiu Atrasada" (tarde). */
export const TOLERANCIA_MIN = 30;

/**
 * Até quantos dias depois de uma edição em falta um email da newsletter, num
 * dia que não é de envio, ainda conta como essa edição a sair tarde.
 */
export const DIAS_EDICAO_TARDIA = 31;

function minutosDe(hora: string): number {
  const [hh, mm] = hora.split(":").map(Number);
  return hh * 60 + mm;
}

/** O dia da edição a que pertence um email desta newsletter recebido neste instante. */
export function dataEdicao(n: Newsletter, recebido: Date): string {
  // Desloca-se o instante para que a janela [prevista − 6 h, prevista + 18 h[
  // coincida com o dia local inteiro. Na noite da mudança da hora o erro é de
  // uma hora, numa janela de 24 — irrelevante.
  const desvio = ANTECEDENCIA_MIN - minutosDe(n.horaPrevista);
  return dataLocal(new Date(recebido.getTime() + desvio * 60_000));
}

/**
 * Este dia tem edição própria? Os dias de envio do calendário e, numa "dias
 * úteis", os feriados de semana (umas saem nos feriados e outras não).
 */
export function temEdicaoPropria(n: Newsletter, data: string): boolean {
  if (ehDiaEsperado(n, data)) return true;
  const dow = diaSemanaISO(data);
  return n.periodicidade === "dias_uteis" && dow <= 5 && feriado(data) !== null;
}

/**
 * Os dias sem edição própria a seguir a uma edição: um email que caia num
 * deles (uma semanal que sai três dias depois) é essa edição a sair tarde,
 * se ela não tiver chegado na sua janela. Só os dias até hoje.
 */
export function diasSeguintesSemEdicao(n: Newsletter, data: string, hoje: string = dataLocal()): string[] {
  const dias: string[] = [];
  for (let d = somarDias(data, 1), i = 0; d <= hoje && i < DIAS_EDICAO_TARDIA; d = somarDias(d, 1), i++) {
    if (temEdicaoPropria(n, d)) break;
    dias.push(d);
  }
  return dias;
}

/**
 * A edição em falta para a qual pode contar um email recebido num dia sem
 * edição própria: a última edição antes dele, até DIAS_EDICAO_TARDIA. null se
 * o dia tem edição própria ou não há nenhuma antes.
 */
export function edicaoAnteriorEmFalta(n: Newsletter, dia: string): string | null {
  if (n.periodicidade === "nao_agendada" || temEdicaoPropria(n, dia)) return null;
  for (let d = somarDias(dia, -1), i = 0; i < DIAS_EDICAO_TARDIA; d = somarDias(d, -1), i++) {
    if (temEdicaoPropria(n, d)) return d;
  }
  return null;
}

/**
 * Intervalo de instantes onde procurar os emails de uma edição: folgado de um
 * dia para cada lado, e afinado depois com `dataEdicao`.
 */
export function intervaloDeBusca(de: string, ate: string = de): { inicio: Date; fim: Date } {
  return {
    inicio: paraInstante(somarDias(de, -1), "00:00"),
    fim: paraInstante(somarDias(ate, 2), "00:00"),
  };
}
