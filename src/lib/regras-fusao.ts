import { NEWSLETTERS, estaConfigurada } from "../../config/newsletters.ts";
import type { Newsletter, RegraAlternativa } from "./tipos.ts";

/**
 * Fusão das regras guardadas no painel com o config/newsletters.ts.
 *
 * O ficheiro é a base (gerado do Excel, com os critérios escritos à mão); o
 * painel só ACRESCENTA formas de reconhecer uma newsletter — um endereço exato
 * mais uma marca no corpo. Nunca tira nada ao ficheiro, por isso uma regra do
 * painel não pode fazer edições já reconhecidas deixarem de contar.
 *
 * Como se junta, para uma newsletter com regras do painel:
 *   - os endereços das regras somam-se a `remetentes` (a prova de ausência
 *     usa-os para saber de onde a newsletter pode chegar);
 *   - se o ficheiro já a reconhece (`estaConfigurada`), as regras ficam todas
 *     em `alternativas`: basta uma bater;
 *   - se o ficheiro não a reconhece, a primeira regra (a mais antiga) passa a
 *     ser o critério principal — marca no corpo obrigatória, sem padrões de
 *     nome nem de assunto — e as outras ficam em `alternativas`.
 *
 * Determinístico: as regras aplicam-se por ordem de criação (id).
 *
 * Este módulo não toca na base de dados; quem lê as regras e as aplica é o
 * `db()` (db.ts), sempre que a versão das regras muda.
 */

export interface RegraGuardada extends RegraAlternativa {
  id: number;
  newsletterId: string;
}

type Base = Pick<Newsletter, "remetentes" | "marcaCorpo" | "padraoRemetente" | "padraoAssunto">;

/** Os critérios do ficheiro, guardados antes da primeira fusão. */
const bases = new WeakMap<Newsletter, Base>();

function baseDe(n: Newsletter): Base {
  let b = bases.get(n);
  if (!b) {
    b = {
      remetentes: [...n.remetentes],
      marcaCorpo: n.marcaCorpo,
      padraoRemetente: n.padraoRemetente,
      padraoAssunto: n.padraoAssunto,
    };
    bases.set(n, b);
  }
  return b;
}

/** A newsletter como está no ficheiro, sem nada do painel. */
export function doFicheiro(n: Newsletter): Newsletter {
  const { alternativas: _ignorar, ...resto } = n;
  return { ...resto, ...baseDe(n), remetentes: [...baseDe(n).remetentes] };
}

/** O ficheiro, por si só, já reconhece os emails desta newsletter? */
export function configuradaNoFicheiro(n: Newsletter): boolean {
  return estaConfigurada(doFicheiro(n));
}

function unicos(lista: string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const s of lista) {
    const k = s.trim().toLowerCase();
    if (k && !vistos.has(k)) {
      vistos.add(k);
      saida.push(s.trim());
    }
  }
  return saida;
}

/** Junta as regras do painel (já por ordem) a uma newsletter tal como está no ficheiro. */
export function fundir(base: Newsletter, regras: RegraAlternativa[]): Newsletter {
  const { alternativas: _ignorar, ...semAlternativas } = base;
  if (regras.length === 0) return semAlternativas;
  const remetentes = unicos([...base.remetentes, ...regras.map((r) => r.remetente)]);
  const copia = regras.map((r) => ({ remetente: r.remetente, marcaCorpo: r.marcaCorpo }));
  if (estaConfigurada(base)) return { ...semAlternativas, remetentes, alternativas: copia };
  const [primeira, ...resto] = copia;
  return {
    ...semAlternativas,
    remetentes,
    marcaCorpo: primeira.marcaCorpo,
    padraoRemetente: "",
    padraoAssunto: "",
    ...(resto.length > 0 ? { alternativas: resto } : {}),
  };
}

/** A lista completa, fundida, sem mexer na configuração em memória. */
export function fundirTodas(regras: RegraGuardada[], lista: Newsletter[] = NEWSLETTERS): Newsletter[] {
  const ordenadas = [...regras].sort((a, b) => a.id - b.id);
  return lista.map((n) =>
    fundir(
      doFicheiro(n),
      ordenadas.filter((r) => r.newsletterId === n.id),
    ),
  );
}

/**
 * Aplica as regras à configuração carregada (os objetos de NEWSLETTERS), para
 * que todo o código que a lê — correspondência, prova de ausência, painel,
 * Excel — veja o mesmo. Começa sempre da base do ficheiro: aplicar duas vezes
 * dá o mesmo resultado, e apagar uma regra repõe o ficheiro.
 */
export function aplicarNaConfig(regras: RegraGuardada[], lista: Newsletter[] = NEWSLETTERS): void {
  const fundidas = fundirTodas(regras, lista);
  lista.forEach((n, i) => {
    const f = fundidas[i];
    n.remetentes = f.remetentes;
    n.marcaCorpo = f.marcaCorpo;
    n.padraoRemetente = f.padraoRemetente;
    n.padraoAssunto = f.padraoAssunto;
    if (f.alternativas) n.alternativas = f.alternativas;
    else delete n.alternativas;
  });
}

// ── Versão das regras ─────────────────────────────────────────────────────
// Partilhada pelo processo inteiro (o Next pode ter várias cópias de cada
// módulo): quando uma rota grava uma regra, todas as cópias voltam a aplicar.

const VERSAO = Symbol.for("media-livre.regras-versao");
const global_ = globalThis as unknown as Record<symbol, number | undefined>;

export function versaoRegras(): number {
  return global_[VERSAO] ?? 0;
}

export function regrasMudaram(): void {
  global_[VERSAO] = versaoRegras() + 1;
}

// ── Marca no corpo ────────────────────────────────────────────────────────

/** "/4196/<MARCA>_MASTHEAD/NEWSLETTER_<NOME>_LEADERBOARD", com "/" ou "%2F". */
const RE_MARCA = /\/4196\/([A-Z0-9_]+?)_MASTHEAD\/NEWSLETTER_([A-Z0-9_]+?)_LEADERBOARD/gi;

/** As marcas de publicidade de newsletter que o HTML traz, em maiúsculas e sem repetições. */
export function marcasNoCorpo(html: string): string[] {
  const corpo = html.replace(/%2F/gi, "/");
  const vistas = new Set<string>();
  for (const m of corpo.matchAll(RE_MARCA)) {
    vistas.add(`/4196/${m[1].toUpperCase()}_MASTHEAD/NEWSLETTER_${m[2].toUpperCase()}_LEADERBOARD`);
  }
  return [...vistas];
}

/** "/4196/FLASH_MASTHEAD/NEWSLETTER_THEMAG_LEADERBOARD" → { marca: "FLASH", nome: "THEMAG" }. */
export function partesDaMarca(marca: string): { marca: string; nome: string } | null {
  const m = /^\/4196\/([A-Z0-9_]+?)_MASTHEAD\/NEWSLETTER_([A-Z0-9_]+?)_LEADERBOARD$/i.exec(marca);
  return m ? { marca: m[1].toUpperCase(), nome: m[2].toUpperCase() } : null;
}

/** Todas as marcas no corpo que reconhecem esta newsletter (principal e alternativas). */
export function marcasDe(n: Newsletter): string[] {
  return [n.marcaCorpo, ...(n.alternativas ?? []).map((a) => a.marcaCorpo)]
    .map((m) => m.trim())
    .filter((m) => m !== "");
}
