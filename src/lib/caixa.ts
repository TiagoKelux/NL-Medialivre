import { db } from "./db.ts";
import { NEWSLETTERS } from "../../config/newsletters.ts";
import { esperadoNoDia, newsletterDoRegisto } from "./calendario.ts";
import { ehDiaEsperado } from "./classificacao.ts";
import { extrairEndereco } from "./correspondencia.ts";
import { dataEdicao } from "./edicao.ts";
import { estadoAbertura, type EstadoAbertura } from "./abertura.ts";
import { marcasDoEmail } from "./marcas.ts";
import { eReconquista } from "./prova.ts";
import { horaLimiteDe } from "./registos.ts";
import { dataLocal, paraIso, somarDias } from "./tempo.ts";
import type { Newsletter } from "./tipos.ts";

/**
 * Saúde da CAIXA, não da leitura: o editor ainda nos manda as edições?
 *
 * A partir de 06/10 os editores deixaram de mandar a maior parte das diárias a
 * esta caixa (limpeza de inativos). A leitura continuava a correr bem — o
 * /api/saude dizia 200 — e o painel ia enchendo de "Não recebida – sem prova"
 * sem que nada dissesse porquê. Isto mede, por domínio do editor, há quantos
 * dias esperados não chega nenhuma edição diária.
 *
 * Só conta o que se sabe atribuído (`emails.newsletter_id`), e só as
 * newsletters gratuitas, ativas e com remetente: as pagas não chegam de
 * propósito.
 */

/** Dias esperados seguidos sem edição diária a partir dos quais a caixa se dá como cortada. */
export const DIAS_PARA_CORTE = 2;

/** Até onde se volta atrás a contar dias esperados. */
const MAXIMO_DIAS = 62;

export interface EstadoDominio {
  dominio: string;
  /** As diárias (diária ou dias úteis) deste domínio que contam. */
  diarias: string[];
  /** ISO da última edição recebida de qualquer newsletter do domínio. */
  ultimaEdicao: string | null;
  diasDesdeUltimaEdicao: number | null;
  /** ISO da última edição de uma DIÁRIA do domínio. */
  ultimaDiaria: string | null;
  /** Dias, depois da última diária, em que alguma diária era esperada e o limite já passou. */
  diasEsperadosSemDiaria: number;
  /** Primeiro desses dias (AAAA-MM-DD), ou null. */
  desde: string | null;
}

export interface CaixaCortada {
  dominio: string;
  /** Primeiro dia esperado sem nenhuma diária do domínio (AAAA-MM-DD). */
  desde: string;
  /** ISO da última edição diária recebida do domínio. */
  ultimaEdicao: string;
  diasEsperadosSemEdicao: number;
}

export interface SaudeCaixa {
  dominios: EstadoDominio[];
  caixaCortada: CaixaCortada[];
}

function dominioDe(endereco: string): string {
  const e = endereco.trim().toLowerCase();
  return e.startsWith("@") ? e.slice(1) : e.slice(e.indexOf("@") + 1);
}

const ehDiaria = (n: Newsletter) => n.periodicidade === "diaria" || n.periodicidade === "dias_uteis";

