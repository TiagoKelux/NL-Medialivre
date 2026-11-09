import { db } from "./db.ts";
import type { Newsletter } from "./tipos.ts";
import { dataEdicao, intervaloDeBusca } from "./edicao.ts";
import { processarCorpo, extrairArtigos, hashConteudo } from "./conteudo.ts";
import { publicadoEm } from "./datas-artigos.ts";
import { dataNoTopo } from "./datas.ts";
import { diaMes, paraIso } from "./tempo.ts";

/**
 * O perfil de cada newsletter, aprendido com o seu próprio histórico, e os
 * sinais de conteúdo de uma edição medidos contra ele.
 *
 * Cada newsletter tem o seu normal: o Record Premium aponta para artigos com
 * ~7 h, a MUST para artigos com semanas; a Máxima reaproveita metade dos
 * artigos, o CM Bom Dia nenhum. Um limite igual para todas daria alarmes
 * falsos. Por isso cada edição compara-se com as edições ANTERIORES da mesma
 * newsletter (até DIAS_DE_HISTORICO), como o monitor as viu nesse dia.
 *
 * Nada aqui depende do aspeto (modelo, cores, blocos), que muda: só dos
 * artigos, das suas datas de publicação e do conteúdo normalizado.
 *
 * Com prova (mudam o código para 4, "Saiu com Conteúdo Desatualizado"):
 *  - igual a uma edição antiga qualquer (hash, ou exatamente os mesmos
 *    artigos, com pelo menos MIN_ARTIGOS);
 *  - o artigo MAIS RECENTE da edição muito mais velho do que o normal desta
 *    newsletter E já publicado antes de a edição anterior sair — nada de novo
 *    desde a última edição (uma legítima traz sempre alguma coisa; uma
 *    reenviada não traz nada). A 2.ª condição protege a edição de segunda de
 *    uma "dias úteis": o mais recente é de sábado, mas é posterior à de sexta;
 *  - a data no topo errada, numa newsletter que a escreve sempre.
 * Só aviso (no detalhe, não mudam o código): mais recente mais velho do que
 * em qualquer edição anterior, reaproveitamento e número de artigos fora do
 * costume.
 *
 * Calibrado a 09/11/2026 sobre as 329 edições de 29/09 a 08/11 (2681 artigos
 * datados): nenhuma edição legítima daria prova. A idade MEDIANA não serve —
 * o Negócios 5 Coisas aponta para artigos de contexto de há semanas ao lado
 * das notícias do dia (27/10: mediana 11 dias, mais recente do próprio dia). O mais
 * recente de cada edição é estável: ≤ 3 h no Record, ~1,4 dias nas FLASH!.
 */

export const DIAS_DE_HISTORICO = 90;
/** Edições com datas necessárias para haver perfil de idade. */
export const MIN_EDICOES_PERFIL = 5;
/** Artigos datados mínimos numa edição, e fração do total, para a medir. */
export const MIN_DATADOS = 3;
export const COBERTURA_MINIMA = 0.6;
/** Desatualizada: o mais recente acima de max(LIMITE_MIN_DIAS, FATOR × p90 do perfil). */
export const LIMITE_MIN_DIAS = 1;
export const FATOR_IDADE = 3;
/** Sem perfil ainda: só aviso, acima disto. */
export const AVISO_SEM_PERFIL_DIAS = 30;
const MIN_ARTIGOS = 3;

export interface EdicaoVista {
  data: string;
  recebidoEm: Date;
  hash: string;
  artigos: string[];
  /** Idade (dias) de cada artigo datado, no momento em que a edição chegou. */
  idades: number[];
  dataTopo: string | null;
}

const porEmail = new Map<number, { hash: string; artigos: string[]; dataTopo: string | null; data: string }>();

/** Para os testes. */
export function esquecerPerfis(): void {
  porEmail.clear();
}

function lerEmail(n: Newsletter, id: number, recebido: string): EdicaoVista {
  let m = porEmail.get(id);
  if (!m) {
    const html =
      (db().prepare(`SELECT corpo_html FROM emails WHERE id = ?`).get(id) as { corpo_html: string } | undefined)
        ?.corpo_html ?? "";
    const data = dataEdicao(n, new Date(recebido));
    m = { hash: html ? processarCorpo(html).hash : "", artigos: extrairArtigos(html), dataTopo: dataNoTopo(html, data), data };
    porEmail.set(id, m);
  }
  const t = Date.parse(recebido);
  const idades: number[] = [];
  for (const u of m.artigos) {
    const p = publicadoEm(u);
    if (p !== undefined) idades.push((t - p) / 86_400_000);
  }
  return { data: m.data, recebidoEm: new Date(recebido), hash: m.hash, artigos: m.artigos, idades, dataTopo: m.dataTopo };
}

