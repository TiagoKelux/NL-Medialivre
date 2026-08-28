import type { Newsletter } from "../src/lib/tipos.ts";

/**
 * As três newsletters do protótipo (§3 da spec).
 *
 * `remetentes` e `padraoAssunto` são o único bloqueio: não estão no Excel e
 * têm de vir de emails reais. Enquanto estiverem por preencher, o sistema
 * recolhe e grava os emails mas não os classifica.
 */
export const NEWSLETTERS: Newsletter[] = [
  {
    id: "cm-exclusivos",
    marca: "CM",
    nome: "Exclusivos",
    periodicidade: "diaria",
    diasSemana: null,
    horaPrevista: "06:00",
    toleranciaMinutos: 60,
    remetentes: [],
    padraoAssunto: "",
    ativa: true,
  },
  {
    id: "flash-moda-beleza",
    marca: "Flash",
    nome: "Moda e Beleza",
    periodicidade: "dias_uteis",
    diasSemana: null,
    horaPrevista: "15:00",
    toleranciaMinutos: 60,
    remetentes: [],
    padraoAssunto: "",
    ativa: true,
  },
  {
    id: "negocios-ip",
    marca: "Negócios",
    nome: "IP",
    periodicidade: "dia_semana",
    diasSemana: [1], // segunda
    horaPrevista: "14:00",
    toleranciaMinutos: 60,
    remetentes: [],
    padraoAssunto: "",
    ativa: true,
  },
];

export function newsletterPorId(id: string): Newsletter | undefined {
  return NEWSLETTERS.find((n) => n.id === id);
}

/** Uma newsletter está configurada quando já sabe reconhecer os seus emails. */
export function estaConfigurada(n: Newsletter): boolean {
  return n.remetentes.length > 0 && n.padraoAssunto.trim() !== "";
}
