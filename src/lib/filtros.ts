import type { Newsletter } from "./tipos.ts";

/**
 * Os filtros de periodicidade, partilhados pela página e pela exportação —
 * para o que se descarrega ser exatamente o que se está a ver.
 */

export const TODAS = "todas";

const NOMES_DIAS = ["2ª", "3ª", "4ª", "5ª", "6ª", "Sábado", "Domingo"];

/** As chaves de filtro a que uma newsletter pertence. */
export function chavesDe(c: Pick<Newsletter, "periodicidade" | "diasSemana">): string[] {
  switch (c.periodicidade) {
    case "diaria":
      return ["diaria"];
    case "dias_uteis":
      return ["dias_uteis"];
    case "dia_semana":
      // Uma semanal com mais do que um dia entra no filtro de cada um deles.
      return (c.diasSemana ?? []).map((d) => `dia:${d}`);
    case "dia_mes":
      return ["dia_mes"];
    case "nao_agendada":
      return ["nao_agendada"];
  }
}

export function rotuloDe(chave: string): string {
  if (chave === "diaria") return "Todos os dias";
  if (chave === "dias_uteis") return "2ª a 6ª";
  if (chave === "dia_mes") return "Dia do mês";
  if (chave === "nao_agendada") return "Sem agenda";
  return NOMES_DIAS[Number(chave.slice(4)) - 1] ?? chave;
}

/** Ordem: diárias, dias úteis, 2ª → domingo, depois as que não têm agenda. */
export function peso(chave: string): number {
  if (chave === "diaria") return 0;
  if (chave === "dias_uteis") return 1;
  if (chave === "dia_mes") return 10;
  if (chave === "nao_agendada") return 11;
  return 1 + Number(chave.slice(4));
}
