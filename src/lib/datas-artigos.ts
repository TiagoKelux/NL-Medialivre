import { db } from "./db.ts";
import { extrairArtigos } from "./conteudo.ts";
import { pedirPagina, type PedirPagina } from "./rede.ts";
import { paraInstante, paraIso } from "./tempo.ts";

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

/**
 * Primeiro os artigos dos emails destes últimos dias (as edições a decidir);
 * com o que sobrar de cada ciclo, os do histórico até DIAS_DE_HISTORICO, mais
 * recentes primeiro — numa base nova o perfil enche-se sozinho, aos poucos.
 */
export const DIAS_A_RECOLHER = 3;
export const DIAS_DE_HISTORICO = 90;
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

/**
 * A data de publicação que a página do artigo declara, com hora, ou null.
 *
 * Cada site declara-a à sua maneira (medido a 09/11/2026):
 *  - Record e CM: `article:published_time` e `datePublished` com hora;
 *  - Negócios: `<meta name="published_time">` com hora, mas o `datePublished`
 *    do JSON-LD só traz o dia;
 *  - FLASH!, Máxima, MUST: `datePublished` só com o dia (na MUST, às vezes o
 *    dia da última atualização) e `dateCreated` com hora.
 * Só o dia (lido como 00h) faria de todos os artigos de ontem "anteriores à
 * edição de ontem" e estragava a regra "nada publicado desde a anterior". Por
 * isso: `published_time` → `datePublished` com hora → `dateCreated` com hora
 * do mesmo dia que o `datePublished` → o dia, às 00h de Lisboa.
 */
export function dataPublicacao(html: string): string | null {
  const meta = (nome: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${nome}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${nome}["']`, "i"))?.[1];
  const json = (campo: string) => html.match(new RegExp(`"${campo}"\\s*:\\s*"([^"]+)"`, "i"))?.[1];
  const temHora = (v?: string | null) => !!v && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
  const valida = (v?: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);

  const publicado = meta("article:published_time") ?? meta("published_time");
  if (temHora(publicado)) return valida(publicado);
  const datePublished = json("datePublished");
  if (temHora(datePublished)) return valida(datePublished);
  const criado = json("dateCreated");
  const dia = (datePublished ?? publicado ?? "").slice(0, 10);
  if (temHora(criado) && (!dia || criado!.slice(0, 10) === dia)) return valida(criado);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dia)) return paraInstante(dia, "00:00").toISOString();
  return valida(publicado ?? datePublished ?? null);
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
  const desde = paraIso(new Date(agora.getTime() - DIAS_DE_HISTORICO * 86_400_000));
  const recente = paraIso(new Date(agora.getTime() - DIAS_A_RECOLHER * 86_400_000));
  const emails = bd
    .prepare(
      `SELECT id, recebido_em FROM emails INDEXED BY idx_emails_identificacao
        WHERE recebido_em >= ? AND newsletter_id IS NOT NULL ORDER BY recebido_em DESC`,
    )
    .all(desde) as { id: number; recebido_em?: string }[];

  const estadoDe = bd.prepare(`SELECT estado, tentativas, pedido_em FROM artigos WHERE url = ?`);
  const porUrl = new Map<string, number[]>();
  const recentes = new Set<string>();
  for (const { id, recebido_em } of emails) {
    for (const u of artigosDoEmail(id)) {
      const l = estadoDe.get(u) as { estado: number; tentativas: number; pedido_em: string | null } | undefined;
      if (l && (l.estado === 200 || l.estado === 404 || l.estado === 410 || l.tentativas >= MAXIMO_TENTATIVAS)) continue;
      // Uma falha espera 30 min antes de voltar a tentar.
      if (l?.pedido_em && agora.getTime() - Date.parse(l.pedido_em) < 30 * 60_000) continue;
      porUrl.set(u, [...(porUrl.get(u) ?? []), id]);
      if (recebido_em && recebido_em >= recente) recentes.add(u);
    }
  }
  // Os recentes à frente; o histórico (já por ordem, mais recente primeiro) a seguir.
  const todos = [...porUrl.keys()];
  const fila = [...todos.filter((u) => recentes.has(u)), ...todos.filter((u) => !recentes.has(u))].slice(0, POR_CICLO);
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
