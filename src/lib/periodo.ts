import {
  dataLocal,
  dataPorExtenso,
  diaMes,
  domingoDaSemana,
  intervaloDias,
  nomeMes,
  primeiroDiaDoMes,
  segundaDaSemana,
  somarDias,
  somarMeses,
  ultimoDiaDoMes,
} from "./tempo.ts";

/**
 * A janela de tempo que a página mostra.
 *
 * Cada vista mostra uma unidade — um dia, uma semana, um mês — e navega-se
 * entre elas. É o que permite recuar no histórico sem carregar tudo de uma vez.
 */

export const VISTAS = ["diaria", "semanal", "mensal"] as const;
export type Vista = (typeof VISTAS)[number];

export function ehVista(v: unknown): v is Vista {
  return typeof v === "string" && (VISTAS as readonly string[]).includes(v);
}

export interface Periodo {
  vista: Vista;
  /** O dia que ancora a janela. */
  ancora: string;
  de: string;
  ate: string;
  titulo: string;
  /** Âncoras para navegar; `seguinte` é null quando já se está no presente. */
  anterior: string;
  seguinte: string | null;
  /** O período já contém o dia de hoje? */
  contemHoje: boolean;
}

export function calcularPeriodo(vista: Vista, ancora: string, hoje = dataLocal()): Periodo {
  let de: string;
  let ate: string;
  let titulo: string;
  let anterior: string;
  let seguinte: string;

  switch (vista) {
    case "diaria":
      de = ancora;
      ate = ancora;
      titulo = dataPorExtenso(ancora);
      anterior = somarDias(ancora, -1);
      seguinte = somarDias(ancora, 1);
      break;
    case "semanal":
      de = segundaDaSemana(ancora);
      ate = domingoDaSemana(ancora);
      titulo = `Semana de ${diaMes(de)} a ${diaMes(ate)}`;
      anterior = somarDias(de, -7);
      seguinte = somarDias(de, 7);
      break;
    case "mensal":
      de = primeiroDiaDoMes(ancora);
      ate = ultimoDiaDoMes(ancora);
      titulo = `${nomeMes(ancora)} de ${ancora.slice(0, 4)}`;
      anterior = somarMeses(de, -1);
      seguinte = somarMeses(de, 1);
      break;
  }

  // Não se navega para o futuro: não há registos para lá de hoje.
  const contemHoje = de <= hoje && hoje <= ate;
  return {
    vista,
    ancora,
    de,
    ate,
    titulo,
    anterior,
    seguinte: seguinte > hoje ? null : seguinte,
    contemHoje,
  };
}

/** Os dias do período, cortados em hoje — não há dados no futuro. */
export function diasDoPeriodo(p: Periodo, hoje = dataLocal()): string[] {
  return intervaloDias(p.de, p.ate < hoje ? p.ate : hoje);
}
