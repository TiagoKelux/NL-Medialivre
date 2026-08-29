/**
 * Gera `config/newsletters.ts` a partir da folha "Horário" do Excel.
 *
 *   npm run importar -- "C:/caminho/Newsletters Horários.xlsx"
 *
 * Existe para que a configuração não seja escrita à mão sessenta vezes, e para
 * que quando o Excel mudar se possa voltar a correr em vez de emendar à mão.
 * Os campos `remetentes` e `padraoAssunto` não vêm do Excel — não estão lá — e
 * por isso são preservados do ficheiro que já existir.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

// ── Leitor de ZIP, sem dependências ────────────────────────────────────────
// Um .xlsx é um zip. Percorre-se o directório central, que é o único sítio
// onde os tamanhos estão sempre corretos.
function lerZip(caminho: string): Map<string, Buffer> {
  const b = readFileSync(caminho);
  const ficheiros = new Map<string, Buffer>();

  let fimCd = -1;
  for (let i = b.length - 22; i >= 0; i--) {
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

    const nomeLenLocal = b.readUInt16LE(offsetLocal + 26);
    const extraLenLocal = b.readUInt16LE(offsetLocal + 28);
    const inicio = offsetLocal + 30 + nomeLenLocal + extraLenLocal;
    const dados = b.subarray(inicio, inicio + tamComprimido);

    ficheiros.set(nome, metodo === 0 ? dados : inflateRawSync(dados));
    p += 46 + nomeLen + extraLen + comentarioLen;
  }
  return ficheiros;
}

// ── XML mínimo ─────────────────────────────────────────────────────────────
function texto(xml: string): string {
  return xml
    .replace(/<rPh[\s\S]*?<\/rPh>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function indiceColuna(ref: string): number {
  let n = 0;
  for (const c of ref.replace(/\d+/g, "")) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

// ── Conversões ─────────────────────────────────────────────────────────────
function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const DIAS: Record<string, number> = {
  "2ª": 1, "3ª": 2, "4ª": 3, "5ª": 4, "6ª": 5, sábado: 6, sabado: 6, domingo: 7,
};

interface Cadencia {
  periodicidade: string;
  diasSemana: number[] | null;
  diasMes: number[] | null;
  nota?: string;
}

function lerPeriodicidade(bruto: string): Cadencia {
  const p = bruto.replace(/\s+/g, " ").trim().toLowerCase();
  if (/^todos os dias$/.test(p)) return { periodicidade: "diaria", diasSemana: null, diasMes: null };
  if (/^2ª a 6ª$/.test(p)) return { periodicidade: "dias_uteis", diasSemana: null, diasMes: null };
  if (DIAS[p] !== undefined)
    return { periodicidade: "dia_semana", diasSemana: [DIAS[p]], diasMes: null };
  if (/dia 1 de cada m/.test(p))
    return { periodicidade: "dia_mes", diasSemana: null, diasMes: [1] };
  if (/^mensal$/.test(p))
    return { periodicidade: "nao_agendada", diasSemana: null, diasMes: null, nota: 'Excel diz "Mensal" sem dia nem hora' };
  if (/sem periodicidade/.test(p))
    return { periodicidade: "nao_agendada", diasSemana: null, diasMes: null, nota: "sai a qualquer dia/hora" };
  return {
    periodicidade: "nao_agendada",
    diasSemana: null,
    diasMes: null,
    nota: `periodicidade "${bruto.trim()}" não reconhecida`,
  };
}

interface Janela {
  hora: string | null;
  tolerancia: number;
  nota?: string;
}

/**
 * "9h30" → 09:30. Quando há duas horas ("12h ou 18h", "16h30 // 17h"), toma-se
 * a mais cedo como prevista e alarga-se a tolerância até cobrir a mais tarde:
 * é a leitura que não gera atrasos falsos.
 */
