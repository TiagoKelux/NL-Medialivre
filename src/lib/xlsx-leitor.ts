import { inflateRawSync } from "node:zlib";

/**
 * Leitor mínimo de .xlsx, sem dependências (o par do `excel.ts`, que escreve).
 *
 * Um .xlsx é um zip com XML lá dentro. Lê-se o directório central do zip (o
 * único sítio onde os tamanhos estão sempre certos), as strings partilhadas e,
 * de cada folha, os valores das células e as linhas escondidas. Das fórmulas
 * usa-se o valor guardado pelo Excel. Nada é escrito: o ficheiro do cliente
 * não muda.
 */

export type ValorCelula = string | number | null;

export interface FolhaLida {
  nome: string;
  /** Valor da célula (linha e coluna a contar de 1), ou null. */
  celula(linha: number, coluna: number): ValorCelula;
  maxLinha: number;
  maxColuna: number;
  linhasEscondidas: Set<number>;
}

function lerZip(b: Buffer): Map<string, Buffer> {
  const ficheiros = new Map<string, Buffer>();
  let fimCd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 70_000); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      fimCd = i;
      break;
    }
  }
  if (fimCd < 0) throw new Error("Não parece um ficheiro .xlsx (zip inválido).");
  const total = b.readUInt16LE(fimCd + 10);
  let p = b.readUInt32LE(fimCd + 16);
  for (let i = 0; i < total; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = b.readUInt16LE(p + 10);
    const tamComprimido = b.readUInt32LE(p + 20);
    const nomeLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const comentarioLen = b.readUInt16LE(p + 32);
    const offsetLocal = b.readUInt32LE(p + 42);
    const nome = b.subarray(p + 46, p + 46 + nomeLen).toString("utf8");
    const inicio = offsetLocal + 30 + b.readUInt16LE(offsetLocal + 26) + b.readUInt16LE(offsetLocal + 28);
    const dados = b.subarray(inicio, inicio + tamComprimido);
    ficheiros.set(nome, metodo === 0 ? dados : inflateRawSync(dados));
    p += 46 + nomeLen + extraLen + comentarioLen;
  }
  return ficheiros;
}

function texto(xml: string): string {
  return xml
    .replace(/<rPh[\s\S]*?<\/rPh>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function coluna(ref: string): number {
  let n = 0;
  for (const c of ref.replace(/\d+/g, "")) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

export function lerXlsx(conteudo: Buffer): FolhaLida[] {
  const zip = lerZip(conteudo);
  const ler = (n: string) => zip.get(n)?.toString("utf8") ?? "";

  const partilhadas: string[] = [];
  for (const m of ler("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)) partilhadas.push(texto(m[1]));

  const alvo = new Map<string, string>();
  for (const m of ler("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/Id="([^"]+)"/)?.[1];
    const t = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && t) alvo.set(id, t.startsWith("/") ? t.slice(1) : `xl/${t}`);
  }

  const folhas: FolhaLida[] = [];
  for (const m of ler("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const nome = texto(m[0].match(/name="([^"]*)"/)?.[1] ?? "");
    const rid = m[0].match(/r:id="([^"]+)"/)?.[1];
    const caminho = rid ? alvo.get(rid) : undefined;
    if (!caminho) continue;
    const xml = ler(caminho);
    const valores = new Map<number, Map<number, ValorCelula>>();
    const escondidas = new Set<number>();
    let maxLinha = 0;
    let maxColuna = 0;
    for (const lm of xml.matchAll(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = Number(lm[1].match(/\br="(\d+)"/)?.[1] ?? 0);
      if (!r) continue;
      if (/\bhidden="(1|true)"/.test(lm[1])) escondidas.add(r);
      const linha = new Map<number, ValorCelula>();
      for (const cm of (lm[3] ?? "").matchAll(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = cm[1].match(/\br="([A-Z]+\d+)"/)?.[1];
        if (!ref) continue;
        const tipo = cm[1].match(/\bt="([^"]+)"/)?.[1];
        const corpo = cm[3] ?? "";
        const v = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let valor: ValorCelula = null;
        if (tipo === "s" && v !== undefined) valor = partilhadas[Number(v)] ?? null;
        else if (tipo === "inlineStr") valor = texto(corpo.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "");
        else if ((tipo === "str" || tipo === "e") && v !== undefined) valor = texto(v);
        else if (tipo === "b" && v !== undefined) valor = Number(v);
        else if (v !== undefined) valor = Number.isNaN(Number(v)) ? texto(v) : Number(v);
        if (valor === null || valor === "") continue;
        const c = coluna(ref);
        linha.set(c, valor);
        if (c > maxColuna) maxColuna = c;
      }
      if (linha.size) {
        valores.set(r, linha);
        if (r > maxLinha) maxLinha = r;
      }
    }
    folhas.push({
      nome,
      celula: (l, c) => valores.get(l)?.get(c) ?? null,
      maxLinha,
      maxColuna,
      linhasEscondidas: escondidas,
    });
  }
  return folhas;
}