/** A edição como chegou: o primeiro email, com os sinais. */
export function edicaoDoEmail(n: Newsletter, id: number, recebido: string): EdicaoVista {
  return lerEmail(n, id, recebido);
}

/** As edições anteriores a `data` (o primeiro email de cada), mais antigas primeiro. */
export function historico(n: Newsletter, data: string, dias = DIAS_DE_HISTORICO): EdicaoVista[] {
  // Até ao fim da janela de busca de `data` (folgada), e o filtro por
  // `dataEdicao` deixa só as edições ANTERIORES — incluindo a de ontem.
  const { inicio, fim } = intervaloDeBusca(data);
  const desde = new Date(inicio.getTime() - dias * 86_400_000);
  const linhas = db()
    .prepare(
      `SELECT id, recebido_em FROM emails INDEXED BY idx_emails_newsletter
        WHERE newsletter_id = ? AND recebido_em >= ? AND recebido_em < ?
        ORDER BY recebido_em ASC`,
    )
    .all(n.id, paraIso(desde), paraIso(fim)) as { id: number; recebido_em: string }[];
  const vistas = new Map<string, EdicaoVista>();
  for (const l of linhas) {
    const dia = dataEdicao(n, new Date(l.recebido_em));
    if (dia >= data || vistas.has(dia)) continue;
    vistas.set(dia, lerEmail(n, l.id, l.recebido_em));
  }
  return [...vistas.values()];
}

function quantil(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
}
const mediana = (xs: number[]) => quantil(xs, 0.5);
const medivel = (e: EdicaoVista) =>
  e.idades.length >= MIN_DATADOS && e.idades.length / Math.max(1, e.artigos.length) >= COBERTURA_MINIMA;

export interface Perfil {
  edicoes: number;
  desde: string | null;
  artigos: { mediana: number; min: number; max: number } | null;
  /** Idade (dias) do artigo mais recente de cada edição anterior: mediana, p90, máximo. */
  idade: { edicoes: number; p50: number; p90: number; max: number } | null;
  /** Fração de artigos já usados antes, por edição: p90. */
  reusoP90: number | null;
  /** Escreve sempre a data do dia no topo (≥ 90% de ≥ 5 edições)? */
  dataNoTopo: boolean;
}

function reusoDe(e: EdicaoVista, vistos: Set<string>): number {
  return e.artigos.length ? e.artigos.filter((u) => vistos.has(u)).length / e.artigos.length : 0;
}

export function perfilDe(hist: EdicaoVista[]): Perfil {
  const nArt = hist.map((e) => e.artigos.length).filter((x) => x > 0);
  const medidas = hist.filter(medivel).map((e) => Math.min(...e.idades));
  const vistos = new Set<string>();
  const reusos: number[] = [];
  for (const e of hist) {
    if (e.artigos.length) reusos.push(reusoDe(e, vistos));
    for (const u of e.artigos) vistos.add(u);
  }
  const certas = hist.filter((e) => e.dataTopo === e.data).length;
  return {
    edicoes: hist.length,
    desde: hist[0]?.data ?? null,
    artigos: nArt.length >= MIN_EDICOES_PERFIL ? { mediana: mediana(nArt), min: Math.min(...nArt), max: Math.max(...nArt) } : null,
    idade:
      medidas.length >= MIN_EDICOES_PERFIL
        ? { edicoes: medidas.length, p50: mediana(medidas), p90: quantil(medidas, 0.9), max: Math.max(...medidas) }
        : null,
    reusoP90: reusos.length >= MIN_EDICOES_PERFIL ? quantil(reusos, 0.9) : null,
    dataNoTopo: hist.length >= MIN_EDICOES_PERFIL && certas / hist.length >= 0.9,
  };
}

export interface SinaisConteudo {
  /** Igual a uma edição antiga (a mais recente que bater). */
  igualA: { data: string; como: "hash" | "artigos" } | null;
  /** Prova de conteúdo desatualizado: a frase, ou null. */
  desatualizada: string | null;
  /** O que se sabe da idade dos artigos, para o detalhe. */
  idade: string | null;
  /**
   * A idade dos artigos foi medida contra o perfil e está dentro do normal:
   * prova de conteúdo atualizado mesmo sem edição anterior para comparar.
   */
  frescoProvado: boolean;
  avisos: string[];
}

