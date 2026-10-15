/**
 * Peças de segurança partilhadas pelas rotas e pelo middleware.
 *
 * Sem imports: o middleware corre no runtime Edge, onde módulos de Node
 * (SQLite, fs, …) não existem. Tudo aqui é função pura.
 */

// ── Cabeçalhos das páginas com conteúdo de terceiros ───────────────────────

/**
 * /api/conteudo: o corpo e o assunto vêm de terceiros e a página é servida na
 * origem do painel. Sem scripts nenhuns, sem formulários, sem `<base>`, e
 * ninguém a pode emoldurar. O markdownParaHtml já escapa tudo — isto é a
 * segunda linha.
 */
export const CABECALHOS_CONTEUDO: Readonly<Record<string, string>> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};

/**
 * /api/email: o HTML tal como chegou, numa caixa de areia (`sandbox` sem
 * `allow-scripts` nem `allow-same-origin`: sem código e com origem opaca).
 */
export const CABECALHOS_EMAIL: Readonly<Record<string, string>> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src * data:; style-src 'unsafe-inline' *; font-src *; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

/** Uma tag inteira, respeitando atributos entre aspas que tenham `>` lá dentro. */
const tag = (nome: string) => new RegExp(`<${nome}\\b(?:[^>"']|"[^"]*"|'[^']*')*>?`, "gi");
const META = tag("meta");
const BASE = tag("base");
/**
 * Qualquer `http-equiv`, não só o "refresh": o valor pode vir com entidades
 * (`&#114;efresh`) e o browser descodifica-as. O cabeçalho da resposta já
 * define o charset, por isso tirar um `content-type` não estraga nada.
 */
const HTTP_EQUIV = /[\s/"']http-equiv\s*=/i;

/**
 * Tira do HTML de um email o que mexe na navegação mesmo sem scripts: o
 * `<meta http-equiv="refresh">` (redireciona sozinho) — e com ele qualquer
 * outro `<meta http-equiv>` — e o `<base>` (muda para
 * onde apontam os links relativos). Repete até estabilizar, para que tirar uma
 * tag não junte os pedaços de outra.
 */
export function limparHtmlEmail(html: string): string {
  let atual = html;
  for (let i = 0; i < 20; i++) {
    const seguinte = atual
      .replace(META, (t) => (HTTP_EQUIV.test(t) ? "" : t))
      .replace(BASE, "");
    if (seguinte === atual) return atual;
    atual = seguinte;
  }
  return atual;
}

// ── Pedidos de outros sites (CSRF) ─────────────────────────────────────────

export interface CabecalhosOrigem {
  metodo: string;
  /** O `Host` do pedido, tal como chegou (com porta, se houver). */
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
}

/**
 * Um pedido que muda coisas (tudo menos GET/HEAD) só passa se vier da
 * própria origem. Os browsers dizem-no em `Sec-Fetch-Site` e em `Origin`;
 * qualquer um deles a apontar para fora chega para recusar. Sem nenhum dos
 * dois (o `fetch` interno do instrumentation.ts, curl no servidor) passa: um
 * browser moderno manda sempre pelo menos um num POST de outro site.
 */
export function pedidoDeOutraOrigem(p: CabecalhosOrigem): boolean {
  const metodo = p.metodo.toUpperCase();
  if (metodo === "GET" || metodo === "HEAD") return false;

  if (p.secFetchSite !== null) {
    const s = p.secFetchSite.trim().toLowerCase();
    if (s !== "same-origin" && s !== "none") return true;
  }

  if (p.origin !== null) {
    let hostOrigem: string;
    try {
      // `Origin: null` (iframe com sandbox, redirecionamentos) não é um URL.
      hostOrigem = new URL(p.origin).host.toLowerCase();
    } catch {
      return true;
    }
    if (!p.host || hostOrigem !== p.host.trim().toLowerCase()) return true;
  }

  return false;
}
