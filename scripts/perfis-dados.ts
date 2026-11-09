/**
 * Os dados comuns a `calibrar-perfis.ts` e `mapa-perfis.ts`: cada edição de
 * cada newsletter avaliada pelo código de produção (`src/lib/perfil.ts`),
 * contra as edições anteriores, como o monitor a avaliaria nesse dia.
 *
 * Nunca mexe na base indicada: copia-a (API de cópia do SQLite, segura com o
 * monitor a escrever) para uma pasta temporária e trabalha sobre a cópia — o
 * `db()` do projeto aplica o esquema ao abrir, e isso não pode tocar na base
 * de produção. Nenhuma página é pedida: as datas dos artigos são as que já
 * estão na tabela `artigos`.
 */
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NEWSLETTERS } from "../config/newsletters.ts";
import { db, fecharDb } from "../src/lib/db.ts";
import { dataEdicao } from "../src/lib/edicao.ts";
import { ehDiaEsperado } from "../src/lib/classificacao.ts";
import { publicadoEm } from "../src/lib/datas-artigos.ts";
import {
  COBERTURA_MINIMA,
  MIN_DATADOS,
  edicaoDoEmail,
  historico,
  perfilDe,
  sinaisConteudo,
  type EdicaoVista,
  type Perfil,
  type SinaisConteudo,
} from "../src/lib/perfil.ts";
import { diaSemanaISO, paraInstante, somarDias } from "../src/lib/tempo.ts";
import type { Newsletter } from "../src/lib/tipos.ts";

/** O caminho da base: argumento, DATABASE_PATH ou a base local. */
export function caminhoDaBase(argumento?: string): string {
  return resolve(argumento || process.env.DATABASE_PATH || "./data/monitor.db");
}

/**
 * Copia a base para uma pasta temporária e aponta o `db()` do projeto para a
 * cópia. Devolve a função que fecha a ligação e apaga a cópia.
 */
export async function abrirCopia(caminho: string): Promise<() => void> {
  if (!existsSync(caminho)) throw new Error(`Base não encontrada: ${caminho}`);
  const pasta = mkdtempSync(join(tmpdir(), "nwl-perfis-"));
  const copia = join(pasta, "copia.db");
  const origem = new Database(caminho, { readonly: true, fileMustExist: true });
  try {
    await origem.backup(copia);
  } finally {
    origem.close();
  }
  process.env.DATABASE_PATH = copia;
  return () => {
    fecharDb();
    rmSync(pasta, { recursive: true, force: true });
  };
}

export function quantil(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
}

export interface EdicaoAvaliada {
  data: string;
  recebidoEm: Date;
  /** Minutos do 1.º email depois da hora prevista (negativo: adiantado). */
  desvioMin: number;
  /** Emails desta edição (mais do que 1: reenvio ou duplicado). */
  emails: number;
  vista: EdicaoVista;
  /** Edições anteriores com que foi comparada. */
  anteriores: number;
  /** O perfil com que foi julgada (só com as anteriores). */
  perfil: Perfil;
  sinais: SinaisConteudo;
  /** Fração dos artigos já usados em edições anteriores. */
  reuso: number | null;
  /** Idade (dias) do artigo mais recente, se a edição é medível. */
  maisRecente: number | null;
}

export interface Avaliacao {
  n: Newsletter;
  edicoes: EdicaoAvaliada[];
  /** O perfil que o monitor usaria para a próxima edição (todas as da base, até DIAS_DE_HISTORICO). */
  perfilAtual: Perfil;
}

/** Medível como em perfil.ts: artigos datados suficientes, em número e em fração. */
function maisRecenteDe(e: EdicaoVista): number | null {
  return e.idades.length >= MIN_DATADOS && e.idades.length / Math.max(1, e.artigos.length) >= COBERTURA_MINIMA
    ? Math.min(...e.idades)
    : null;
}

