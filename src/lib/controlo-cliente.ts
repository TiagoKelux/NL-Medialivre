import { db } from "./db.ts";
import { NEWSLETTERS } from "../../config/newsletters.ts";
import { lerXlsx, type FolhaLida } from "./xlsx-leitor.ts";
import { dataLocal, diaSemanaISO, somarDias } from "./tempo.ts";
import type { CodigoEstado } from "./tipos.ts";

/**
 * O controlo manual do cliente como segunda fonte de prova.
 *
 * A equipa da Medialivre preenche à mão, todos os dias, o Excel "Newsletters
 * Horários" a partir de uma caixa pessoal: uma grelha newsletter × dia com os
 * mesmos códigos 1–6 (e 7 = "Saiu Errada"). Quando uma edição não chega à
 * nossa caixa mas chegou à deles, o "Não recebida – sem prova" do monitor
 * passa a "Saiu" com a fonte indicada; quando também não chegou à deles, o
 * "Não Saiu" fica provado pelas duas caixas. Quando o monitor tem o email,
 * vale o que o monitor mediu — a marca do cliente só aparece na comparação.
 *
 * O ficheiro só se lê. Folhas lidas (medido a 09/11/2026):
 *  - "TODOS OS DIAS" e "2ª a 6ª": uma coluna por dia (linha 3 o dia do mês,
 *    linha 4 o dia da semana, nomes dos meses nas linhas 1–2);
 *  - "Semanal": uma coluna por semana (linha 6 o dia da segunda-feira, nomes
 *    dos meses na linha 5) e secções "2ª Feira", "3ª Feira"… que dizem o dia.
 * As datas ancoram-se no último nome de mês e confirmam-se pelos dias da
 * semana; o Excel tem gralhas nos números dos dias (23/10 escrito "3"), por
 * isso uma coluna desalinhada não chega para rejeitar a folha, só muitas.
 * Linhas escondidas são newsletters que o cliente deixou de controlar: ficam
 * de fora (e listadas).
 */

/** Só se importa este passado: chega para a matriz e para as correções. */
export const DIAS_A_IMPORTAR = 120;

export interface MarcaCliente {
  newsletterId: string;
  data: string;
  /** O código escrito no Excel: 1–7. */
  valor: number;
  folha: string;
  linha: number;
}

export interface LinhaIgnorada {
  folha: string;
  linha: number;
  texto: string;
  motivo: string;
}

export interface FolhaResumo {
  nome: string;
  de: string | null;
  ate: string | null;
  marcas: number;
  /** Colunas cujo número do dia não bate com a data calculada (gralhas). */
  desalinhadas: number;
  erro?: string;
}

export interface Leitura {
  marcas: MarcaCliente[];
  ignoradas: LinhaIgnorada[];
  folhas: FolhaResumo[];
}

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const MARCAS: Record<string, string> = { tvg: "tvguia", correiodamanha: "cm" };
const marcaNorm = (s: unknown) => MARCAS[norm(s)] ?? norm(s);

/** Nomes do Excel que não são os da configuração. */
const ALIAS: Record<string, string> = {
  "negocios|opiniaododia": "negocios-opiniao",
  "sabado|narevista": "sabado-capa",
};

function identificar(marca: unknown, nome: unknown, ocorrencia: number): string | null {
  const chave = `${marcaNorm(marca)}|${norm(nome)}`;
  if (ALIAS[chave]) return ALIAS[chave];
  const ids = NEWSLETTERS.filter((n) => `${marcaNorm(n.marca)}|${norm(n.nome)}` === chave).map((n) => n.id);
  if (!ids.length) return null;
  return ids[Math.min(ocorrencia, ids.length - 1)];
}

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7,
  agosto: 8, setembro: 9, setemrbo: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/** "2ª", "3ª"… "SAB"/"S", "DOM"/"D" → dia ISO (1 = segunda). */
function diaDoRotulo(v: unknown): number | null {
  const s = norm(v);
  const m = s.match(/^([2-6])a?$/);
  if (m) return Number(m[1]) - 1;
  if (s === "s" || s.startsWith("sab")) return 6;
  if (s === "d" || s.startsWith("dom")) return 7;
  return null;
}

