import { db } from "./db.ts";
import { paraIso } from "./tempo.ts";

/**
 * Marcar como aberto: carregar o pixel de abertura de cada email novo.
 *
 * Os editores cortam as diárias a quem nunca abre os emails. A caixa é lida
 * por IMAP, que nunca carrega imagens: para o Echobox, nlmedialivre@gmail.com
 * nunca abriu nada, e a 06/10 (uma semana depois da inscrição) as diárias de
 * CM, Record, Negócios e Máxima deixaram de chegar; as da FLASH! a 15/10.
 *
 * Todas as edições (119 de 119, 29/09 a 15/10) trazem o pixel do Amazon SES,
 * `https://<id>.r.<região>.awstrack.me/I0/…`. Pedi-lo é o que um cliente de
 * email faz ao mostrar as imagens. Só esse pixel: nunca um link (isso seria
 * um clique) nem outras imagens. Uma falha nunca trava a recolha.
 *
 * O editor corta cada LISTA depois de 6 envios seguidos sem abertura: um
 * pixel que falhe não pode ficar por pedir. O resultado fica gravado em cada
 * email (`aberto_em`, `abertura_falhas`, `abertura_tentada_em`) e cada ciclo
 * volta a tentar, com espera crescente, os da última semana que ainda não
 * abriram (`abrirPendentes`). Um email aberto com sucesso nunca se pede outra
 * vez.
 *
 * Desliga-se com MARCAR_ABERTURA=0: nada é pedido, e o que ficar por abrir
 * na última semana abre quando voltar a ligar.
 */
const PIXEL = /<img\b[^>]*?\bsrc\s*=\s*["'](https:\/\/[a-z0-9-]+\.r\.[a-z0-9-]+\.awstrack\.me\/I0\/[^"'\s]+)["']/i;

/** `abertura_falhas` de um email sem o pixel do SES: nada a abrir. */
export const SEM_PIXEL = -1;

/**
 * `abertura_falhas` dos emails gravados antes de o resultado se guardar
 * (db.ts): foram pedidos uma vez à chegada, e não se sabe se responderam. Não
 * se voltam a pedir — a regra é nunca abrir duas vezes; a vigilância das
 * listas (`caixa.ts`) apanha uma que fique em silêncio.
 */
export const ANTERIOR_AO_REGISTO = -2;

/** Até onde se volta atrás a tentar abrir de novo. */
export const DIAS_A_TENTAR = 7;

/** Pixéis pedidos, no máximo, por ciclo (de 5 min). O resto fica para o seguinte. */
export const MAXIMO_POR_CICLO = 80;

/** Depois de tantas falhas, desiste-se desse email (são ~1,5 dias de tentativas). */
export const MAXIMO_FALHAS = 12;

/** Espera depois da falha n: 5 min, 10, 20… até 6 h. */
export function esperaDepoisDe(falhas: number): number {
  return Math.min(5 * 60_000 * 2 ** Math.max(0, falhas - 1), 6 * 3_600_000);
}

/** O endereço do pixel de abertura do SES, ou null se o email não tiver. */
export function pixelDeAbertura(html: string): string | null {
  const m = html.match(PIXEL);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

export function marcarAberturaAtivo(): boolean {
  return process.env.MARCAR_ABERTURA !== "0";
}

export type Pedir = (url: string) => Promise<{ ok: boolean }>;

/** Por defeito: o `fetch` do Node, sem cookies, com tempo limite. */
const pedirPadrao: Pedir = (url) => fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "follow" });

/** Pede um pixel. Rede em baixo, tempo esgotado ou resposta de erro: false. */
async function pedirPixel(url: string, pedir: Pedir): Promise<boolean> {
  try {
    return (await pedir(url)).ok;
  } catch {
    return false;
  }
}

/**
 * Pede os pixéis, um a um, com tempo limite. Devolve quantos responderam.
 * `pedir` existe para os testes; por defeito é o `fetch` do Node, sem cookies.
 * Não grava nada: a recolha usa `abrirPendentes`.
 */
export async function marcarAbertos(htmls: string[], pedir: Pedir = pedirPadrao): Promise<number> {
  if (!marcarAberturaAtivo()) return 0;
  let ok = 0;
  for (const html of htmls) {
    const url = pixelDeAbertura(html);
    if (!url) continue;
    if (await pedirPixel(url, pedir)) ok++;
  }
  return ok;
}

export interface ResumoAbertura {
  /** Pixéis que responderam neste ciclo. */
  abertos: number;
  /** Pedidos que falharam neste ciclo (voltam a tentar-se mais tarde). */
  falhados: number;
}