export function saudeCaixa(agora: Date = new Date(), newsletters: Newsletter[] = NEWSLETTERS): SaudeCaixa {
  const porDominio = new Map<string, Newsletter[]>();
  for (const n of newsletters) {
    if (!n.ativa || n.remetentes.length === 0) continue;
    for (const r of new Set(n.remetentes.map(dominioDe))) {
      if (!r) continue;
      const lista = porDominio.get(r) ?? [];
      if (!lista.includes(n)) lista.push(n);
      porDominio.set(r, lista);
    }
  }

  // A última edição de cada newsletter: uma consulta, pelo índice.
  const ultimas = new Map(
    (
      db()
        .prepare(
          `SELECT newsletter_id AS id, MAX(recebido_em) AS r FROM emails
            WHERE newsletter_id IS NOT NULL GROUP BY newsletter_id`,
        )
        .all() as { id: string; r: string }[]
    ).map((l) => [l.id, l.r]),
  );

  const hoje = dataLocal(agora);
  const dominios: EstadoDominio[] = [];
  for (const [dominio, lista] of [...porDominio].sort(([a], [b]) => a.localeCompare(b))) {
    const diarias = lista.filter(ehDiaria);
    const maximo = (ns: Newsletter[]) =>
      ns.map((n) => ultimas.get(n.id)).filter((r): r is string => !!r).sort().at(-1) ?? null;
    const ultimaEdicao = maximo(lista);
    const ultimaDiaria = maximo(diarias);

    // Dia de edição da última diária: o mais recente entre as diárias.
    let diaUltima: string | null = null;
    for (const n of diarias) {
      const r = ultimas.get(n.id);
      if (!r) continue;
      const d = dataEdicao(n, new Date(r));
      if (!diaUltima || d > diaUltima) diaUltima = d;
    }

    const semDiaria: string[] = [];
    if (diaUltima) {
      for (let d = somarDias(diaUltima, 1), i = 0; d <= hoje && i < MAXIMO_DIAS; d = somarDias(d, 1), i++) {
        if (diarias.some((n) => esperadoNoDia(n, d) && horaLimiteDe(n, d) <= agora)) semDiaria.push(d);
      }
    }

    dominios.push({
      dominio,
      diarias: diarias.map((n) => n.id),
      ultimaEdicao,
      diasDesdeUltimaEdicao: ultimaEdicao
        ? Math.floor((agora.getTime() - new Date(ultimaEdicao).getTime()) / 86_400_000)
        : null,
      ultimaDiaria,
      diasEsperadosSemDiaria: semDiaria.length,
      desde: semDiaria[0] ?? null,
    });
  }

  // Sem nenhuma diária alguma vez recebida não há prova de que a caixa
  // estivesse inscrita: não se diz "cortada", vê-se no detalhe do domínio.
  const caixaCortada = dominios
    .filter((d) => d.ultimaDiaria && d.desde && d.diasEsperadosSemDiaria >= DIAS_PARA_CORTE)
    .map((d) => ({
      dominio: d.dominio,
      desde: d.desde!,
      ultimaEdicao: d.ultimaDiaria!,
      diasEsperadosSemEdicao: d.diasEsperadosSemDiaria,
    }));

  return { dominios, caixaCortada };
}

// ── Listas em silêncio ─────────────────────────────────────────────────────

/**
 * O editor corta cada LISTA, não o domínio: depois de 6 envios seguidos sem
 * abertura, aquela newsletter deixa de vir e as outras do mesmo endereço
 * continuam. A contagem por domínio acima dizia "normalizada" com nove listas
 * desses domínios mortas. Aqui conta-se, por newsletter, quantas edições
 * esperadas (pelo calendário congelado de cada dia) passaram sem nada desde a
 * última recebida.
 *
 * É só informação: não mexe em nenhum código 1–6. O "sem prova" desses dias
 * continua a ser decidido pela prova de ausência (prova.ts).
 */

/** Edições esperadas seguidas sem nada a partir das quais se avisa. */
export const EDICOES_PARA_AVISO = 2;

/** A partir daqui a lista dá-se como cortada pelo editor. */
export const EDICOES_PARA_CORTE = 4;

export interface ListaEmSilencio {
  newsletterId: string;
  marca: string;
  nome: string;
  /** "aviso": a ficar em silêncio; "cortada": quase de certeza cortada pelo editor. */
  nivel: "aviso" | "cortada";
  /** Edições esperadas, com o limite já passado, sem nada recebido. */
  edicoesEmFalta: number;
  /** A primeira dessas edições (AAAA-MM-DD). */
  desde: string;
  /** ISO do último email recebido desta newsletter. */
  ultimaEdicao: string;
  /** O que fazer. */
  acao: string;
}

/** Até onde se procuram emails de reconquista ("vamos deixar de enviar"). */
export const DIAS_RECONQUISTA_RECENTE = 7;

/**
 * As campanhas de reativação do editor trazem `utm_campaign=reativacao1` (no
 * primeiro dia de uma lista) ou `reativacao2` (~15–21 dias depois: a última
 * oportunidade). Rede extra ao `eReconquista`, que olha para a estrutura.
 */
const REATIVACAO = /utm_campaign(?:=|%3D)reativacao\d*/i;

export interface ReconquistaRecente {
  emailId: number;
  remetente: string;
  assunto: string;
  recebidoEm: string;
  /** Se o pixel de abertura já respondeu (abertura.ts). */
  abertura: EstadoAbertura;
  abertoEm: string | null;
}