function iso(ano: number, mes: number, dia: number): string | null {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1) return null;
  return d.toISOString().slice(0, 10);
}

/** O último nome de mês nas linhas dadas, até à coluna `ate`. */
function ultimoMes(f: FolhaLida, linhas: number[], ate: number): { col: number; mes: number } | null {
  for (let c = ate; c >= 1; c--) {
    for (const l of linhas) {
      const mes = MESES[norm(f.celula(l, c))];
      if (mes) return { col: c, mes };
    }
  }
  return null;
}

function anoQueBate(mes: number, dia: number, diaIso: number | null, hoje: string): number | null {
  const ano = Number(hoje.slice(0, 4));
  // Nunca um ano futuro: um cabeçalho mudado daria datas que ainda não chegaram.
  for (const a of [ano, ano - 1]) {
    const d = iso(a, mes, dia);
    if (d && (diaIso === null || diaSemanaISO(d) === diaIso)) return a;
  }
  return null;
}

type Tipo = "diaria" | "uteis" | "semanal";

function tipoDaFolha(nome: string): Tipo | null {
  const s = norm(nome);
  if (s === "todososdias") return "diaria";
  if (s === "2aa6a" || s === "2a6a") return "uteis";
  if (s === "semanal") return "semanal";
  return null;
}

function passo(tipo: Tipo, d: string, sentido: 1 | -1): string {
  if (tipo === "semanal") return somarDias(d, 7 * sentido);
  if (tipo === "diaria") return somarDias(d, sentido);
  let n = somarDias(d, sentido);
  while (diaSemanaISO(n) > 5) n = somarDias(n, sentido);
  return n;
}

/** Coluna → data de cada coluna com dia, a partir do último mês escrito. */
function datasDasColunas(f: FolhaLida, tipo: Tipo, hoje: string): { datas: Map<number, string>; desalinhadas: number } | string {
  const linhaDia = tipo === "semanal" ? 6 : 3;
  const linhasMes = tipo === "semanal" ? [5] : [1, 2];
  let ultimaCol = 0;
  for (let c = f.maxColuna; c >= 1; c--) {
    if (typeof f.celula(linhaDia, c) === "number") {
      ultimaCol = c;
      break;
    }
  }
  if (!ultimaCol) return "sem linha de dias";
  const ancora = ultimoMes(f, linhasMes, ultimaCol);
  if (!ancora) return "sem nome de mês no cabeçalho";
  const dia = f.celula(linhaDia, ancora.col);
  if (typeof dia !== "number") return "o mês não tem dia por baixo";
  const diaIso = tipo === "semanal" ? 1 : diaDoRotulo(f.celula(4, ancora.col));
  const ano = anoQueBate(ancora.mes, dia, diaIso, hoje);
  const inicio = ano ? iso(ano, ancora.mes, dia) : null;
  if (!inicio) return "datas do cabeçalho não batem com os dias da semana";

  const limite = somarDias(hoje, -DIAS_A_IMPORTAR);
  const datas = new Map<number, string>();
  let desalinhadas = 0;
  const ver = (c: number, d: string) => {
    const v = f.celula(linhaDia, c);
    if (typeof v !== "number") return false;
    if (v !== Number(d.slice(8, 10))) desalinhadas++;
    datas.set(c, d);
    return true;
  };
  let d = inicio;
  for (let c = ancora.col; c <= ultimaCol; c++) if (ver(c, d)) d = passo(tipo, d, 1);
  d = passo(tipo, inicio, -1);
  for (let c = ancora.col - 1; c >= 1 && d >= limite; c--) if (ver(c, d)) d = passo(tipo, d, -1);
  if (datas.size >= 10 && desalinhadas > datas.size * 0.1) return `${desalinhadas} de ${datas.size} colunas com o dia errado — o formato mudou?`;
  return { datas, desalinhadas };
}

const SECCAO: Record<string, number> = {
  "2afeira": 0, "3afeira": 1, "4afeira": 2, "5afeira": 3, "6afeira": 4, sabado: 5, domingo: 6,
};

