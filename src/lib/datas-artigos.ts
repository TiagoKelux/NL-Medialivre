import { db } from "./db.ts";
import { extrairArtigos } from "./conteudo.ts";
import { pedirPagina, type PedirPagina } from "./rede.ts";
import { paraIso } from "./tempo.ts";

/**
 * A data de publicação dos artigos de cada edição.
 *
 * O aspeto de uma newsletter muda (modelo, cores, blocos) e o texto não diz
 * de quando é: só as FLASH! escrevem a data no topo. Os artigos para onde a
 * edição aponta, esses, têm data — a página de cada um traz
 * `article:published_time` (ou `datePublished`). Uma edição de hoje que só
 * aponta para artigos de há um mês está desatualizada, seja qual for o
 * modelo. Medido a 09/11/2026: 98% dos 1550 artigos pedidos tinham data
 * (Record, CM, Negócios, FLASH!, Máxima, MUST), incluindo os premium.
 *
 * Cada URL pede-se uma vez; quem falhar volta a tentar-se mais tarde, até
 * MAXIMO_TENTATIVAS. Pedidos poucos e espaçados: no máximo POR_CICLO por
 * ciclo de 5 minutos, dois de cada vez.
 */

/** Só os artigos dos emails destes últimos dias se vão buscar. */
export const DIAS_A_RECOLHER = 3;
export const POR_CICLO = 40;
export const MAXIMO_TENTATIVAS = 4;
const EM_PARALELO = 2;

/** Os artigos de cada email, extraídos do HTML uma vez por processo. */
const artigosPorEmail = new Map<number, string[]>();

export function artigosDoEmail(id: number, html?: string): string[] {
  const guardados = artigosPorEmail.get(id);
  if (guardados) return guardados;
  const corpo =
    html ??
    ((db().prepare(`SELECT corpo_html FROM emails WHERE id = ?`).get(id) as { corpo_html: string } | undefined)
      ?.corpo_html ??
      "");
  const artigos = extrairArtigos(corpo);
  artigosPorEmail.set(id, artigos);
  return artigos;
}

/** A data de publicação que a página do artigo declara, ou null. */
export function dataPublicacao(html: string): string | null {
  const meta =
    html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i) ??
    html.match(/"datePublished"\s*:\s*"([^"]+)"/i);
  if (!meta) return null;
  const t = Date.parse(meta[1]);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Todas as datas conhecidas, em memória: o recálculo de 45 dias consulta-as
 * centenas de milhares de vezes. Carregadas uma vez; cada data nova recolhida
 * entra também aqui.
 */
let datasConhecidas: Map<string, number> | null = null;

function conhecidas(): Map<string, number> {
  if (!datasConhecidas) {
    datasConhecidas = new Map();
    const linhas = db()
      .prepare(`SELECT url, publicado_em FROM artigos WHERE publicado_em IS NOT NULL`)
      .all() as { url: string; publicado_em: string }[];
    for (const l of linhas) datasConhecidas.set(l.url, Date.parse(l.publicado_em));
  }
  return datasConhecidas;
}

/** Para os testes: esquecer o que está em memória (base nova). */
export function esquecerDatas(): void {
  datasConhecidas = null;
  artigosPorEmail.clear();
}

/** A data de publicação (ms) de um artigo, se já se conhece. */
export function publicadoEm(url: string): number | undefined {
  return conhecidas().get(url);
}

export interface ResumoDatas {
  pedidos: number;
  comData: number;
  /** Ids dos emails com pelo menos um artigo que ganhou data: a reavaliar. */
  emails: number[];
}

/**
 * Pede as datas que faltam aos artigos dos emails recentes. Nunca lança.
 * Devolve os emails que ganharam pelo menos uma data, para reavaliar.
 */
export async function recolherDatasArtigos(
  agora: Date = new Date(),
  pedir: PedirPagina = (u) => pedirPagina(u),
): Promise<ResumoDatas> {
  const resumo: ResumoDatas = { pedidos: 0, comData: 0, emails: [] };
  const bd = db();
  const desde = paraIso(new Date(agora.getTime() - DIAS_A_RECOLHER * 86_400_000));
  const emails = bd
    .prepare(
      `SELECT id FROM emails INDEXED BY idx_emails_identificacao
        WHERE recebido_em >= ? AND newsletter_id IS NOT NULL ORDER BY recebido_em DESC`,
    )
    .all(desde) as { id: number }[];

  const estadoDe = bd.prepare(`SELECT estado, tentativas, pedido_em FROM artigos WHERE url = ?`);
  const porUrl = new Map<string, number[]>();
  for (const { id } of emails) {
    for (const u of artigosDoEmail(id)) {
      const l = estadoDe.get(u) as { estado: number; tentativas: number; pedido_em: string | null } | undefined;
      if (l && (l.estado === 200 || l.estado === 404 || l.estado === 410 || l.tentativas >= MAXIMO_TENTATIVAS)) continue;
      // Uma falha espera 30 min antes de voltar a tentar.
      if (l?.pedido_em && agora.getTime() - Date.parse(l.pedido_em) < 30 * 60_000) continue;
      porUrl.set(u, [...(porUrl.get(u) ?? []), id]);
    }
  }
  const fila = [...porUrl.keys()].slice(0, POR_CICLO);
  const gravar = bd.prepare(
    `INSERT INTO artigos (url, publicado_em, estado, tentativas, pedido_em) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(url) DO UPDATE SET publicado_em = COALESCE(excluded.publicado_em, artigos.publicado_em),
       estado = excluded.estado, tentativas = artigos.tentativas + 1, pedido_em = excluded.pedido_em`,
  );
  const ganharam = new Set<number>();
  const trabalhador = async () => {
    while (fila.length) {
      const u = fila.shift()!;
      let r;
      try {
        r = await pedir(`https://${u}`);
      } catch {
        r = { estado: 0, corpo: "" };
      }
      const data = r.estado === 200 ? dataPublicacao(r.corpo) : null;
      gravar.run(u, data, r.estado, paraIso(agora));
      resumo.pedidos++;
      if (data) {
        conhecidas().set(u, Date.parse(data));
        resumo.comData++;
        for (const id of porUrl.get(u) ?? []) ganharam.add(id);
      }
    }
  };
  await Promise.all(Array.from({ length: EM_PARALELO }, trabalhador));
  resumo.emails = [...ganharam];
  return resumo;
}
