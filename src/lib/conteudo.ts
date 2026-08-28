import { createHash } from "node:crypto";

/**
 * Normalização mínima do corpo do email (§7.4 da spec).
 *
 * O objetivo é apagar tudo o que muda entre dois envios sem que o conteúdo
 * tenha mudado — pixels de tracking, parâmetros de campanha, a data no
 * cabeçalho — e deixar só o texto. Só se compara igualdade exata do hash;
 * não há limiar de similaridade nesta versão.
 */

const ENTIDADES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
  "&aacute;": "á",
  "&eacute;": "é",
  "&iacute;": "í",
  "&oacute;": "ó",
  "&uacute;": "ú",
  "&atilde;": "ã",
  "&otilde;": "õ",
  "&ccedil;": "ç",
  "&agrave;": "à",
  "&acirc;": "â",
  "&ecirc;": "ê",
  "&ocirc;": "ô",
};

/** 1. Extrair texto do HTML. */
export function extrairTexto(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? " ");
}

/**
 * 2. Remover parâmetros de query de todos os URLs.
 *
 * Depois de tirar as tags, os href de tracking já desapareceram; isto apanha
 * os URLs que sobram escritos no texto visível.
 */
function limparUrls(texto: string): string {
  return texto.replace(/https?:\/\/[^\s<>"']+/gi, (url) => url.split(/[?#]/)[0]);
}

/**
 * 3. Remover datas em formato reconhecível.
 *
 * A data no cabeçalho da newsletter muda todos os dias sem que o conteúdo mude;
 * se ficasse, nenhuma edição seria alguma vez igual à anterior e o código 4
 * nunca dispararia.
 */
const DATA_ISO = /\b\d{4}-\d{2}-\d{2}\b/g;
const DATA_NUMERICA = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g;
const DATA_POR_EXTENSO =
  /\b\d{1,2}\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(\s+de\s+\d{4})?\b/gi;
const DATA_MES_CURTO = /\b\d{1,2}\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?\s*\d{0,4}\b/gi;
const DIA_SEMANA = /\b(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)(-feira)?\b/gi;
const HORA = /\b\d{1,2}[:h]\d{2}\b/gi;

function removerDatas(texto: string): string {
  return texto
    .replace(DATA_ISO, " ")
    .replace(DATA_NUMERICA, " ")
    .replace(DATA_POR_EXTENSO, " ")
    .replace(DATA_MES_CURTO, " ")
    .replace(DIA_SEMANA, " ")
    .replace(HORA, " ");
}

/** 4. Colapsar espaços, minúsculas. */
function colapsar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizar(html: string): string {
  return colapsar(removerDatas(limparUrls(extrairTexto(html))));
}

export function hashConteudo(normalizado: string): string {
  return createHash("sha256").update(normalizado, "utf8").digest("hex");
}

/** Conveniência: do HTML em bruto ao par que se grava na tabela `emails`. */
export function processarCorpo(html: string): { normalizado: string; hash: string } {
  const normalizado = normalizar(html || "");
  return { normalizado, hash: hashConteudo(normalizado) };
}