export interface VigilanciaListas {
  listas: ListaEmSilencio[];
  reconquistas: ReconquistaRecente[];
}

export function vigilanciaListas(agora: Date = new Date(), newsletters: Newsletter[] = NEWSLETTERS): VigilanciaListas {
  const bd = db();
  const ultimas = new Map(
    (
      bd
        .prepare(
          `SELECT newsletter_id AS id, MAX(recebido_em) AS r FROM emails
            WHERE newsletter_id IS NOT NULL AND recebido_em <= ? GROUP BY newsletter_id`,
        )
        .all(paraIso(agora)) as { id: string; r: string }[]
    ).map((l) => [l.id, l.r]),
  );

  const hoje = dataLocal(agora);
  const listas: ListaEmSilencio[] = [];
  for (const n of newsletters) {
    if (!n.ativa || n.remetentes.length === 0) continue;
    const ultima = ultimas.get(n.id);
    // Nunca chegou nada: não há prova de que a caixa esteja inscrita.
    if (!ultima) continue;
    const emFalta: string[] = [];
    let d = somarDias(dataEdicao(n, new Date(ultima)), 1);
    for (let i = 0; d <= hoje && i < MAXIMO_DIAS; d = somarDias(d, 1), i++) {
      // O calendário desse dia, não o de hoje (calendario.ts).
      const nd = newsletterDoRegisto(n, d);
      if (ehDiaEsperado(nd, d) && horaLimiteDe(nd, d) <= agora) emFalta.push(d);
    }
    if (emFalta.length < EDICOES_PARA_AVISO) continue;
    const cortada = emFalta.length >= EDICOES_PARA_CORTE;
    listas.push({
      newsletterId: n.id,
      marca: n.marca,
      nome: n.nome,
      nivel: cortada ? "cortada" : "aviso",
      edicoesEmFalta: emFalta.length,
      desde: emFalta[0],
      ultimaEdicao: ultima,
      acao: cortada
        ? "reinscrever esta newsletter na caixa monitorizada"
        : "confirmar no site do editor se saiu; se a próxima também não chegar, reinscrever esta newsletter",
    });
  }
  listas.sort((a, b) => a.desde.localeCompare(b.desde) || a.newsletterId.localeCompare(b.newsletterId));

  // Reconquistas: dos domínios das newsletters configuradas, nos últimos dias.
  const dominios = new Set<string>();
  for (const n of newsletters) {
    for (const r of n.remetentes) {
      const dom = dominioDe(r);
      if (dom) dominios.add(dom);
    }
  }
  const desde = paraIso(new Date(agora.getTime() - DIAS_RECONQUISTA_RECENTE * 86_400_000));
  const candidatos = (
    bd
      .prepare(
        `SELECT id, remetente, assunto, recebido_em, marcas FROM emails INDEXED BY idx_emails_identificacao
          WHERE newsletter_id IS NULL AND recebido_em >= ? AND recebido_em <= ?
          ORDER BY recebido_em DESC`,
      )
      .all(desde, paraIso(agora)) as {
        id: number;
        remetente: string;
        assunto: string;
        recebido_em: string;
        marcas: string | null;
      }[]
  ).filter((e) => dominios.has(dominioDe(extrairEndereco(e.remetente))));

  const corpo = bd.prepare(`SELECT corpo_html AS html FROM emails WHERE id = ?`);
  const abertura = bd.prepare(`SELECT aberto_em AS a, abertura_falhas AS f FROM emails WHERE id = ?`);
  const reconquistas: ReconquistaRecente[] = [];
  for (const e of candidatos) {
    const sim =
      eReconquista(e.remetente, e.assunto, marcasDoEmail(e.id, e.marcas)) ||
      REATIVACAO.test((corpo.get(e.id) as { html: string } | undefined)?.html ?? "");
    if (!sim) continue;
    const a = abertura.get(e.id) as { a: string | null; f: number };
    reconquistas.push({
      emailId: e.id,
      remetente: e.remetente,
      assunto: e.assunto,
      recebidoEm: e.recebido_em,
      abertura: estadoAbertura(a.a, a.f),
      abertoEm: a.a,
    });
  }

  return { listas, reconquistas };
}
