/**
 * Leitor de ficheiros .eml, sem dependências.
 *
 * Serve para dar de comer ao sistema emails guardados à mão, antes de o
 * Microsoft Graph estar ligado — e depois para reprocessar casos difíceis sem
 * ir buscá-los outra vez à caixa.
 *
 * Faz o mínimo que os emails de newsletter exigem: cabeçalhos dobrados em
 * várias linhas, palavras codificadas em =?UTF-8?Q?..?=, corpos em
 * quoted-printable ou base64, e multipart/alternative para ir buscar o HTML.
 */

export interface EmailLido {
  internetMessageId: string;
  remetente: string;
  assunto: string;
  data: Date;
  corpoHtml: string;
}

/** Junta as linhas dobradas e devolve os cabeçalhos como mapa. */
function separar(bruto: string): { cabecalhos: Map<string, string>; corpo: string } {
  const texto = bruto.replace(/\r\n/g, "\n");
  const corte = texto.indexOf("\n\n");
  const zonaCabecalhos = corte < 0 ? texto : texto.slice(0, corte);
  const corpo = corte < 0 ? "" : texto.slice(corte + 2);

  // Uma linha que comece por espaço é continuação da anterior.
  const linhas = zonaCabecalhos.split("\n");
  const juntas: string[] = [];
  for (const l of linhas) {
    if (/^[ \t]/.test(l) && juntas.length) juntas[juntas.length - 1] += l;
    else juntas.push(l);
  }

  const cabecalhos = new Map<string, string>();
  for (const l of juntas) {
    const i = l.indexOf(":");
    if (i < 0) continue;
    const chave = l.slice(0, i).trim().toLowerCase();
    const valor = l.slice(i + 1).trim();
    // O primeiro ganha: os Received: vão-se acumulando no topo.
    if (!cabecalhos.has(chave)) cabecalhos.set(chave, valor);
  }
  return { cabecalhos, corpo };
}

/** =?UTF-8?Q?texto?= e =?UTF-8?B?dGV4dG8=?=, possivelmente em vários pedaços. */
export function descodificarCabecalho(valor: string): string {
  // Pedaços adjacentes separados só por espaço juntam-se sem espaço.
  const semSeparadores = valor.replace(/\?=[ \t]+=\?/g, "?==?");

  return semSeparadores.replace(
    /=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g,
    (_, charset: string, tipo: string, dados: string) => {
      try {
        if (tipo.toUpperCase() === "B") {
          return Buffer.from(dados, "base64").toString(normalizar(charset));
        }
        const bytes = dados
          .replace(/_/g, " ")
          .replace(/=([0-9A-Fa-f]{2})/g, (__, h) => String.fromCharCode(parseInt(h, 16)));
        return Buffer.from(bytes, "binary").toString(normalizar(charset));
      } catch {
        return dados;
      }
    },
  );
}

function normalizar(charset: string): BufferEncoding {
  const c = charset.toLowerCase();
  if (c.includes("utf-8") || c.includes("utf8")) return "utf8";
  if (c.includes("iso-8859") || c.includes("windows-12")) return "latin1";
  return "utf8";
}

function descodificarQuotedPrintable(corpo: string, charset: string): string {
  const semQuebras = corpo.replace(/=\n/g, "");
  const bytes = semQuebras.replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
  return Buffer.from(bytes, "binary").toString(normalizar(charset));
}

function descodificarCorpo(corpo: string, codificacao: string, charset: string): string {
  const c = codificacao.toLowerCase();
  if (c.includes("quoted-printable")) return descodificarQuotedPrintable(corpo, charset);
  if (c.includes("base64")) {
    return Buffer.from(corpo.replace(/\s+/g, ""), "base64").toString(normalizar(charset));
  }
  return Buffer.from(corpo, "binary").toString(normalizar(charset));
}

function charsetDe(contentType: string): string {
  return (contentType.match(/charset="?([^";]+)"?/i) || [])[1] ?? "utf-8";
}

/**
 * Procura o HTML. Num multipart, percorre as partes e fica com a text/html;
 * se só houver text/plain, embrulha-a para não perder o conteúdo.
 */
function extrairHtml(cabecalhos: Map<string, string>, corpo: string): string {
  const contentType = cabecalhos.get("content-type") ?? "text/html";
  const fronteira = (contentType.match(/boundary="?([^";]+)"?/i) || [])[1];

  if (!fronteira) {
    const html = descodificarCorpo(
      corpo,
      cabecalhos.get("content-transfer-encoding") ?? "",
      charsetDe(contentType),
    );
    if (/text\/plain/i.test(contentType) && !/<[a-z]/i.test(html)) {
      return `<pre>${html}</pre>`;
    }
    return html;
  }

  const partes = corpo.split(new RegExp(`--${fronteira.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  let alternativa = "";

  for (const parte of partes) {
    if (!parte.trim() || parte.trim() === "--") continue;
    const { cabecalhos: ch, corpo: cp } = separar(parte.replace(/^\n/, ""));
    const tipo = ch.get("content-type") ?? "";
    // Uma parte pode ser ela própria multipart.
    if (/multipart\//i.test(tipo)) {
      const dentro = extrairHtml(ch, cp);
      if (dentro) return dentro;
      continue;
    }
    const texto = descodificarCorpo(cp, ch.get("content-transfer-encoding") ?? "", charsetDe(tipo));
    if (/text\/html/i.test(tipo)) return texto;
    if (/text\/plain/i.test(tipo) && !alternativa) alternativa = `<pre>${texto}</pre>`;
  }

  return alternativa;
}

export function lerEml(bruto: string): EmailLido {
  const { cabecalhos, corpo } = separar(bruto);

  const dataBruta = cabecalhos.get("date");
  const data = dataBruta ? new Date(dataBruta) : new Date(NaN);
  if (Number.isNaN(data.getTime())) {
    throw new Error(`Cabeçalho Date ilegível: ${dataBruta ?? "(ausente)"}`);
  }

  const messageId = (cabecalhos.get("message-id") ?? "").replace(/^<|>$/g, "").trim();
  if (!messageId) throw new Error("Email sem Message-ID; não dá para deduplicar.");

  return {
    internetMessageId: messageId,
    remetente: descodificarCabecalho(cabecalhos.get("from") ?? ""),
    assunto: descodificarCabecalho(cabecalhos.get("subject") ?? ""),
    data,
    corpoHtml: extrairHtml(cabecalhos, corpo),
  };
}