/** Lê o Excel do cliente. Não escreve nada. */
export function lerControlo(conteudo: Buffer, hoje: string = dataLocal()): Leitura {
  const leitura: Leitura = { marcas: [], ignoradas: [], folhas: [] };
  const limite = somarDias(hoje, -DIAS_A_IMPORTAR);
  for (const f of lerXlsx(conteudo)) {
    const tipo = tipoDaFolha(f.nome);
    if (!tipo) continue;
    const resumo: FolhaResumo = { nome: f.nome, de: null, ate: null, marcas: 0, desalinhadas: 0 };
    leitura.folhas.push(resumo);
    const r = datasDasColunas(f, tipo, hoje);
    if (typeof r === "string") {
      resumo.erro = r;
      continue;
    }
    resumo.desalinhadas = r.desalinhadas;
    const colunas = [...r.datas].filter(([, d]) => d >= limite && d <= hoje);

    const ocorrencias = new Map<string, number>();
    let deslocamento: number | null = tipo === "semanal" ? null : 0;
    for (let l = 5; l <= f.maxLinha; l++) {
      const marca = f.celula(l, 2);
      const nome = f.celula(l, 3);
      if (tipo === "semanal" && marca !== null && nome === null) {
        const s = norm(marca);
        deslocamento = s in SECCAO ? SECCAO[s] : null; // "TODOS OS DIAS 01 DE CADA MÊS": sem dia fixo
        continue;
      }
      if (marca === null || nome === null) continue;
      const texto = `${marca} · ${nome}`;
      const chave = `${marcaNorm(marca)}|${norm(nome)}`;
      const k = ocorrencias.get(chave) ?? 0;
      ocorrencias.set(chave, k + 1);
      if (f.linhasEscondidas.has(l)) {
        leitura.ignoradas.push({ folha: f.nome, linha: l, texto, motivo: "linha escondida no Excel" });
        continue;
      }
      const id = identificar(marca, nome, k);
      if (!id) {
        leitura.ignoradas.push({ folha: f.nome, linha: l, texto, motivo: "não está na configuração do monitor" });
        continue;
      }
      if (deslocamento === null) {
        leitura.ignoradas.push({ folha: f.nome, linha: l, texto, motivo: "sem dia da semana fixo" });
        continue;
      }
      for (const [c, d] of colunas) {
        const v = f.celula(l, c);
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 7) continue;
        const data = somarDias(d, deslocamento);
        if (data > hoje || data < limite) continue;
        leitura.marcas.push({ newsletterId: id, data, valor: v, folha: f.nome, linha: l });
        resumo.marcas++;
        if (!resumo.de || data < resumo.de) resumo.de = data;
        if (!resumo.ate || data > resumo.ate) resumo.ate = data;
      }
    }
  }
  return leitura;
}

// ── Base de dados ───────────────────────────────────────────────────────────

export interface Importacao {
  id: number;
  importado_em: string;
  ficheiro: string;
  quem: string | null;
  marcas: number;
  alteradas: number;
  resumo: string;
}

let cache: Map<string, { valor: number; importado_em: string }> | null = null;

/** A marca do cliente para uma newsletter num dia, se houver. */
export function marcaDoCliente(newsletterId: string, data: string): { valor: number; importado_em: string } | null {
  if (!cache) {
    cache = new Map();
    const linhas = db()
      .prepare(`SELECT newsletter_id, data, valor, importado_em FROM controlo_cliente`)
      .all() as { newsletter_id: string; data: string; valor: number; importado_em: string }[];
    for (const l of linhas) cache.set(`${l.newsletter_id}|${l.data}`, { valor: l.valor, importado_em: l.importado_em });
  }
  return cache.get(`${newsletterId}|${data}`) ?? null;
}

/** Para os testes. */
export function esquecerControlo(): void {
  cache = null;
}

/** O código do monitor que corresponde a uma marca do Excel. */
export function codigoDaMarca(valor: number): CodigoEstado {
  return (valor === 7 ? 4 : valor) as CodigoEstado;
}

/**
 * Grava as marcas lidas (a importação mais recente vale) e devolve os pares
 * newsletter/dia cuja marca mudou, para reavaliar.
 */