function lerHora(bruto: string): Janela {
  const encontradas = [...bruto.matchAll(/(\d{1,2})\s*[hH:]\s*(\d{2})?/g)].map((m) => {
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    return h * 60 + min;
  });
  if (encontradas.length === 0) return { hora: null, tolerancia: 60 };

  const emTexto = (t: number) =>
    `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;

  const cedo = Math.min(...encontradas);
  const tarde = Math.max(...encontradas);
  if (cedo === tarde) return { hora: emTexto(cedo), tolerancia: 60 };
  return {
    hora: emTexto(cedo),
    tolerancia: tarde - cedo + 60,
    nota: `horário em aberto no Excel ("${bruto.trim()}"); tolerância alargada até ${emTexto(tarde)} + 1 h`,
  };
}

// ── Leitura da folha ───────────────────────────────────────────────────────
const caminhoXlsx = process.argv[2];
if (!caminhoXlsx) {
  console.error('Uso: npm run importar -- "caminho/para/Newsletters Horários.xlsx"');
  process.exit(1);
}

const zip = lerZip(caminhoXlsx);
const ler = (n: string) => zip.get(n)?.toString("utf8") ?? "";

const ss: string[] = [];
for (const m of ler("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)) ss.push(texto(m[1]));

const alvoPorId = new Map<string, string>();
for (const m of ler("xl/_rels/workbook.xml.rels").matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
  alvoPorId.set(m[1], `xl/${m[2].replace(/^\/?xl\//, "")}`);
}

let folha: string | null = null;
for (const m of ler("xl/workbook.xml").matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  if (texto(m[1]) === "Horário") folha = alvoPorId.get(m[2]) ?? null;
}
if (!folha) throw new Error('Não encontrei a folha "Horário" no ficheiro.');

interface LinhaExcel {
  r: number;
  marca: string;
  nome: string;
  periodicidade: string;
  horas: string;
  status: string;
  observacoes: string;
}

const linhas: LinhaExcel[] = [];
for (const lm of ler(folha).matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
  const cel: string[] = [];
  for (const cm of lm[2].matchAll(/<c([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = (cm[1].match(/r="([A-Z]+\d+)"/) || [])[1];
    if (!ref) continue;
    const tipo = (cm[1].match(/t="([^"]+)"/) || [])[1] || "n";
    const vm = (cm[2] || "").match(/<v>([\s\S]*?)<\/v>/);
    let v = "";
    if (tipo === "s" && vm) v = ss[Number(vm[1])] ?? "";
    else if (vm) v = vm[1];
    cel[indiceColuna(ref)] = v.trim();
  }
  const [, marca, nome, per, horas, , , status, obs] = cel;
  // Linhas de separação só têm um número na coluna B.
  if (!marca || !nome || !per || /^\d+$/.test(marca) || /^\d+$/.test(per)) continue;
  linhas.push({
    r: Number(lm[1]),
    marca,
    nome,
    periodicidade: per,
    horas: horas ?? "",
    status: status ?? "",
    observacoes: obs ?? "",
  });
}

// ── Preservar o que o Excel não tem ────────────────────────────────────────
const DESTINO = new URL("../config/newsletters.ts", import.meta.url);
let anterior = "";
try {
  anterior = readFileSync(DESTINO, "utf8");
} catch {}

function preservado(id: string, campo: string): string | null {
  const bloco = anterior.match(new RegExp(`id:\\s*"${id}"[\\s\\S]*?\\n  \\},`));
  if (!bloco) return null;
  const m = bloco[0].match(new RegExp(`${campo}:\\s*(\\[[^\\]]*\\]|"[^"]*")`));
  return m ? m[1] : null;
}

// ── Gerar ──────────────────────────────────────────────────────────────────
const usados = new Map<string, number>();
const blocos: string[] = [];
let ativas = 0;
const avisos: string[] = [];

for (const l of linhas) {
  let id = slug(`${l.marca}-${l.nome}`);
  const visto = usados.get(id) ?? 0;
  usados.set(id, visto + 1);
  if (visto > 0) id = `${id}-${visto + 1}`;

  const cad = lerPeriodicidade(l.periodicidade);
  const janela = lerHora(l.horas);
  const statusLimpo = l.status.replace(/\s+/g, " ").trim();

  // Só "Ativa" liga. "Parada", "Inativa" e qualquer coisa que não seja um
  // estado reconhecível ficam desligadas — é preferível uma linha a cinzento
  // do que inventar um estado que o Excel não diz.
  const estadoConhecido = /^(ativa|parada|inativa)$/i.test(statusLimpo);
  let ativa = /^ativa$/i.test(statusLimpo);

  // Problemas exigem decisão humana. O contexto é só o que o Excel já dizia.
  const problemas: string[] = [];
  if (!estadoConhecido) {
    problemas.push(`estado por confirmar no Excel (coluna dizia "${statusLimpo || "vazio"}")`);
    ativa = false;
  }
  if (cad.nota) problemas.push(cad.nota);
  if (janela.nota) problemas.push(janela.nota);
  if (!janela.hora) {
    problemas.push(`sem hora no Excel ("${l.horas.trim() || "vazio"}")`);
    ativa = false;
  }

  const contexto = l.observacoes ? [l.observacoes.replace(/\s+/g, " ").trim()] : [];
  const notas = [...problemas, ...contexto];

  if (ativa) ativas++;

  const remetentes = preservado(id, "remetentes") ?? "[]";
  const padraoRem = preservado(id, "padraoRemetente") ?? '""';
  const padrao = preservado(id, "padraoAssunto") ?? '""';

  const comentario = notas.length
    ? notas.map((n) => `  // ${n}`).join("\n") + "\n"
    : "";

  blocos.push(
    `${comentario}  {
    id: "${id}",
    marca: ${JSON.stringify(l.marca)},
    nome: ${JSON.stringify(l.nome)},
    periodicidade: "${cad.periodicidade}",
    diasSemana: ${cad.diasSemana ? `[${cad.diasSemana.join(", ")}]` : "null"},
    diasMes: ${cad.diasMes ? `[${cad.diasMes.join(", ")}]` : "null"},
    horaPrevista: ${JSON.stringify(janela.hora ?? "00:00")},
    toleranciaMinutos: ${janela.tolerancia},
    remetentes: ${remetentes},
    padraoRemetente: ${padraoRem},
    padraoAssunto: ${padrao},
    ativa: ${ativa},
  },`,
  );

  for (const p of problemas) avisos.push(`  ${l.marca} · ${l.nome} — ${p}`);
}

const saida = `import type { Newsletter } from "../src/lib/tipos.ts";

/**
 * GERADO por \`npm run importar\` a partir da folha "Horário" do Excel.
 *
 * Não editar as periodicidades nem as horas à mão — mexer no Excel e voltar a
 * correr o importador. Os campos \`remetentes\` e \`padraoAssunto\` são a
 * exceção: não estão no Excel, escrevem-se aqui e o importador preserva-os.
 *
 * ${linhas.length} newsletters, ${ativas} ativas.
 */
export const NEWSLETTERS: Newsletter[] = [
${blocos.join("\n")}
];

export function newsletterPorId(id: string): Newsletter | undefined {
  return NEWSLETTERS.find((n) => n.id === id);
}

/**
 * Uma newsletter está configurada quando já sabe reconhecer os seus emails:
 * um endereço, e pelo menos um padrão que a distinga das outras que chegam do
 * mesmo endereço — o nome do remetente ou um pedaço fixo do assunto.
 */
export function estaConfigurada(n: Newsletter): boolean {
  return (
    n.remetentes.length > 0 &&
    (n.padraoRemetente.trim() !== "" || n.padraoAssunto.trim() !== "")
  );
}
`;

writeFileSync(DESTINO, saida, "utf8");

console.log(`${linhas.length} newsletters escritas em config/newsletters.ts (${ativas} ativas).`);
if (avisos.length) {
  console.log(`\n${avisos.length} com notas:`);
  console.log(avisos.join("\n"));
}
