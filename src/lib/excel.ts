import { deflateRawSync } from "node:zlib";

/**
 * Escritor mínimo de .xlsx, sem dependências.
 *
 * Um xlsx é um zip com uns XML lá dentro. O importador já lê zips com o
 * `node:zlib`; isto faz o caminho inverso. Escrever à mão evita mais um módulo
 * nativo para instalar num Windows sem compilador, que já nos custou uma vez.
 *
 * Os valores de texto vão como `inlineStr`, o que dispensa a tabela de strings
 * partilhadas e torna cada folha independente.
 */

export type Valor = string | number | null;

export interface Folha {
  nome: string;
  /** A primeira linha é tratada como cabeçalho. */
  linhas: Valor[][];
}

// ── ZIP ────────────────────────────────────────────────────────────────────

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABELA_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface Entrada {
  nome: string;
  conteudo: Buffer;
}

function escreverZip(entradas: Entrada[]): Buffer {
  const locais: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entradas) {
    const nome = Buffer.from(e.nome, "utf8");
    const comprimido = deflateRawSync(e.conteudo);
    const crc = crc32(e.conteudo);

    const cabecalho = Buffer.alloc(30);
    cabecalho.writeUInt32LE(0x04034b50, 0);
    cabecalho.writeUInt16LE(20, 4); // versão necessária
    cabecalho.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    cabecalho.writeUInt16LE(8, 8); // deflate
    cabecalho.writeUInt32LE(0, 10); // data/hora
    cabecalho.writeUInt32LE(crc, 14);
    cabecalho.writeUInt32LE(comprimido.length, 18);
    cabecalho.writeUInt32LE(e.conteudo.length, 22);
    cabecalho.writeUInt16LE(nome.length, 26);
    cabecalho.writeUInt16LE(0, 28);

    locais.push(cabecalho, nome, comprimido);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(0, 12);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(comprimido.length, 20);
    dir.writeUInt32LE(e.conteudo.length, 24);
    dir.writeUInt16LE(nome.length, 28);
    dir.writeUInt32LE(offset, 42);

    central.push(dir, nome);
    offset += cabecalho.length + nome.length + comprimido.length;
  }

  const corpo = Buffer.concat(locais);
  const diretorio = Buffer.concat(central);

  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(corpo.length, 16);

  return Buffer.concat([corpo, diretorio, fim]);
}

// ── XML ────────────────────────────────────────────────────────────────────

function escapar(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // O Excel rejeita o ficheiro inteiro se apanhar um caracter de controlo.
    // Tabulacao, nova linha e retorno sao os unicos de controlo que o XML aceita.
    .replace(new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F]", "g"), "");
}

/** 0 → A, 25 → Z, 26 → AA. */
function coluna(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function celula(ref: string, valor: Valor, cabecalho: boolean): string {
  if (valor === null || valor === "") return "";
  const estilo = cabecalho ? ' s="1"' : "";
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return `<c r="${ref}"${estilo}><v>${valor}</v></c>`;
  }
  return `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${escapar(
    String(valor),
  )}</t></is></c>`;
}

function folhaXml(folha: Folha): string {
  const linhas = folha.linhas
    .map((linha, i) => {
      const celulas = linha.map((v, j) => celula(`${coluna(j)}${i + 1}`, v, i === 0)).join("");
      return `<row r="${i + 1}">${celulas}</row>`;
    })
    .join("");

  // Congela o cabeçalho e a primeira coluna, que é o que torna uma matriz
  // larga legível sem andar a perder de vista o nome da newsletter.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetData>${linhas}</sheetData></worksheet>`;
}

/** Nomes de folha: o Excel proíbe : \ / ? * [ ] e mais de 31 caracteres. */
function nomeSeguro(nome: string): string {
  return nome.replace(/[:\\/?*[\]]/g, "-").slice(0, 31);
}

export function construirXlsx(folhas: Folha[]): Buffer {
  const n = folhas.length;

  const tipos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${folhas
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("")}</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${folhas
    .map(
      (f, i) =>
        `<sheet name="${escapar(nomeSeguro(f.nome))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join("")}</sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${folhas
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("")}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  // Dois estilos: o 0 normal, o 1 a negrito para o cabeçalho.
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

  const entradas: Entrada[] = [
    { nome: "[Content_Types].xml", conteudo: Buffer.from(tipos, "utf8") },
    { nome: "_rels/.rels", conteudo: Buffer.from(rels, "utf8") },
    { nome: "xl/workbook.xml", conteudo: Buffer.from(workbook, "utf8") },
    { nome: "xl/_rels/workbook.xml.rels", conteudo: Buffer.from(workbookRels, "utf8") },
    { nome: "xl/styles.xml", conteudo: Buffer.from(styles, "utf8") },
    ...folhas.map((f, i) => ({
      nome: `xl/worksheets/sheet${i + 1}.xml`,
      conteudo: Buffer.from(folhaXml(f), "utf8"),
    })),
  ];

  return escreverZip(entradas);
}