/** Avalia todas as edições de todas as newsletters da base (já aberta). */
export function avaliarTudo(): Avaliacao[] {
  const bd = db();
  const resultado: Avaliacao[] = [];
  for (const n of NEWSLETTERS) {
    const linhas = bd
      .prepare(`SELECT id, recebido_em FROM emails WHERE newsletter_id = ? ORDER BY recebido_em ASC`)
      .all(n.id) as { id: number; recebido_em: string }[];
    const porDia = new Map<string, { id: number; recebido_em: string }[]>();
    for (const l of linhas) {
      const dia = dataEdicao(n, new Date(l.recebido_em));
      porDia.set(dia, [...(porDia.get(dia) ?? []), l]);
    }
    const edicoes: EdicaoAvaliada[] = [];
    const vistos = new Set<string>();
    for (const [data, emails] of [...porDia].sort(([a], [b]) => a.localeCompare(b))) {
      const primeiro = emails[0];
      const vista = edicaoDoEmail(n, primeiro.id, primeiro.recebido_em);
      const hist = historico(n, data);
      const recebidoEm = new Date(primeiro.recebido_em);
      const reuso = vista.artigos.length ? vista.artigos.filter((u) => vistos.has(u)).length / vista.artigos.length : null;
      for (const u of vista.artigos) vistos.add(u);
      edicoes.push({
        data,
        recebidoEm,
        desvioMin: Math.round((recebidoEm.getTime() - paraInstante(data, n.horaPrevista).getTime()) / 60_000),
        emails: emails.length,
        vista,
        anteriores: hist.length,
        perfil: perfilDe(hist),
        sinais: sinaisConteudo(vista, hist),
        reuso,
        maisRecente: maisRecenteDe(vista),
      });
    }
    const ultima = edicoes.at(-1)?.data;
    const perfilAtual = perfilDe(ultima ? historico(n, somarDias(ultima, 1)) : []);
    resultado.push({ n, edicoes, perfilAtual });
  }
  return resultado;
}

/** Prova de conteúdo desatualizado (código 4) dada pelo perfil, ou null. */
export function provaDe(e: EdicaoAvaliada): string | null {
  const igual = e.sinais.igualA;
  if (igual) {
    return igual.como === "hash"
      ? `conteúdo igual ao da edição de ${igual.data}`
      : `os mesmos artigos da edição de ${igual.data}`;
  }
  return e.sinais.desatualizada;
}

// ── Formatação ────────────────────────────────────────────────────────────

export const horas = (dias: number) =>
  dias < 1 ? `${Math.round(Math.max(0, dias) * 24)} h` : `${dias.toFixed(1).replace(".", ",")} d`;

export const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "09:03" — a hora prevista deslocada de `min` minutos. */
export function horaMais(hora: string, min: number): string {
  const [hh, mm] = hora.split(":").map(Number);
  const t = (((hh * 60 + mm + min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export const desvio = (min: number) => (min >= 0 ? `+${min} min` : `${min} min`);

const NOMES = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

export function calendario(n: Newsletter): string {
  switch (n.periodicidade) {
    case "diaria":
      return "diária";
    case "dias_uteis":
      return "dias úteis";
    case "dia_semana":
      return `semanal (${(n.diasSemana ?? []).map((d) => NOMES[d - 1]).join(", ")})`;
    case "dia_mes":
      return `mensal (dia ${(n.diasMes ?? []).join(", ")})`;
    case "nao_agendada":
      return "sem agenda";
  }
}

/** Os dias da semana em que chegaram edições, com quantas: "seg 5, ter 6". */
export function diasVistos(eds: EdicaoAvaliada[]): string {
  const c = new Array(7).fill(0);
  for (const e of eds) c[diaSemanaISO(e.data) - 1]++;
  return c.map((x, i) => (x ? `${NOMES[i]} ${x}` : "")).filter(Boolean).join(", ");
}

/** Edições recebidas num dia que o calendário configurado não prevê. */
export function foraDoCalendario(a: Avaliacao): string[] {
  return a.edicoes.filter((e) => !ehDiaEsperado(a.n, e.data)).map((e) => e.data);
}

/** Fração dos artigos distintos com data de publicação conhecida. */
export function coberturaDatas(eds: EdicaoAvaliada[]): { com: number; total: number } {
  const urls = new Set(eds.flatMap((e) => e.vista.artigos));
  let com = 0;
  for (const u of urls) if (publicadoEm(u) !== undefined) com++;
  return { com, total: urls.size };
}

/** Os sites para onde a newsletter aponta, por fração de artigos distintos. */
export function sites(eds: EdicaoAvaliada[], maximo = 4): string {
  const urls = [...new Set(eds.flatMap((e) => e.vista.artigos))];
  if (!urls.length) return "—";
  const c = new Map<string, number>();
  for (const u of urls) {
    const s = u.split("/")[0].replace(/^www\./, "");
    c.set(s, (c.get(s) ?? 0) + 1);
  }
  const ordem = [...c].sort((a, b) => b[1] - a[1]);
  const partes = ordem.slice(0, maximo).map(([s, x]) => `${s} ${pct(x / urls.length)}`);
  if (ordem.length > maximo) partes.push(`+${ordem.length - maximo}`);
  return partes.join(", ");
}

/** A data no topo: quantas edições a trazem certa, errada, ou não a trazem. */
export function dataTopo(eds: EdicaoAvaliada[]): { certa: number; errada: number; sem: number } {
  const r = { certa: 0, errada: 0, sem: 0 };
  for (const e of eds) {
    if (!e.vista.dataTopo) r.sem++;
    else if (e.vista.dataTopo === e.data) r.certa++;
    else r.errada++;
  }
  return r;
}
