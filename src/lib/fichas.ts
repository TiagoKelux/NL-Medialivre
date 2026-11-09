import { NEWSLETTERS, estaConfigurada } from "../../config/newsletters.ts";
import type { Newsletter, Periodicidade } from "./tipos.ts";
import { historico, perfilDe, sinaisConteudo, MIN_EDICOES_PERFIL, type EdicaoVista, type Perfil } from "./perfil.ts";
import { temEdicaoPropria } from "./edicao.ts";
import { dataLocal, diaSemanaISO, minutosEntre, paraInstante, somarDias } from "./tempo.ts";

/**
 * A ficha de cada newsletter: o normal dela, aprendido com as edições dos
 * últimos 90 dias, e a última edição posta ao lado — para a equipa ver o
 * padrão de cada uma e se a de hoje cabe nele.
 *
 * Tal como o perfil (lib/perfil.ts), nada aqui depende do aspeto do email
 * (modelo, cores, blocos), que muda: só das horas de chegada, dos artigos,
 * das suas datas de publicação e do conteúdo normalizado. O HTML não se lê
 * aqui — o perfil guarda o que precisa de cada email, uma vez por processo.
 */

/** Edições a partir das quais o perfil se considera estável. */
export const EDICOES_ESTAVEL = 10;

export type EstadoPerfil = "sem histórico" | "a aprender" | "estável";

export interface UltimaEdicao {
  data: string;
  /** Hora local (Lisboa) do primeiro email da edição. */
  hora: string;
  artigos: number;
  /** Idade (dias) do artigo mais recente, quando há algum com data. */
  maisRecenteDias: number | null;
  /** Prova de conteúdo desatualizado (a frase), ou null. */
  desatualizada: string | null;
  igualA: { data: string; como: "hash" | "artigos" } | null;
  /** O que se sabe da idade dos artigos, quando está dentro do normal. */
  idade: string | null;
  /** A idade foi medida contra o perfil e está dentro do normal. */
  frescoProvado: boolean;
  avisos: string[];
}

export interface Ficha {
  id: string;
  marca: string;
  nome: string;
  ativa: boolean;
  periodicidade: Periodicidade;
  /** O calendário configurado, por extenso. */
  calendario: string;
  estadoPerfil: EstadoPerfil;
  edicoes: number;
  primeira: string | null;
  ultima: string | null;
  dias: {
    /** Dias ISO (1 = segunda … 7 = domingo) de envio configurados; null num "dia do mês". */
    configurados: number[] | null;
    /** Edições vistas em cada dia da semana, de segunda (índice 0) a domingo. */
    vistos: number[];
    /** Edições em dias sem edição própria no calendário configurado. */
    foraDoCalendario: number;
  };
  hora: {
    /** Hora prevista e hora limite (prevista + tolerância); null nas não agendadas. */
    prevista: string | null;
    limite: string | null;
    /** Hora de chegada do primeiro email de cada edição: mediana e p90. */
    mediana: string;
    p90: string;
    /** Fração das edições que chegaram até à hora limite; null nas não agendadas. */
    aTempo: number | null;
  } | null;
  artigos: Perfil["artigos"];
  /** Idade (dias) do artigo mais recente de cada edição: mediana, p90, máximo. */
  idade: Perfil["idade"];
  /** Fração dos artigos (de todas as edições) com data de publicação conhecida. */
  coberturaDatas: number | null;
  reusoP90: number | null;
  dataNoTopo: boolean;
  ultimaEdicao: UltimaEdicao | null;
}

function quantil(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
}

function minutosDe(hora: string): number {
  const [hh, mm] = hora.split(":").map(Number);
  return hh * 60 + mm;
}

