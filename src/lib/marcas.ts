import { createHash } from "node:crypto";
import { db } from "./db.ts";
import { NEWSLETTERS } from "../../config/newsletters.ts";
import type { Newsletter } from "./tipos.ts";
import { removerBlocos, removerEtiquetas } from "./conteudo.ts";

/**
 * As marcas de um email: o que a identificação precisa de saber do corpo,
 * extraído UMA vez, à entrada, e guardado em `emails.marcas`.
 *
 * Sem isto, a reclassificação de 5 em 5 minutos lia o `corpo_html` de todos
 * os emails guardados (~70 KB cada) só para procurar meia dúzia de textos — e
 * o custo crescia com o histórico, sem limite.
 *
 * O resultado depende da configuração (as `marcaCorpo` procuradas). A versão
 * `v` é a impressão digital dessa lista: se alguém acrescentar ou mudar uma
 * marca em config/newsletters.ts, as marcas guardadas ficam desatualizadas e
 * voltam a ser extraídas do corpo — uma vez — na reclassificação seguinte.
 * Assim o resultado é sempre o mesmo que procurar diretamente no HTML.
 */
export interface Marcas {
  /** Impressão digital do extrator e das `marcaCorpo` configuradas. */
  v: string;
  /** As `marcaCorpo` configuradas (já normalizadas) que o corpo traz. */
  m: string[];
  /**
   * Traz o bloco de publicidade de uma edição,
   * `/4196/<MARCA>_MASTHEAD/NEWSLETTER_<NOME>_LEADERBOARD`, de qualquer marca.
   */
  pub: boolean;
  /**
   * Imagens servidas por assets.unlayer.com — o editor das campanhas de CRM
   * (boas-vindas, reconquista). Nenhuma edição as usa.
   */
  crm: number;
  /** Comprimento do texto visível (sem etiquetas, entidades contam 1). */
  txt: number;
  /** O envio do Echobox, lido do token "ver no browser" (`lerEnvio`); null sem token. */
  eb: Envio | null;
}

/**
 * O que o token "ver no browser" do Echobox diz de um email. Todas as edições
 * de 29/09 a 15/10 (119 de 119, de todas as marcas) o trazem; o marketing do
 * editor (boas-vindas, reconquista) quase nunca. O token é um JWT assinado
 * pelo Echobox; só se lê o conteúdo, não se valida a assinatura — não é
 * preciso: serve para comparar emails entre si, e quem o forjasse estaria a
 * enganar-se a si próprio.
 *
 * - campanha: uma por newsletter (25 newsletters, 25 campanhas, nenhuma
 *   partilhada; as promoções "Indica" e as reconquistas têm as suas);
 * - envio: um por envio da campanha — duas edições no mesmo dia com envios
 *   diferentes são dois envios para os leitores (Máxima 02/10, 09:03 e 09:33);
 * - destino: o endereço para onde foi.
 */
export interface Envio {
  campanha: string;
  envio: string;
  destino: string;
}

/** Sobe quando o extrator muda: obriga a extrair tudo outra vez. */
const VERSAO_EXTRATOR = "2";

/**
 * O HTML traz o mesmo endereço do anúncio umas vezes com "/" e outras com
 * "%2F" (dentro de URLs de clique). Põe-se tudo com "/" antes de procurar.
 */
export function normalizarHtml(html: string): string {
  return html.replace(/%2F/gi, "/").toLowerCase();
}

/** As marcas de corpo configuradas, normalizadas, sem repetições, por ordem. */
function marcasConfiguradas(newsletters: Newsletter[]): string[] {
  // As regras do painel (`alternativas`) também contam: sem elas, os emails
  // guardados não saberiam se trazem uma marca acrescentada depois.
  const todas = newsletters
    .flatMap((n) => [n.marcaCorpo, ...(n.alternativas ?? []).map((a) => a.marcaCorpo)])
    .map((m) => m.trim())
    .filter((m) => m !== "");
  return [...new Set(todas.map(normalizarHtml))].sort();
}

/**
 * Pelo CONTEÚDO da lista de marcas, não pelo array: as regras do painel
 * (`aplicarNaConfig`) mudam os objetos da configuração no mesmo array. Com a
 * cache pelo array, a impressão digital não mudava depois de uma regra com
 * marca nova, e as marcas guardadas antes dela passavam por atuais — sem a
 * marca nova, os emails antigos nunca eram reconhecidos. Chamada uma vez por
 * email na reclassificação: o custo é juntar ~60 textos, não um hash.
 */
const versoes = new Map<string, string>();

/** Impressão digital da lista de marcas — muda quando a configuração muda. */
export function versaoMarcas(newsletters: Newsletter[] = NEWSLETTERS): string {
  const chave = `${VERSAO_EXTRATOR}\n${marcasConfiguradas(newsletters).join("\n")}`;
  let v = versoes.get(chave);
  if (!v) {
    v = createHash("sha1").update(chave).digest("hex").slice(0, 12);
    versoes.set(chave, v);
  }
  return v;
}

const PUBLICIDADE_EDICAO = /\/4196\/[a-z0-9_]+_masthead\/newsletter_[a-z0-9_]+_leaderboard/;

