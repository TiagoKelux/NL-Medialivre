import { extrairTexto } from "./conteudo.ts";
import { diaMes } from "./tempo.ts";

/**
 * Sinal auxiliar: a data que a própria newsletter escreve.
 *
 * Não decide o código. Uma edição que diz "28 de setembro" e chega a 29 é um
 * indício de conteúdo requentado, mas as newsletters também citam datas de
 * eventos e de artigos. Por isso fica como uma frase no detalhe, para quem
 * olha para o registo pesar.
 */

const MESES: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

// O nome do mês tem de acabar ali: "5 marcas" não é 5 de março.
const POR_EXTENSO =
  /\b(\d{1,2})\s+(?:de\s+)?(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)(?![a-zà-ú])\.?(?:\s+(?:de\s+)?(\d{4}))?/gi;
const NUMERICA = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g;
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

function montar(ano: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** As datas escritas no assunto e no corpo, em AAAA-MM-DD, sem repetições. */
export function datasNoEmail(assunto: string, html: string, dataRecebido: string): string[] {
  // Os URLs levam datas de artigos antigos; só conta o texto que se lê.
  const texto = `${assunto}\n${extrairTexto(html)}`.replace(/https?:\/\/\S+/g, " ");
  const anoRecebido = Number(dataRecebido.slice(0, 4));
  const datas = new Set<string>();

  for (const m of texto.matchAll(ISO)) {
    const d = montar(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d) datas.add(d);
  }
  for (const m of texto.matchAll(NUMERICA)) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = montar(ano, Number(m[2]), Number(m[1]));
    if (d) datas.add(d);
  }
  for (const m of texto.matchAll(POR_EXTENSO)) {
    const ano = m[3] ? Number(m[3]) : anoRecebido;
    const d = montar(ano, MESES[m[2].toLowerCase().slice(0, 3)], Number(m[1]));
    if (d) datas.add(d);
  }

  return [...datas];
}

/** A frase que entra no detalhe do registo. */
export function fraseData(datas: string[], dataRecebido: string): string {
  if (datas.length === 0) return "Sem data no email.";
  if (datas.includes(dataRecebido)) return `Data no email: ${diaMes(dataRecebido)} ✓`;

  // A mais próxima do dia de chegada é a candidata a data da edição.
  const alvo = Date.parse(dataRecebido);
  const maisProxima = [...datas].sort(
    (a, b) => Math.abs(Date.parse(a) - alvo) - Math.abs(Date.parse(b) - alvo),
  )[0];
  return `⚠ Data no email: ${diaMes(maisProxima)}, chegou a ${diaMes(dataRecebido)}.`;
}
