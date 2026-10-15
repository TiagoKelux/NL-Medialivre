/**
 * Testes de segurança: HTML de terceiros servido na origem do painel,
 * pedidos de outros sites, validação de parâmetros e o rasto das alterações.
 *   npm test
 *
 * Base de dados temporária própria: nunca toca em data/monitor.db.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pasta = mkdtempSync(join(tmpdir(), "nwl-seguranca-"));
process.env.DATABASE_PATH = join(pasta, "teste.db");
delete process.env.MONITOR_INICIO;

const { markdownParaHtml, construirFicheiro } = await import("../src/lib/markdown.ts");
const { pedidoDeOutraOrigem, limparHtmlEmail, CABECALHOS_CONTEUDO, CABECALHOS_EMAIL } = await import(
  "../src/lib/seguranca.ts"
);
const { ehData } = await import("../src/lib/periodo.ts");
const { ehFiltro } = await import("../src/lib/filtros.ts");
const { paraInstante } = await import("../src/lib/tempo.ts");
const { db, fecharDb } = await import("../src/lib/db.ts");
const regras = await import("../src/lib/regras.ts");
const rotaConteudo = await import("../src/app/api/conteudo/route.ts");
const rotaEmail = await import("../src/app/api/email/route.ts");
const rotaExportar = await import("../src/app/api/exportar/route.ts");

test.after(() => {
  fecharDb();
  rmSync(pasta, { recursive: true, force: true });
});

// ── XSS no Markdown → HTML ─────────────────────────────────────────────────

/** Nenhuma tag fora das que o conversor gera, e nenhum atributo a mais. */
function semFuga(html: string): void {
  for (const t of html.matchAll(/<([a-z0-9]+)\b([^>]*)>/gi)) {
    const nome = t[1].toLowerCase();
    assert.ok(
      ["p", "ul", "li", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "a", "img"].includes(nome),
      `tag inesperada: ${t[0]}`,
    );
    // Os atributos: só nome="valor", sem aspas soltas pelo meio.
    const atributos = t[2].trim();
    if (!atributos) continue;
    const resto = atributos.replace(/\s*[a-z-]+="[^"]*"/gi, "").trim();
    assert.equal(resto, "", `atributos partidos em ${t[0]}`);
    for (const a of atributos.matchAll(/([a-z-]+)="/gi)) {
      assert.ok(["src", "alt", "href", "target", "rel"].includes(a[1].toLowerCase()), `atributo ${a[1]} em ${t[0]}`);
    }
  }
  assert.doesNotMatch(html, /href="\s*javascript:/i);
  assert.doesNotMatch(html, /src="\s*javascript:/i);
}

test("markdownParaHtml: alt de imagem com aspas não sai do atributo", () => {
  const html = markdownParaHtml(`![x" onerror="alert(1)](https://exemplo.pt/a.png)`);
  semFuga(html);
  assert.match(html, /<img src="https:\/\/exemplo\.pt\/a\.png" alt="x&quot; onerror=&quot;alert\(1\)">/);
});

test("markdownParaHtml: imagem com URL que não é http(s) fica só texto", () => {
  for (const md of [
    `![x" onerror="alert(1)](y)`,
    `![foto](javascript:alert(1))`,
    `![foto](data:image/svg+xml,<svg/onload=alert(1)>)`,
    `![foto](//evil.example/a.png)`,
  ]) {
    const html = markdownParaHtml(md);
    semFuga(html);
    assert.doesNotMatch(html, /<img/, md);
  }
});

test("markdownParaHtml: links javascript: e afins viram texto", () => {
  for (const md of [
    "[clique](javascript:alert(document.cookie))",
    "[clique](JaVaScRiPt:alert(1))",
    "[clique](vbscript:msgbox)",
    "[clique](data:text/html,<script>alert(1)</script>)",
    "[clique](/api/ciclo)",
  ]) {
    const html = markdownParaHtml(md);
    semFuga(html);
    assert.doesNotMatch(html, /<a\b/, md);
    assert.match(html, /clique/);
  }
});

test("markdownParaHtml: URL com aspas não parte o href", () => {
  const html = markdownParaHtml(`[t](https://exemplo.pt/"onmouseover="alert(1))`);
  semFuga(html);
  assert.match(html, /<a href="https:\/\/exemplo\.pt\/[^"]*"/);
  const so = markdownParaHtml(`[t](https://exemplo.pt/'x')`);
  semFuga(so);
  assert.doesNotMatch(so, /'/);
});

test("markdownParaHtml: links http(s) continuam a funcionar", () => {
  const html = markdownParaHtml("Ler [o artigo](https://exemplo.pt/a?b=1&c=2) e ![capa](http://exemplo.pt/c.jpg)");
  assert.match(html, /<a href="https:\/\/exemplo\.pt\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">o artigo<\/a>/);
  assert.match(html, /<img src="http:\/\/exemplo\.pt\/c\.jpg" alt="capa">/);
});

test("markdownParaHtml: assunto do email com HTML e aspas fica escapado", () => {
  const md = construirFicheiro(
    {
      marca: "CM",
      nome: "Bom Dia",
      data: "2026-10-15",
      assunto: `<img src=x onerror=alert(1)> "olá" 'x' **`,
      remetente: "x",
      horaRecebida: "09:00",
      codigo: 1,
      estado: "Saiu",
      detalhe: "",
    },
    "<p>corpo</p>",
  );
  const html = markdownParaHtml(md.replace(/^---[\s\S]*?\n---\n/, ""));
  semFuga(html);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &quot;olá&quot; &#39;x&#39;/);
});

// ── /api/conteudo e /api/email ─────────────────────────────────────────────

let seq = 0;
function gravarEmail(newsletterId: string | null, assunto: string, html: string, quando: Date): number {
  const r = db()
    .prepare(
      `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html, newsletter_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(`s${++seq}@teste`, "Correio da Manhã Bom dia <info@news.correiodamanha.pt>", assunto, quando.toISOString(), html, newsletterId);
  return Number(r.lastInsertRowid);
}

test("/api/conteudo: CSP sem scripts e nosniff, e o assunto não injeta HTML", () => {
  gravarEmail(
    "cm-bom-dia",
    `"><script>alert(1)</script>`,
    `<p><a href="javascript:alert(1)">Uma manchete longa o suficiente para contar</a></p>` +
      `<img alt='x" onerror="alert(1)' src="https://exemplo.pt/i.png">`,
    paraInstante("2026-10-15", "10:00"),
  );
  const r = rotaConteudo.GET(new Request("http://localhost/api/conteudo?newsletter=cm-bom-dia&data=2026-10-15"));
  assert.equal(r.status, 200);
  const csp = r.headers.get("content-security-policy") ?? "";
  assert.equal(csp, CABECALHOS_CONTEUDO["Content-Security-Policy"]);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /script-src/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  return r.text().then((corpo) => {
    assert.doesNotMatch(corpo, /<script/i);
    assert.doesNotMatch(corpo, /href="javascript:/i);
    // O onerror fica preso dentro do alt, como texto.
    assert.doesNotMatch(corpo, /"\s*onerror=/i);
    assert.match(corpo, /alt="x&quot; onerror=&quot;alert\(1\)"/);
  });
});

test("limparHtmlEmail: tira meta refresh e base, deixa o resto", () => {
  const casos = [
    `<meta http-equiv="refresh" content="0;url=https://mau.example">`,
    `<META HTTP-EQUIV=Refresh CONTENT="0; URL=https://mau.example">`,
    `<meta content="0;url=https://mau.example/a>b" http-equiv='refresh'>`,
    `<meta/http-equiv="&#114;efresh" content="0;url=https://mau.example">`,
    `<base href="https://mau.example/">`,
    `<BASE target=_top href=//mau.example>`,
    `<me<base href="x">ta http-equiv="refresh" content="0">`,
  ];
  for (const c of casos) {
    const limpo = limparHtmlEmail(`<html><head>${c}<meta charset="utf-8"></head><body><p>Olá</p></body></html>`);
    assert.doesNotMatch(limpo, /http-equiv/i, c);
    assert.doesNotMatch(limpo, /<base/i, c);
    assert.match(limpo, /<meta charset="utf-8">/);
    assert.match(limpo, /<p>Olá<\/p>/);
  }
});

test("/api/email: serve o HTML limpo, com sandbox sem scripts e sem formulários", async () => {
  const id = gravarEmail(
    null,
    "teste",
    `<head><meta http-equiv="refresh" content="0;url=https://mau.example"><base href="https://mau.example/"></head><p>corpo</p>`,
    paraInstante("2026-10-14", "10:00"),
  );
  const r = rotaEmail.GET(new Request(`http://localhost/api/email?id=${id}`));
  assert.equal(r.status, 200);
  const corpo = await r.text();
  assert.doesNotMatch(corpo, /refresh|<base/i);
  assert.match(corpo, /<p>corpo<\/p>/);
  const csp = r.headers.get("content-security-policy") ?? "";
  assert.equal(csp, CABECALHOS_EMAIL["Content-Security-Policy"]);
  assert.match(csp, /^sandbox /);
  assert.doesNotMatch(csp, /allow-scripts|allow-same-origin/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /base-uri 'none'/);
});

// ── CSRF ───────────────────────────────────────────────────────────────────

test("pedidoDeOutraOrigem: recusa POST de outro site, deixa passar o próprio e o interno", () => {
  const host = "34-1-2-3.sslip.io";
  const p = (metodo: string, origin: string | null, secFetchSite: string | null, h: string | null = host) =>
    pedidoDeOutraOrigem({ metodo, host: h, origin, secFetchSite });

  // O painel a falar com ele próprio.
  assert.equal(p("POST", `https://${host}`, "same-origin"), false);
  assert.equal(p("POST", null, "same-origin"), false);
  assert.equal(p("POST", `https://${host}`, null), false);
  // Barra de endereços / marcador.
  assert.equal(p("POST", null, "none"), false);
  // O fetch interno do instrumentation.ts (sem Origin nem Sec-Fetch-Site).
  assert.equal(p("POST", null, null, "127.0.0.1:3001"), false);

  // Outro site, seja qual for o cabeçalho que o denuncia.
  assert.equal(p("POST", "https://mau.example", "cross-site"), true);
  assert.equal(p("POST", null, "cross-site"), true);
  assert.equal(p("POST", null, "same-site"), true);
  assert.equal(p("POST", "https://mau.example", null), true);
  assert.equal(p("POST", `https://${host}.mau.example`, null), true);
  assert.equal(p("POST", `https://${host}:8443`, null), true);
  // Iframe com sandbox (o próprio /api/email) manda Origin: null.
  assert.equal(p("POST", "null", null), true);
  // Origin a bater certo mas Sec-Fetch-Site a dizer que não.
  assert.equal(p("POST", `https://${host}`, "cross-site"), true);
  // Origin presente mas sem Host para comparar.
  assert.equal(p("POST", `https://${host}`, null, null), true);
  // Outros métodos que mudam coisas também.
  for (const m of ["PUT", "PATCH", "DELETE", "post"]) assert.equal(p(m, "https://mau.example", "cross-site"), true);

  // GET e HEAD passam sempre (não mudam nada).
  assert.equal(p("GET", "https://mau.example", "cross-site"), false);
  assert.equal(p("HEAD", "https://mau.example", "cross-site"), false);
});

// ── /api/exportar ──────────────────────────────────────────────────────────

test("ehData e ehFiltro: só datas que existem e filtros conhecidos", () => {
  assert.equal(ehData("2026-10-15"), true);
  assert.equal(ehData("2024-02-29"), true);
  for (const m of ["2026-02-30", "2026-13-01", "2026-00-10", "20261015", "2026-10-15x", "abc", "0000-01-01", null, 5]) {
    assert.equal(ehData(m), false, String(m));
  }
  for (const f of ["todas", "diaria", "dias_uteis", "dia_mes", "nao_agendada", "dia:1", "dia:7"]) assert.equal(ehFiltro(f), true, f);
  for (const f of ["dia:8", "dia:0", "x", "", "<script>"]) assert.equal(ehFiltro(f), false, f);
});

test("/api/exportar: data inválida volta a hoje, filtro desconhecido dá 400, nunca 500", () => {
  const exp = (q: string) => rotaExportar.GET(new Request(`http://localhost/api/exportar?${q}`));
  for (const q of ["ate=2026-02-31", "ate=lixo", "ate=9999-99-99&vista=diaria", "ate=", "vista=semanal&ate=2026-13-45"]) {
    const r = exp(q);
    assert.equal(r.status, 200, q);
    assert.match(r.headers.get("content-type") ?? "", /spreadsheetml/);
  }
  assert.equal(exp("filtro=nao-existe").status, 400);
  assert.equal(exp("filtro=dia:1&ate=2026-10-15").status, 200);
});

// ── Rasto das alterações ───────────────────────────────────────────────────

test("removerExclusao: se o registo da alteração falhar, a exclusão fica", () => {
  const bd = db();
  const id = Number(
    bd
      .prepare(`INSERT INTO exclusoes (tipo, valor, rotulo, criado_em) VALUES ('assunto', 'promo', 'Promo', ?)`)
      .run(new Date().toISOString()).lastInsertRowid,
  );
  bd.exec(`CREATE TEMP TRIGGER falhar_alteracao BEFORE INSERT ON alteracoes BEGIN SELECT RAISE(ABORT, 'falha simulada'); END;`);
  try {
    assert.throws(() => regras.removerExclusao(id, "teste"), /falha simulada/);
  } finally {
    bd.exec(`DROP TRIGGER falhar_alteracao`);
  }
  assert.ok(bd.prepare(`SELECT 1 FROM exclusoes WHERE id = ?`).get(id), "a exclusão não pode ter sido apagada");

  // Sem falha: apaga e deixa rasto.
  const antes = (bd.prepare(`SELECT COUNT(*) AS n FROM alteracoes`).get() as { n: number }).n;
  assert.equal(regras.removerExclusao(id, "teste").ok, true);
  assert.equal(bd.prepare(`SELECT 1 FROM exclusoes WHERE id = ?`).get(id), undefined);
  assert.equal((bd.prepare(`SELECT COUNT(*) AS n FROM alteracoes`).get() as { n: number }).n, antes + 1);
});
