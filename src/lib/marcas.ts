import { createHash } from "node:crypto";
import { db } from "./db.ts";
import { NEWSLETTERS } from "../../config/newsletters.ts";
import type { Newsletter } from "./tipos.ts";

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
}

/** Sobe quando o extrator muda: obriga a extrair tudo outra vez. */
const VERSAO_EXTRATOR = "1";

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
 * Por lista: a configuração não se altera em memória (mudá-la é editar o
 * ficheiro e recarregar o módulo, que dá uma lista nova). Chamada uma vez por
 * email na reclassificação, por isso não pode custar um hash de cada vez.
 */
const versoes = new WeakMap<Newsletter[], string>();

/** Impressão digital da lista de marcas — muda quando a configuração muda. */
export function versaoMarcas(newsletters: Newsletter[] = NEWSLETTERS): string {
  let v = versoes.get(newsletters);
  if (!v) {
    const chave = `${VERSAO_EXTRATOR}\n${marcasConfiguradas(newsletters).join("\n")}`;
    v = createHash("sha1").update(chave).digest("hex").slice(0, 12);
    versoes.set(newsletters, v);
  }
  return v;
}

const PUBLICIDADE_EDICAO = /\/4196\/[a-z0-9_]+_masthead\/newsletter_[a-z0-9_]+_leaderboard/;

/** Texto visível: sem cabeça, estilos e scripts, sem etiquetas, espaços colapsados. */
export function comprimentoTexto(html: string): number {
  return html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, "x")
    .replace(/\s+/g, " ")
    .trim().length;
}

export function extrairMarcas(html: string, newsletters: Newsletter[] = NEWSLETTERS): Marcas {
  const corpo = normalizarHtml(html);
  return {
    v: versaoMarcas(newsletters),
    m: marcasConfiguradas(newsletters).filter((m) => corpo.includes(m)),
    pub: PUBLICIDADE_EDICAO.test(corpo),
    crm: (corpo.match(/assets\.unlayer\.com\//g) ?? []).length,
    txt: comprimentoTexto(html),
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
