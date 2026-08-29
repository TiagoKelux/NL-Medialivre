/**
 * HTML de newsletter → Markdown legível, e o resumo executivo.
 *
 * Não é um conversor de HTML genérico: é afinado para emails, que são tabelas
 * dentro de tabelas com estilos inline. O que interessa é o texto, os títulos
 * e os links — o resto é andaime de layout e deita-se fora.
 *
 * Escrito à mão em vez de trazer um turndown: evita mais uma dependência num
 * projeto que já teve problemas a instalar módulos nativos.
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
  "&laquo;": "«",
  "&raquo;": "»",
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

function decodificar(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&[a-zA-Z]+;/g, (e) => ENTIDADES[e] ?? ENTIDADES[e.toLowerCase()] ?? " ");
}

/**
 * Os links das newsletters vêm embrulhados em redirecionadores de tracking
 * (`awstrack.me/L0/<url codificado>/2/<id>/<hash>`), às vezes duas vezes. Sem
 * desembrulhar, cada link ocupa mil caracteres de token e o Markdown fica
 * ilegível.
 */
function desembrulhar(url: string, profundidade = 0): string {
  if (profundidade > 3) return url;
  const m = url.match(/\/L0\/(.+?)\/\d+\//);
  if (!m) return url;
  try {
    const dentro = decodeURIComponent(m[1]);
    if (/^https?:/i.test(dentro)) return desembrulhar(dentro, profundidade + 1);
  } catch {
    /* URL mal formado: fica como está. */
  }
  return url;
}

const PARAMETROS_LIXO = /^(utm_|mc_|ck_|_hs|fbclid|gclid|mkt_tok|ecid|trk|clkk|clkp|ptt|iu|sz)/i;

function limparUrl(url: string): string {
  const bruto = desembrulhar(url.trim().replace(/&amp;/g, "&"));
  try {
    const u = new URL(bruto);
    for (const p of [...u.searchParams.keys()]) {
      if (PARAMETROS_LIXO.test(p)) u.searchParams.delete(p);
    }
    return u.toString().replace(/\?$/, "");
  } catch {
    return bruto;
  }
}

/** Rótulos que são navegação do email, não conteúdo. */
const RUIDO =
  /^(ler mais|leia mais|ver mais|saiba mais|subscrever|remover subscri|versão online|versao online|porquê este anúncio|porque este anuncio|cancelar|unsubscribe|ver no browser|partilhar|facebook|instagram|twitter|tiktok|whatsapp|linkedin|youtube)/i;

function soTexto(html: string): string {
  return decodificar(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function htmlParaMarkdown(html: string): string {
  let s = html;

  s = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|noscript)\b[\s\S]*?<\/\1>/gi, "")
    .replace(
      /<\/?(html|body|table|tbody|thead|tfoot|tr|td|th|center|font|span)\b[^>]*>/gi,
      " ",
    );

  // Imagens: só as que têm alt com substância. Ícones e espaçadores fora.
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = (tag.match(/alt="([^"]*)"/i) || tag.match(/alt='([^']*)'/i) || [])[1] ?? "";
    const src = (tag.match(/src="([^"]*)"/i) || tag.match(/src='([^']*)'/i) || [])[1] ?? "";
    const texto = decodificar(alt).trim();
    if (!texto || texto.length < 4 || RUIDO.test(texto)) return " ";
    if (/\/(ic_|icon|spacer|pixel|logo)/i.test(src)) return " ";
    return `\n\n![${texto}](${limparUrl(src)})\n\n`;
  });

  // Links.
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, dentro) => {
    const rotulo = soTexto(dentro);
    if (!rotulo || RUIDO.test(rotulo)) return " ";
    const url = limparUrl(href);
    if (!/^https?:/i.test(url)) return rotulo;
    return `[${rotulo}](${url})`;
  });

  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, dentro) => {
    const t = soTexto(dentro);
    return t ? `\n\n${"#".repeat(Math.min(Number(n) + 1, 6))} ${t}\n\n` : "\n\n";
  });

  s = s
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, d) => {
      const t = soTexto(d);
      return t ? `**${t}**` : "";
    })
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, d) => {
      const t = soTexto(d);
      return t ? `*${t}*` : "";
    });

  s = s
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, d) => {
      const t = soTexto(d);
      return t ? `\n- ${t}` : "";
    })
    .replace(/<\/?(ul|ol)\b[^>]*>/gi, "\n\n")
    .replace(/<hr\b[^>]*>/gi, "\n\n---\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|h[1-6])>/gi, "\n\n");

  s = decodificar(s.replace(/<[^>]+>/g, " "));

  return s
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "");
}

