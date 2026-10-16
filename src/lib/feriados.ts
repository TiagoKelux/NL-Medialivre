import { somarDias } from "./tempo.ts";

/**
 * Feriados nacionais obrigatórios (Código do Trabalho, art. 234.º). O Carnaval
 * e os feriados municipais não contam: não são nacionais.
 *
 * Servem só às newsletters de "dias úteis": num feriado não se espera nada
 * delas. Se nada chegar, o dia fica 6 ("Não prevista – feriado"); se chegar,
 * conta como qualquer outro dia. A 05/10/2026 (segunda, feriado) saíram a
 * Abertura, a Opinião, a Tecnologia e o Fecho do Negócios, e a 5 Coisas não:
 * num feriado umas saem e outras não, por isso o feriado nunca dá "Não Saiu",
 * mas também nunca esconde uma edição que chegou.
 */
const FIXOS: Record<string, string> = {
  "01-01": "Ano Novo",
  "04-25": "Dia da Liberdade",
  "05-01": "Dia do Trabalhador",
  "06-10": "Dia de Portugal",
  "08-15": "Assunção de Nossa Senhora",
  "10-05": "Implantação da República",
  "11-01": "Dia de Todos os Santos",
  "12-01": "Restauração da Independência",
  "12-08": "Imaculada Conceição",
  "12-25": "Natal",
};

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** O nome do feriado nacional neste dia ("AAAA-MM-DD"), ou null. */
export function feriado(data: string): string | null {
  const fixo = FIXOS[data.slice(5)];
  if (fixo) return fixo;
  const p = pascoa(Number(data.slice(0, 4)));
  if (data === somarDias(p, -2)) return "Sexta-feira Santa";
  if (data === p) return "Páscoa";
  if (data === somarDias(p, 60)) return "Corpo de Deus";
  return null;
}