/** Texto visível: sem cabeça, estilos e scripts, sem etiquetas, espaços colapsados. */
export function comprimentoTexto(html: string): number {
  // Igual a tirar /<(style|script|head)\b[\s\S]*?<\/\1>/gi e /<[^>]+>/g, em
  // tempo linear com HTML mal fechado (conteudo.ts).
  return removerEtiquetas(removerBlocos(html, ["style", "script", "head"], " "), " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, "x")
    .replace(/\s+/g, " ")
    .trim().length;
}

const TOKEN_ECHOBOX = /viewinbrowser(?:\?|%3f)token(?:=|%3d)[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\./i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O envio do Echobox que o email traz, ou null se não trouxer um token legível. */
export function lerEnvio(html: string): Envio | null {
  const m = html.match(TOKEN_ECHOBOX);
  if (!m) return null;
  try {
    const p = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const [campanha, envio] = String(p["custom:key"] ?? "").split("/");
    const destino = typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
    if (!UUID.test(campanha ?? "") || !UUID.test(envio ?? "") || !destino) return null;
    return { campanha: campanha.toLowerCase(), envio: envio.toLowerCase(), destino };
  } catch {
    return null;
  }
}

export function extrairMarcas(html: string, newsletters: Newsletter[] = NEWSLETTERS): Marcas {
  const corpo = normalizarHtml(html);
  return {
    v: versaoMarcas(newsletters),
    m: marcasConfiguradas(newsletters).filter((m) => corpo.includes(m)),
    pub: PUBLICIDADE_EDICAO.test(corpo),
    crm: (corpo.match(/assets\.unlayer\.com\//g) ?? []).length,
    txt: comprimentoTexto(html),
    eb: lerEnvio(html),
  };
}

/** As marcas guardadas, se forem da versão atual; null se faltarem ou estiverem velhas. */
export function lerMarcas(json: string | null | undefined, newsletters: Newsletter[] = NEWSLETTERS): Marcas | null {
  if (!json) return null;
  try {
    const m = JSON.parse(json) as Marcas;
    return m && m.v === versaoMarcas(newsletters) && Array.isArray(m.m) ? m : null;
  } catch {
    return null;
  }
}

/**
 * As marcas de um email guardado. Usa a coluna quando está atual; senão lê o
 * corpo (só desse email), extrai e grava — da próxima vez já não lê.
 */
export function marcasDoEmail(id: number, json: string | null | undefined): Marcas {
  const atuais = lerMarcas(json);
  if (atuais) return atuais;
  const bd = db();
  const linha = bd.prepare(`SELECT corpo_html FROM emails WHERE id = ?`).get(id) as
    | { corpo_html: string }
    | undefined;
  const m = extrairMarcas(linha?.corpo_html ?? "");
  bd.prepare(`UPDATE emails SET marcas = ? WHERE id = ?`).run(JSON.stringify(m), id);
  return m;
}

/**
 * Preenche as marcas que faltam ou estão desatualizadas. Idempotente: com
 * tudo em dia é uma consulta que não devolve nada. Corre no arranque e no
 * início de cada reclassificação. Devolve quantos emails atualizou.
 */
export function garantirMarcas(): number {
  const bd = db();
  const v = versaoMarcas();
  const ids = bd
    .prepare(
      `SELECT id FROM emails INDEXED BY idx_emails_identificacao
        WHERE marcas IS NULL OR json_valid(marcas) = 0 OR json_extract(marcas, '$.v') IS NOT ?`,
    )
    .all(v) as { id: number }[];
  if (ids.length === 0) return 0;
  const ler = bd.prepare(`SELECT corpo_html FROM emails WHERE id = ?`);
  const gravar = bd.prepare(`UPDATE emails SET marcas = ? WHERE id = ?`);
  bd.transaction(() => {
    for (const { id } of ids) {
      const { corpo_html } = ler.get(id) as { corpo_html: string };
      gravar.run(JSON.stringify(extrairMarcas(corpo_html)), id);
    }
  })();
  return ids.length;
}

// ── Campanhas do Echobox ───────────────────────────────────────────────────

/** Que newsletter manda cada campanha, aprendido das edições já atribuídas. */
export interface Campanhas {
  /** campanha → newsletter (só as campanhas de uma newsletter só). */
  dona: Map<string, string>;
  /** newsletter → as suas campanhas. */
  daNewsletter: Map<string, Set<string>>;
}

let campanhasEmCache: { em: number; valor: Campanhas } | null = null;
const VALIDADE_CAMPANHAS_MS = 60_000;

/** Esquecer as campanhas aprendidas: chamado quando os emails ou a atribuição mudam. */
export function esquecerCampanhas(): void {
  campanhasEmCache = null;
}

/**
 * As campanhas de cada newsletter, aprendidas das edições que a `marcaCorpo`
 * já atribuiu — nunca escritas à mão. Uma campanha vista em duas newsletters
 * não serve de prova para nenhuma e fica de fora.
 */
export function lerCampanhas(): Campanhas {
  const agora = Date.now();
  if (campanhasEmCache && agora - campanhasEmCache.em < VALIDADE_CAMPANHAS_MS) return campanhasEmCache.valor;
  const linhas = db()
    .prepare(
      `SELECT DISTINCT newsletter_id AS n, json_extract(marcas, '$.eb.campanha') AS c
         FROM emails INDEXED BY idx_emails_identificacao
        WHERE newsletter_id IS NOT NULL AND json_extract(marcas, '$.v') = ?
          AND json_extract(marcas, '$.eb.campanha') IS NOT NULL`,
    )
    .all(versaoMarcas()) as { n: string; c: string }[];
  const donos = new Map<string, Set<string>>();
  for (const l of linhas) donos.set(l.c, (donos.get(l.c) ?? new Set()).add(l.n));
  const valor: Campanhas = { dona: new Map(), daNewsletter: new Map() };
  for (const [c, ns] of donos) {
    if (ns.size !== 1) continue;
    const n = [...ns][0];
    valor.dona.set(c, n);
    valor.daNewsletter.set(n, (valor.daNewsletter.get(n) ?? new Set()).add(c));
  }
  campanhasEmCache = { em: agora, valor };
  return valor;
}