export interface Artigo {
  titulo: string;
  url: string;
}

/**
 * O resumo executivo: os títulos dos artigos, na ordem em que aparecem.
 *
 * Numa newsletter cada peça é um link com o título por rótulo. Rótulos curtos
 * são etiquetas de secção ("Casamento", "Política"), não manchetes — daí o
 * limiar de comprimento.
 */
export function resumoExecutivo(html: string, maximo = 6): Artigo[] {
  const md = htmlParaMarkdown(html);
  const vistos = new Set<string>();
  const artigos: Artigo[] = [];

  for (const m of md.matchAll(/\[([^\]]{25,200})\]\((https?:[^)\s]+)\)/g)) {
    const titulo = m[1].trim();
    if (RUIDO.test(titulo)) continue;
    // Um título repetido é o mesmo artigo linkado outra vez (imagem + texto).
    const chave = titulo.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    artigos.push({ titulo, url: m[2] });
    if (artigos.length >= maximo) break;
  }

  return artigos;
}

export interface Cabecalho {
  marca: string;
  nome: string;
  data: string;
  assunto: string;
  remetente: string;
  horaRecebida: string;
  codigo: number;
  estado: string;
  detalhe: string;
}

/**
 * O ficheiro final: frontmatter com o contexto, e o email por baixo.
 *
 * Sem lista de manchetes: quem abre o dia quer ler a newsletter, não um índice
 * do que lá está. O resumo executivo é para o cartão de passagem do rato, que
 * serve justamente para não ser preciso abrir.
 */
export function construirFicheiro(c: Cabecalho, corpoHtml: string): string {
  const escapar = (v: string) => `"${v.replace(/"/g, '\\"')}"`;

  const partes = [
    "---",
    `marca: ${escapar(c.marca)}`,
    `newsletter: ${escapar(c.nome)}`,
    `data: ${c.data}`,
    `hora_recebida: ${escapar(c.horaRecebida)}`,
    `remetente: ${escapar(c.remetente)}`,
    `assunto: ${escapar(c.assunto)}`,
    `codigo_estado: ${c.codigo}`,
    `estado: ${escapar(c.estado)}`,
    `detalhe: ${escapar(c.detalhe)}`,
    "---",
    "",
    `# ${c.marca} · ${c.nome}`,
    "",
    `**${c.assunto}**`,
    "",
    `Recebida a ${c.data} às ${c.horaRecebida} · código ${c.codigo} — ${c.estado}`,
    "",
  ];

  partes.push("---", "");

  return partes.join("\n") + htmlParaMarkdown(corpoHtml) + "\n";
}

/** Markdown → HTML, o mínimo para se ler a newsletter no browser. */
export function markdownParaHtml(md: string): string {
  const escapar = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const embutido = (s: string) =>
    escapar(s)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  const saida: string[] = [];
  let emLista = false;

  for (const linha of md.split("\n")) {
    const l = linha.trim();

    if (l.startsWith("- ")) {
      if (!emLista) {
        saida.push("<ul>");
        emLista = true;
      }
      saida.push(`<li>${embutido(l.slice(2))}</li>`);
      continue;
    }
    if (emLista) {
      saida.push("</ul>");
      emLista = false;
    }

    if (!l) continue;
    if (l === "---") {
      saida.push("<hr>");
      continue;
    }
    const t = l.match(/^(#{1,6})\s+(.*)$/);
    if (t) {
      const n = t[1].length;
      saida.push(`<h${n}>${embutido(t[2])}</h${n}>`);
      continue;
    }
    saida.push(`<p>${embutido(l)}</p>`);
  }
  if (emLista) saida.push("</ul>");

  return saida.join("\n");
}