function hhmm(minutos: number): string {
  const m = ((Math.round(minutos) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const NOMES_DIAS = ["2.ª", "3.ª", "4.ª", "5.ª", "6.ª", "sábado", "domingo"];

function diasConfigurados(n: Newsletter): number[] | null {
  switch (n.periodicidade) {
    case "diaria":
      return [1, 2, 3, 4, 5, 6, 7];
    case "dias_uteis":
      return [1, 2, 3, 4, 5];
    case "dia_semana":
      return [...(n.diasSemana ?? [])].sort((a, b) => a - b);
    case "dia_mes":
      return null;
    case "nao_agendada":
      return [];
  }
}

function calendarioDe(n: Newsletter): string {
  switch (n.periodicidade) {
    case "diaria":
      return "Todos os dias";
    case "dias_uteis":
      return "Dias úteis";
    case "dia_semana":
      return (n.diasSemana ?? []).map((d) => NOMES_DIAS[d - 1]).join(", ") || "—";
    case "dia_mes":
      return `Ao dia ${(n.diasMes ?? []).join(", ")} de cada mês`;
    case "nao_agendada":
      return "Não agendada";
  }
}

function estadoDe(edicoes: number): EstadoPerfil {
  if (edicoes < MIN_EDICOES_PERFIL) return "sem histórico";
  if (edicoes < EDICOES_ESTAVEL) return "a aprender";
  return "estável";
}

function horaDe(n: Newsletter, hist: EdicaoVista[]): Ficha["hora"] {
  if (!hist.length) return null;
  // Medido em minutos contra a hora prevista do próprio dia da edição: uma
  // Edição Noite das 21h que chegue às 00h30 conta 3 h 30 de atraso, não
  // "00:30" a puxar a mediana para a madrugada.
  const base = minutosDe(n.horaPrevista);
  const desvios = hist.map((e) => minutosEntre(paraInstante(e.data, n.horaPrevista), e.recebidoEm));
  const agendada = n.periodicidade !== "nao_agendada";
  return {
    prevista: agendada ? n.horaPrevista : null,
    limite: agendada ? hhmm(base + n.toleranciaMinutos) : null,
    mediana: hhmm(base + quantil(desvios, 0.5)),
    p90: hhmm(base + quantil(desvios, 0.9)),
    aTempo: agendada ? desvios.filter((d) => d <= n.toleranciaMinutos).length / desvios.length : null,
  };
}

/** A ficha de uma newsletter, com as edições dos últimos 90 dias até hoje (inclusive). */
export function fichaDe(n: Newsletter, hoje: string = dataLocal()): Ficha {
  // `historico(n, d)` dá as edições anteriores a `d`: até amanhã, para a de
  // hoje entrar. A última julga-se contra as anteriores, como na classificação.
  const hist = historico(n, somarDias(hoje, 1)).filter((e) => e.data <= hoje);
  const perfil = perfilDe(hist);

  const vistos = [0, 0, 0, 0, 0, 0, 0];
  let fora = 0;
  for (const e of hist) {
    vistos[diaSemanaISO(e.data) - 1]++;
    if (!temEdicaoPropria(n, e.data)) fora++;
  }

  const totalArtigos = hist.reduce((s, e) => s + e.artigos.length, 0);
  const datados = hist.reduce((s, e) => s + e.idades.length, 0);

  let ultimaEdicao: UltimaEdicao | null = null;
  const ultima = hist.at(-1);
  if (ultima) {
    const s = sinaisConteudo(ultima, hist.slice(0, -1));
    const hora = minutosEntre(paraInstante(ultima.data, n.horaPrevista), ultima.recebidoEm);
    ultimaEdicao = {
      data: ultima.data,
      hora: hhmm(minutosDe(n.horaPrevista) + hora),
      artigos: ultima.artigos.length,
      maisRecenteDias: ultima.idades.length ? Math.max(0, Math.min(...ultima.idades)) : null,
      desatualizada: s.desatualizada,
      igualA: s.igualA,
      idade: s.idade,
      frescoProvado: s.frescoProvado,
      avisos: s.avisos,
    };
  }

  return {
    id: n.id,
    marca: n.marca,
    nome: n.nome,
    ativa: n.ativa,
    periodicidade: n.periodicidade,
    calendario: calendarioDe(n),
    estadoPerfil: estadoDe(hist.length),
    edicoes: hist.length,
    primeira: hist[0]?.data ?? null,
    ultima: ultima?.data ?? null,
    dias: { configurados: diasConfigurados(n), vistos, foraDoCalendario: fora },
    hora: horaDe(n, hist),
    artigos: perfil.artigos,
    idade: perfil.idade,
    coberturaDatas: totalArtigos ? datados / totalArtigos : null,
    reusoP90: perfil.reusoP90,
    dataNoTopo: perfil.dataNoTopo,
    ultimaEdicao,
  };
}

/** As fichas de todas as newsletters configuradas, pela ordem do ficheiro. */
export function fichas(hoje: string = dataLocal()): Ficha[] {
  return NEWSLETTERS.filter(estaConfigurada).map((n) => fichaDe(n, hoje));
}
