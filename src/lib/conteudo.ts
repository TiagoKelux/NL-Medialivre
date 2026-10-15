import { createHash } from "node:crypto";

/**
 * Normalização mínima do corpo do email (§7.4 da spec).
 *
 * O objetivo é apagar tudo o que muda entre dois envios sem que o conteúdo
 * tenha mudado — pixels de tracking, parâmetros de campanha, a data no
 * cabeçalho — e deixar só o texto. O hash compara-se por igualdade exata; a
 * semelhança aproximada faz-se pelos artigos (ver "Artigos", mais abaixo).
 */

/**
 * Entidades HTML com nome. As 96 do Latin-1 (U+00A0 a U+00FF, por ordem),
 * que cobrem todas as letras acentuadas do português, mais as tipográficas
 * que as newsletters usam. Distinguem maiúsculas: `&Aacute;` é "Á".
 */
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr " +
  "deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest " +
  "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml " +
  "ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
  "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml " +
  "eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml";

const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  hellip: "…", mdash: "—", ndash: "–", minus: "−", bull: "•", middot: "·",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›",
  euro: "€", trade: "™", dagger: "†", Dagger: "‡", permil: "‰",
  OElig: "Œ", oelig: "œ", Scaron: "Š", scaron: "š", Yuml: "Ÿ", fnof: "ƒ", circ: "ˆ", tilde: "˜",
  ensp: " ", emsp: " ", thinsp: " ", zwnj: "", zwj: "", lrm: "", rlm: "",
};
LATIN1.split(" ").forEach((nome, i) => {
  ENTIDADES[nome] = String.fromCodePoint(0xa0 + i);
});
ENTIDADES.nbsp = " ";
ENTIDADES.shy = "";

function deCodigo(n: number): string {
  // Fora do Unicode, ou um surrogate solto: não é um carácter, fica um espaço.
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return " ";
  return n === 0xa0 ? " " : String.fromCodePoint(n);
}

/**
 * Descodifica as entidades HTML: decimais (`&#231;`), hexadecimais (`&#xe7;`,
 * frequentes na Flash) e com nome. Uma entidade com nome desconhecida fica
 * como está — trocá-la por um espaço partia palavras ("Mar&#xe7;o" deixava de
 * ser um mês e a data no email não era reconhecida).
 */
export function descodificarEntidades(texto: string): string {
  return texto.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/g, (inteira, dec, hex, nome) => {
    if (dec !== undefined) return deCodigo(Number.parseInt(dec, 10));
    if (hex !== undefined) return deCodigo(Number.parseInt(hex, 16));
    return ENTIDADES[nome] ?? ENTIDADES[nome.toLowerCase()] ?? inteira;
  });
}