/**
 * Abre o que está por abrir: os emails dos últimos `DIAS_A_TENTAR` dias com
 * pixel e sem abertura com sucesso, cuja espera depois da última falha já
 * passou. Os nunca tentados primeiro, os mais recentes primeiro; no máximo
 * `MAXIMO_POR_CICLO`. Grava o resultado de cada um. Nunca lança por causa da
 * rede.
 *
 * `desdeNovos`: o mais antigo dos emails acabados de gravar. Um email que só
 * agora se leu (o monitor esteve parado mais de uma semana) abre-se na mesma,
 * como antes de o resultado se guardar.
 */
export async function abrirPendentes(
  agora: Date = new Date(),
  pedir: Pedir = pedirPadrao,
  desdeNovos: Date | null = null,
): Promise<ResumoAbertura> {
  const resumo: ResumoAbertura = { abertos: 0, falhados: 0 };
  if (!marcarAberturaAtivo()) return resumo;
  const bd = db();
  const semana = new Date(agora.getTime() - DIAS_A_TENTAR * 86_400_000);
  const desde = paraIso(desdeNovos && desdeNovos < semana ? desdeNovos : semana);

  // Pelo índice parcial (db.ts): só os por abrir, sem tocar nos corpos.
  const candidatos = (
    bd
      .prepare(
        `SELECT id, abertura_falhas AS falhas, abertura_tentada_em AS tentada
           FROM emails INDEXED BY idx_emails_por_abrir
          WHERE aberto_em IS NULL AND abertura_falhas >= 0 AND recebido_em >= ?
          ORDER BY abertura_falhas ASC, recebido_em DESC`,
      )
      .all(desde) as { id: number; falhas: number; tentada: string | null }[]
  )
    .filter(
      (c) =>
        c.falhas < MAXIMO_FALHAS &&
        (!c.tentada || agora.getTime() - new Date(c.tentada).getTime() >= esperaDepoisDe(c.falhas)),
    )
    .slice(0, MAXIMO_POR_CICLO);

  const corpo = bd.prepare(`SELECT corpo_html AS html FROM emails WHERE id = ?`);
  const semPixel = bd.prepare(`UPDATE emails SET abertura_falhas = ${SEM_PIXEL} WHERE id = ? AND aberto_em IS NULL`);
  const aberto = bd.prepare(
    `UPDATE emails SET aberto_em = ?, abertura_tentada_em = ? WHERE id = ? AND aberto_em IS NULL`,
  );
  const falhou = bd.prepare(
    `UPDATE emails SET abertura_falhas = abertura_falhas + 1, abertura_tentada_em = ?
      WHERE id = ? AND aberto_em IS NULL`,
  );

  for (const c of candidatos) {
    const linha = corpo.get(c.id) as { html: string } | undefined;
    const url = linha ? pixelDeAbertura(linha.html) : null;
    if (!url) {
      semPixel.run(c.id);
      continue;
    }
    // Outro ciclo (outro processo) pode tê-lo aberto entretanto: confirmar
    // antes de pedir, para nunca abrir duas vezes.
    const ainda = bd.prepare(`SELECT aberto_em AS a FROM emails WHERE id = ?`).get(c.id) as { a: string | null };
    if (ainda.a) continue;
    if (await pedirPixel(url, pedir)) {
      const quando = paraIso(new Date());
      aberto.run(quando, quando, c.id);
      resumo.abertos++;
    } else {
      falhou.run(paraIso(new Date()), c.id);
      resumo.falhados++;
    }
  }
  return resumo;
}

/** Estado da abertura de um email, para o painel (`caixa.ts`). */
export type EstadoAbertura = "aberto" | "por-abrir" | "falhou" | "sem-pixel" | "desconhecido";

export function estadoAbertura(abertoEm: string | null, falhas: number): EstadoAbertura {
  if (abertoEm) return "aberto";
  if (falhas === SEM_PIXEL) return "sem-pixel";
  if (falhas === ANTERIOR_AO_REGISTO) return "desconhecido";
  return falhas > 0 ? "falhou" : "por-abrir";
}

/** Contagem da última semana, para o /api/estado. */
export function resumoAberturas(agora: Date = new Date()): { porAbrir: number; comFalhas: number; desistidos: number } {
  const desde = paraIso(new Date(agora.getTime() - DIAS_A_TENTAR * 86_400_000));
  const l = db()
    .prepare(
      `SELECT COUNT(*) AS porAbrir,
              COALESCE(SUM(abertura_falhas > 0), 0) AS comFalhas,
              COALESCE(SUM(abertura_falhas >= ${MAXIMO_FALHAS}), 0) AS desistidos
         FROM emails INDEXED BY idx_emails_por_abrir
        WHERE aberto_em IS NULL AND abertura_falhas >= 0 AND recebido_em >= ?`,
    )
    .get(desde) as { porAbrir: number; comFalhas: number; desistidos: number };
  return l;
}
