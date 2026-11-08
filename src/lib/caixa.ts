import { db } from "./db.ts";
import { NEWSLETTERS } from "../../config/newsletters.ts";
import { esperadoNoDia } from "./calendario.ts";
import { dataEdicao } from "./edicao.ts";
import { horaLimiteDe } from "./registos.ts";
import { dataLocal, somarDias } from "./tempo.ts";
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