const dias = (x: number) => (x < 1 ? `${Math.round(x * 24)} h` : `${x.toFixed(x < 10 ? 1 : 0).replace(".", ",")} dias`);

/** O hash de um corpo vazio: nunca serve de prova. */
const HASH_VAZIO = hashConteudo("");

/** Os sinais de conteúdo de uma edição, contra o histórico da newsletter. */
export function sinaisConteudo(atual: EdicaoVista, hist: EdicaoVista[]): SinaisConteudo {
  const s: SinaisConteudo = { igualA: null, desatualizada: null, idade: null, frescoProvado: false, avisos: [] };
  const perfil = perfilDe(hist);

  // 1) Igual a uma edição antiga qualquer.
  if (atual.hash && atual.hash !== HASH_VAZIO) {
    const igual = [...hist].reverse().find((e) => e.hash === atual.hash);
    if (igual) s.igualA = { data: igual.data, como: "hash" };
  }
  if (!s.igualA && atual.artigos.length >= MIN_ARTIGOS) {
    const meus = new Set(atual.artigos);
    const igual = [...hist]
      .reverse()
      .find((e) => new Set(e.artigos).size === meus.size && e.artigos.every((u) => meus.has(u)));
    if (igual) s.igualA = { data: igual.data, como: "artigos" };
  }

  // 2) A idade dos artigos.
  if (medivel(atual)) {
    const med = Math.min(...atual.idades);
    const base = `Artigo mais recente publicado há ${dias(Math.max(0, med))} (${atual.idades.length} artigos com data)`;
    if (perfil.idade) {
      const limite = Math.max(LIMITE_MIN_DIAS, FATOR_IDADE * perfil.idade.p90);
      const normal = `o normal desta newsletter é até ${dias(perfil.idade.p90)}`;
      const anterior = hist.at(-1);
      const publicadoMaisRecente = atual.recebidoEm.getTime() - med * 86_400_000;
      const nadaDesdeAnterior = !anterior || publicadoMaisRecente < anterior.recebidoEm.getTime();
      if (med > limite && nadaDesdeAnterior) {
        s.desatualizada =
          `${base} — nada publicado desde a edição anterior (${diaMes(anterior?.data ?? atual.data)}); ${normal} → conteúdo desatualizado.`;
      } else if (med > limite) {
        s.avisos.push(`⚠ ${base}: mais velho do que o costume (${normal}), mas posterior à edição anterior.`);
      } else if (med > Math.max(1, 1.5 * perfil.idade.max)) {
        s.avisos.push(`⚠ ${base}: mais velho do que em qualquer edição anterior (${normal}).`);
      } else {
        s.idade = `${base}; ${normal} ✓`;
        s.frescoProvado = true;
      }
    } else if (med > AVISO_SEM_PERFIL_DIAS) {
      s.avisos.push(`⚠ ${base}. Ainda sem histórico para saber se é normal nesta newsletter.`);
    } else {
      s.idade = `${base}.`;
    }
  }

  // 3) A data do topo, numa newsletter que a escreve sempre.
  if (perfil.dataNoTopo && atual.dataTopo && atual.dataTopo !== atual.data) {
    s.desatualizada ??=
      `A edição diz "${diaMes(atual.dataTopo)}" no topo e é a de ${diaMes(atual.data)} — ` +
      `esta newsletter escreve sempre a data do dia → conteúdo desatualizado.`;
  }

  // 4) Avisos de costume.
  if (perfil.reusoP90 !== null && atual.artigos.length >= MIN_ARTIGOS) {
    const vistos = new Set(hist.flatMap((e) => e.artigos));
    const r = reusoDe(atual, vistos);
    if (r >= 0.8 && r > perfil.reusoP90 + 0.2) {
      s.avisos.push(
        `⚠ ${Math.round(r * 100)}% dos artigos já tinham saído em edições anteriores ` +
          `(o costume é até ${Math.round(perfil.reusoP90 * 100)}%).`,
      );
    }
  }
  if (perfil.artigos && atual.artigos.length > 0) {
    const { min, max } = perfil.artigos;
    if (atual.artigos.length < Math.floor(min / 2) || atual.artigos.length > Math.ceil(max * 1.5)) {
      s.avisos.push(`⚠ ${atual.artigos.length} artigos (o costume é ${min} a ${max}).`);
    }
  }
  return s;
}