/** 1. Extrair texto do HTML. */
export function extrairTexto(html: string): string {
  return descodificarEntidades(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|td|h[1-6]|li)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

/**
 * 1b. As imagens como texto: o endereço e o `alt` de cada uma.
 *
 * Há newsletters feitas quase só de imagens (capas, banners). Sem isto, o texto
 * que sobra é o rodapé, igual todos os dias, e cada edição nova sairia como
 * código 4. Uma edição nova traz quase sempre imagens com endereços novos.
 *
 * Os pixels de tracking ficam de fora: mudam a cada envio e fariam com que
 * nenhuma edição fosse alguma vez igual à anterior.
 */
const PIXEL = /\b(width|height)\s*=\s*["']?[01]\b|track|pixel|beacon|\/open\b/i;

export function extrairImagens(html: string): string {
  const linhas: string[] = [];
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    if (PIXEL.test(tag)) continue;
    const src = descodificarEntidades((tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i) ?? [])[1] ?? "");
    const alt = descodificarEntidades((tag.match(/\balt\s*=\s*["']([^"']*)["']/i) ?? [])[1] ?? "");
    if (!src && !alt) continue;
    linhas.push(`[img] ${src.split(/[?#]/)[0]} ${alt}`);
  }
  return linhas.join("\n");
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

/**
 * O texto perde as datas; as imagens não. O endereço de uma imagem leva
 * números que parecem datas (`img_828x523uu2026-…-15-32-44-413052.jpg`):
 * cortá-los podia fazer duas imagens diferentes parecerem a mesma.
 */
export function normalizar(html: string): string {
  const texto = colapsar(removerDatas(limparUrls(extrairTexto(html))));
  const imagens = colapsar(extrairImagens(html));
  return [texto, imagens].filter(Boolean).join("\n");
}

export function hashConteudo(normalizado: string): string {
  return createHash("sha256").update(normalizado, "utf8").digest("hex");
}

// ── Artigos ────────────────────────────────────────────────────────────────

/**
 * Os artigos para onde a edição aponta, como sinal de conteúdo repetido.
 *
 * O hash só apanha cópias exatas. Uma edição que é a de ontem com mais um
 * bloco (maxima-geral a 02/10: 6 de 7 artigos iguais) tem hash diferente e
 * passava por conteúdo novo. Os links dos artigos, desembrulhados do
 * tracking e sem parâmetros, são o que a edição realmente oferece.
 */

/** Um redirecionador de tracking: o destino vem dentro do próprio endereço. */
function desembrulharUmaVez(url: string): string | null {
  // Amazon SES: https://<id>.r.<região>.awstrack.me/L0/<destino codificado>/<n>/<id da mensagem>/<assinatura>
  const ses = url.match(/^https?:\/\/[^/]*awstrack\.me\/L\d+\/(.+)$/i);
  if (ses) {
    const destino = ses[1].replace(/\/\d+\/[0-9a-f]{16}-[0-9a-f-]+-0{6}\/[^/]*$/i, "");
    return decodificarUrl(destino);
  }
  // Echobox e outros: o destino num parâmetro da query.
  const q = url.match(/[?&](?:url|u|redirect|redirect_url|target|dest|destination|link)=(https?(?::|%3A)[^&#]+)/i);
  if (q && /echobox|click|track|redirect|link|email|mail/i.test(url.split(/[?#]/)[0])) {
    return decodificarUrl(q[1]);
  }
  return null;
}

function decodificarUrl(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Do href ao endereço canónico do destino: sem tracking, sem query nem fragmento. */
export function desembrulharLink(href: string): string {
  let url = descodificarEntidades(href.trim());
  for (let i = 0; i < 4; i++) {
    const dentro = desembrulharUmaVez(url);
    if (!dentro || dentro === url) break;
    url = dentro;
  }
  const m = url.match(/^https?:\/\/([^/?#]+)([^?#]*)/i);
  if (!m) return "";
  const host = m[1].toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "");
  const caminho = m[2].replace(/\/+$/, "");
  return `${host}${caminho}`;
}

/** Destinos que nunca são artigos da marca. */
const HOST_FORA =
  /(^|\.)(facebook|instagram|twitter|x|linkedin|youtube|youtu|tiktok|whatsapp|pinterest|threads|t)\.(com|me|net|be)$|(^|\.)(apple|google|doubleclick|googlesyndication|googleapis|adnxs|echobox|campaign-list|awstrack|amazonaws|mailchimp|list-manage|bit)\.|^(apps|itunes|play)\./i;

/**
 * Páginas da marca que não são artigos: subscrições, conta, assinaturas,
 * cotações, passatempos. Compara-se o segmento inteiro do caminho — o slug de
 * um artigo pode conter "conta" ou "assinatura" ("contas-aprovadas-…").
 */
const SEGMENTO_FORA = new Set([
  "unsubscribe", "subscribe", "subscrever", "subscrevernewsletters", "newsletter", "newsletters",
  "preferencias", "login", "registo", "conta", "personalarea", "assinaturas", "assinatura", "compra",
  "loja", "store", "app", "apps", "privacidade", "privacy", "termos", "cookies", "contactos",
  "institucional", "ficha-tecnica", "estatuto-editorial", "cotacoes", "cotacao", "passatempos",
  "viewinbrowser", "share", "sharer",
]);
const FICHEIRO = /\.(jpe?g|png|gif|webp|svg|css|js|pdf|ico)$/i;

/**
 * Um artigo: endereço de um site editorial com um caminho que identifica uma
 * peça — um slug de três ou mais palavras, um identificador numérico, ou um
 * slug curto logo a seguir a "/detalhe/" (as crónicas: ".../detalhe/cris-aquece").
 * A página inicial e as secções ("/moda", "/desporto") não contam: estão em
 * todas as edições.
 */
export function ehArtigo(destino: string): boolean {
  if (!destino) return false;
  const barra = destino.indexOf("/");
  if (barra < 0) return false;
  const host = destino.slice(0, barra);
  const caminho = destino.slice(barra);
  if (HOST_FORA.test(host) || FICHEIRO.test(caminho)) return false;
  const segmentos = caminho.split("/").filter(Boolean);
  if (segmentos.length < 2) return false;
  if (segmentos.some((s) => SEGMENTO_FORA.has(s.toLowerCase()))) return false;
  if (segmentos.some((s) => /^[a-z0-9]+(?:-[a-z0-9]+){2,}$/i.test(s) || /^\d{4,}$/.test(s))) return true;
  const ultimo = segmentos[segmentos.length - 1];
  const antes = segmentos[segmentos.length - 2].toLowerCase();
  return /^(detalhe|artigo|noticia|article|news)$/.test(antes) && /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(ultimo);
}

/** Os artigos distintos para onde o HTML aponta, por ordem de aparição. */
export function extrairArtigos(html: string): string[] {
  const vistos = new Set<string>();
  for (const [, href] of (html || "").matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const destino = desembrulharLink(href);
    if (ehArtigo(destino)) vistos.add(destino);
  }
  return [...vistos];
}

export interface Semelhanca {
  /** Artigos da edição atual que já estavam na anterior. */
  iguais: number;
  /** Artigos da edição atual. */
  total: number;
  /** |A ∩ B| / |A ∪ B|. */
  jaccard: number;
}

export function semelhancaArtigos(atual: string[], anterior: string[]): Semelhanca | null {
  const a = new Set(atual);
  const b = new Set(anterior);
  if (a.size === 0 || b.size === 0) return null;
  let iguais = 0;
  for (const x of a) if (b.has(x)) iguais++;
  return { iguais, total: a.size, jaccard: iguais / (a.size + b.size - iguais) };
}

/** Conveniência: do HTML em bruto ao par que se grava na tabela `emails`. */
export function processarCorpo(html: string): { normalizado: string; hash: string } {
  const normalizado = normalizar(html || "");
  return { normalizado, hash: hashConteudo(normalizado) };
}