export function guardarControlo(
  leitura: Leitura,
  ficheiro: string,
  quem: string | null,
  agora: Date = new Date(),
): { alteradas: { newsletterId: string; data: string }[]; importacao: number } {
  const bd = db();
  const quando = agora.toISOString();
  const antes = bd.prepare(`SELECT valor FROM controlo_cliente WHERE newsletter_id = ? AND data = ?`);
  const gravar = bd.prepare(
    `INSERT INTO controlo_cliente (newsletter_id, data, valor, folha, linha, importado_em) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(newsletter_id, data) DO UPDATE SET valor = excluded.valor, folha = excluded.folha,
       linha = excluded.linha, importado_em = excluded.importado_em`,
  );
  const alteradas: { newsletterId: string; data: string }[] = [];
  let importacao = 0;
  bd.transaction(() => {
    for (const m of leitura.marcas) {
      const a = antes.get(m.newsletterId, m.data) as { valor: number } | undefined;
      gravar.run(m.newsletterId, m.data, m.valor, m.folha, m.linha, quando);
      if (!a || a.valor !== m.valor) alteradas.push({ newsletterId: m.newsletterId, data: m.data });
    }
    importacao = Number(
      bd
        .prepare(
          `INSERT INTO controlo_importacoes (importado_em, ficheiro, quem, marcas, alteradas, resumo) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(quando, ficheiro.slice(0, 200), quem, leitura.marcas.length, alteradas.length,
          JSON.stringify({ folhas: leitura.folhas, ignoradas: leitura.ignoradas })).lastInsertRowid,
    );
  })();
  cache = null;
  return { alteradas, importacao };
}

export function ultimasImportacoes(n = 5): Importacao[] {
  return db().prepare(`SELECT * FROM controlo_importacoes ORDER BY id DESC LIMIT ?`).all(n) as Importacao[];
}

// ── Comparação ──────────────────────────────────────────────────────────────

export type Categoria =
  | "confirmada-pelo-cliente"
  | "nao-saiu-confirmado"
  | "desativada-pelo-cliente"
  | "codigo-diferente"
  | "cliente-nao-recebeu"
  | "igual";

export interface Diferenca {
  newsletterId: string;
  data: string;
  cliente: number;
  monitor: CodigoEstado;
  comEmail: boolean;
  categoria: Categoria;
}

const SAIU = (v: number) => v >= 1 && v <= 4 || v === 7;

/**
 * Cliente × monitor, dia a dia, no intervalo. Com o email na nossa caixa vale
 * o monitor: aí só se lista a diferença. Sem email, o registo já reflete a
 * marca do cliente (`reavaliar`) e a categoria diz o que ela fez.
 */
export function comparar(de: string, ate: string): Diferenca[] {
  const linhas = db()
    .prepare(
      `SELECT c.newsletter_id, c.data, c.valor, r.codigo_estado, r.nr_ocorrencias, r.fonte
         FROM controlo_cliente c JOIN registos r ON r.newsletter_id = c.newsletter_id AND r.data_prevista = c.data
        WHERE c.data BETWEEN ? AND ? ORDER BY c.newsletter_id, c.data`,
    )
    .all(de, ate) as {
      newsletter_id: string; data: string; valor: number; codigo_estado: CodigoEstado; nr_ocorrencias: number; fonte: string | null;
    }[];
  return linhas.map((l) => {
    const comEmail = l.nr_ocorrencias > 0;
    let categoria: Categoria = "igual";
    if (!comEmail && l.fonte === "cliente") {
      if (SAIU(l.valor)) categoria = "confirmada-pelo-cliente";
      else if (l.valor === 5) categoria = "nao-saiu-confirmado";
      else if (l.valor === 6) categoria = "desativada-pelo-cliente";
    } else if (comEmail && l.valor === 5) categoria = "cliente-nao-recebeu";
    else if (comEmail && codigoDaMarca(l.valor) !== l.codigo_estado) categoria = "codigo-diferente";
    return { newsletterId: l.newsletter_id, data: l.data, cliente: l.valor, monitor: l.codigo_estado, comEmail, categoria };
  });
}
