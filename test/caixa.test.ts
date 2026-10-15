/**
 * Testes do marketing reconhecido pela estrutura, das marcas guardadas à
 * entrada e do sinal de caixa cortada.
 *   npm test
 *
 * Base de dados temporária própria: nunca toca em data/monitor.db.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pasta = mkdtempSync(join(tmpdir(), "nwl-caixa-"));
process.env.DATABASE_PATH = join(pasta, "teste.db");
delete process.env.MONITOR_INICIO;
delete process.env.HEALTHCHECK_URL;

const { corresponder, eNaoEdicaoDoEditor } = await import("../src/lib/correspondencia.ts");
const marcas = await import("../src/lib/marcas.ts");
const prova = await import("../src/lib/prova.ts");
const { reclassificar } = await import("../src/lib/recolha.ts");
const { saudeCaixa } = await import("../src/lib/caixa.ts");
const { vigiarCaixa } = await import("../src/lib/vigia.ts");
const leitura = await import("../src/lib/leitura.ts");
const { newsletterPorId, NEWSLETTERS } = await import("../config/newsletters.ts");
const { processarCorpo } = await import("../src/lib/conteudo.ts");
const { paraInstante } = await import("../src/lib/tempo.ts");
const { db, fecharDb } = await import("../src/lib/db.ts");

const lisboa = (data: string, hora: string) => paraInstante(data, hora);
const nl = (id: string) => {
  const n = newsletterPorId(id);
  assert.ok(n, id);
  return n;
};

test.after(() => {
  fecharDb();
  rmSync(pasta, { recursive: true, force: true });
});

// ── Moldes, com a estrutura dos emails reais ───────────────────────────────

/** O bloco de publicidade de cada edição. */
const anuncio = (marca: string, nome: string, barra = "/") =>
  `<a href="https://pubads.g.doubleclick.net/gampad/jump?iu=/4196/${marca}_MASTHEAD${barra}NEWSLETTER_${nome}_LEADERBOARD">` +
  `<img src="https://securepubads.g.doubleclick.net/gampad/ad?iu=/4196/${marca}_MASTHEAD${barra}NEWSLETTER_${nome}_LEADERBOARD"></a>`;
const artigos = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    `<h2><a href="https://www.exemplo.pt/artigo-${i}">Manchete número ${i} com texto suficiente</a></h2>` +
    `<p>${"Parágrafo da notícia com conteúdo editorial do dia. ".repeat(3)}</p>`,
  ).join("");
const edicao = (marca: string, nome: string) => `<html><body>${anuncio(marca, nome)}${artigos(12)}</body></html>`;
const VIDAS = `<html><body><img src="https://www.cmjornal.pt/i/newsletters/logo.png" alt="Vidas">${artigos(10)}</body></html>`;
/** Campanha de CRM (editor unlayer): logótipo, 2–3 blocos com CTA, rodapé. */
const crm = (frase: string, blocos = 3) =>
  `<html><head><style>.u-row{width:600px}</style></head><body>` +
  `<img src="https://assets.unlayer.com/projects/88242/1754663928692-new_logo.png">` +
  `<p>${frase}</p>` +
  Array.from({ length: blocos }, (_, i) =>
    `<img src="https://assets.unlayer.com/projects/88242/17${i}-bloco.jpg"><h3>Secção ${i}</h3>` +
    `<p>Descubra os conte&uacute;dos que fazem a diferen&ccedil;a.</p><a href="https://x.pt/${i}">Seguir Canal</a>`,
  ).join("") +
  `<p>Est&aacute; a receber este e-mail porque subscreveu esta newsletter. ` +
  `<a href="https://x.pt/remover">remover subscri&ccedil;&atilde;o</a>.</p></body></html>`;
/** Comércio afiliado ("FLASH! Indica"): sem bloco de edição, sem o editor de campanhas. */
const INDICA = `<html><body><img src="https://cdn.flash.pt/produto.jpg">${artigos(4)}</body></html>`;

// ── 1. Marketing do editor, pela estrutura ─────────────────────────────────

test("campanha de CRM do endereço das edições é marketing, seja qual for o assunto", () => {
  for (const de of [
    "Correio da Manhã Bom dia <info@news.correiodamanha.pt>",
    "Record Premium <info@news.jornalrecord.pt>",
    "FLASH! Mundo <info@news.flash.pt>",
    "Máxima <info@news.maxima.pt>",
    "Jornal de Negócios Opinião do dia <info@news.jornaldenegocios.pt>",
  ]) {
    assert.ok(eNaoEdicaoDoEditor(crm("Uma frase que nenhuma lista conhece."), de), de);
  }
});

test("nenhuma edição passa por marketing (0 falsos positivos)", () => {
  const casos: [string, string][] = [
    ["Correio da Manhã Bom dia <info@news.correiodamanha.pt>", edicao("CORREIODAMANHA", "BOMDIA")],
    ["Record Geral <info@news.jornalrecord.pt>", edicao("RECORD", "GERAL")],
    ["FLASH! Mundo <info@news.flash.pt>", edicao("FLASH", "MUNDO").replace(/\//g, "%2F")],
    ["Máxima <info@news.maxima.pt>", edicao("MAXIMA", "GERAL")],
    // Vidas não traz o bloco de publicidade: é a marca própria que a separa.
    ["Vidas Geral <info@news.correiodamanha.pt>", VIDAS],
    // Uma edição que um dia traga uma imagem do editor de campanhas continua edição.
    ["Record Geral <info@news.jornalrecord.pt>",
      edicao("RECORD", "GERAL").replace("<body>", '<body><img src="https://assets.unlayer.com/x.png">')],
  ];
  for (const [de, html] of casos) {
    assert.equal(eNaoEdicaoDoEditor(html, de), false, de);
    assert.ok(corresponder(de, "Manchete do dia", html), `continua a ser atribuída: ${de}`);
  }
});

test("fora do âmbito do classificador: outros endereços, promoções e textos longos", () => {
  // Endereço que não é de nenhuma edição configurada.
  assert.equal(eNaoEdicaoDoEditor(crm("x"), "Record Premium <info@assinaturas.jornalrecord.pt>"), false);
  assert.equal(eNaoEdicaoDoEditor(crm("x"), "Google <no-reply@accounts.google.com>"), false);
  // Comércio afiliado: não é campanha de CRM.
  assert.equal(eNaoEdicaoDoEditor(INDICA, "FLASH! Indica <info@news.flash.pt>"), false);
  // Texto comprido já não é campanha de CRM.
  assert.equal(eNaoEdicaoDoEditor(crm("x", 40), "FLASH! Mundo <info@news.flash.pt>"), false);
});

test("reconquista: estrutura ou assunto conhecido; boas-vindas não contam", () => {
  const de = "Record Premium <info@news.jornalrecord.pt>";
  const m = (html: string) => marcas.extrairMarcas(html);
  assert.ok(prova.eReconquista(de, "As grandes histórias do desporto continuam a acontecer", m(crm("x"))));
  assert.ok(prova.eReconquista(de, "Uma redação nova, nunca vista", m(crm("x"))));
  assert.ok(!prova.eReconquista(de, "Bem-vindo(a) à Record Geral", m(crm("x"))));
  // O assunto antigo continua a valer, mesmo que o molde mude.
  assert.ok(prova.eReconquista(de, "Queremos garantir que continua connosco", m(INDICA)));
  assert.ok(!prova.eReconquista(de, "Manchete", m(edicao("RECORD", "GERAL"))));
});

let seq = 0;
const gravar = (remetente: string, assunto: string, quando: Date, nid: string | null, html: string) => {
  const c = processarCorpo(html);
  const r = db()
    .prepare(
      `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html,
         corpo_normalizado, hash_conteudo, newsletter_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(`c${++seq}@teste`, remetente, assunto, quando.toISOString(), html, c.normalizado, `${c.hash}${seq}`, nid);
  return Number(r.lastInsertRowid);
};

test("reconquista com redação nova trava o 'Não Saiu'; promoção não", () => {
  const dia = "2026-10-20";
  const limite = lisboa(dia, "10:00");
  gravar("Record Premium <info@news.jornalrecord.pt>", "O desporto sem si não é o mesmo",
    lisboa("2026-10-12", "10:00"), null, crm("Volte a acompanhar."));
  const motivos = prova.motivosSemProva(nl("record-geral"), dia, limite);
  assert.ok(motivos.some((m) => /reconquista.*O desporto sem si/.test(m)), motivos.join(" | "));

  gravar("FLASH! Indica <info@news.flash.pt>", "Os ténis mais desejados", lisboa("2026-10-12", "19:00"), null, INDICA);
  const flash = prova.motivosSemProva(nl("flash-mundo"), dia, lisboa(dia, "10:00"));
  assert.ok(!flash.some((m) => /reconquista/.test(m)), flash.join(" | "));
});

test("campanha de CRM por atribuir na janela não conta como 'pode ser dela'", () => {
  const geral = nl("record-geral");
  const de = "Record Premium <info@news.jornalrecord.pt>";
  assert.ok(prova.podeSerDe(geral, de, "Uma redação nova"), "sem marcas: o endereço chega");
  assert.ok(!prova.podeSerDe(geral, de, "Uma redação nova", marcas.extrairMarcas(crm("x"))));
  assert.ok(prova.podeSerDe(geral, de, "Uma redação nova", marcas.extrairMarcas(INDICA)));
});

// ── 3. Marcas guardadas à entrada ──────────────────────────────────────────

test("o matcher dá o mesmo resultado com o HTML e com as marcas", () => {
  const casos: [string, string][] = [
    ["Correio da Manhã Exclusivos <info@news.correiodamanha.pt>", edicao("CORREIODAMANHA", "EXCLUSIVOS")],
    ["Correio da Manhã Boa tarde <info@news.correiodamanha.pt>", edicao("CORREIODAMANHA", "BOATARDE").replace(/\//g, "%2F")],
    ["Vidas Geral <info@news.correiodamanha.pt>", VIDAS],
    ["Máxima <info@news.maxima.pt>", edicao("MAXIMA", "FIM_DE_SEMANA")],
    ["Máxima <info@news.maxima.pt>", edicao("RECORD", "GERAL")],
    ["FLASH! Bom dia <info@news.flash.pt>", edicao("CORREIODAMANHA", "BOMDIA")],
    ["FLASH! Mundo <info@news.flash.pt>", crm("x")],
    ["FLASH! Indica <info@news.flash.pt>", INDICA],
    ["Negócios Premium - MUST <info@assinaturas.jornaldenegocios.pt>",
      '<img src="https://www.must.jornaldenegocios.pt/i/newsletters/logo.png">'],
  ];
  for (const [de, html] of casos) {
    assert.equal(
      corresponder(de, "x", marcas.extrairMarcas(html))?.id ?? null,
      corresponder(de, "x", html)?.id ?? null,
      de,
    );
  }
});

test("marcas de outra configuração não se usam às escondidas", () => {
  const velhas = { ...marcas.extrairMarcas(VIDAS), v: "outra" };
  assert.throws(() => corresponder("Vidas Geral <info@news.correiodamanha.pt>", "x", velhas));
  assert.equal(marcas.lerMarcas(JSON.stringify(velhas)), null);
  // Outra lista de newsletters (outra configuração) dá outra versão.
  assert.notEqual(marcas.versaoMarcas(NEWSLETTERS.slice(0, 3)), marcas.versaoMarcas());
});

test("backfill idempotente e reclassificação sem ler o corpo", () => {
  const bd = db();
  const id = gravar("Record Geral <info@news.jornalrecord.pt>", "Manchete", lisboa("2026-10-21", "09:00"), null, edicao("RECORD", "GERAL"));
  const velho = gravar("Vidas Geral <info@news.correiodamanha.pt>", "Vidas", lisboa("2026-10-21", "10:00"), null, VIDAS);
  bd.prepare(`UPDATE emails SET marcas = ? WHERE id = ?`).run(JSON.stringify({ v: "velha", m: [] }), velho);

  // Primeira passagem: preenche as que faltam e as desatualizadas.
  assert.ok(marcas.garantirMarcas() >= 2);
  assert.equal(marcas.garantirMarcas(), 0, "segunda passagem não faz nada");
  const m = marcas.lerMarcas((bd.prepare(`SELECT marcas FROM emails WHERE id = ?`).get(velho) as { marcas: string }).marcas);
  assert.deepEqual(m?.m, ["www.cmjornal.pt/i/newsletters/logo.png"]);

  // Com as marcas guardadas, apagar o corpo não muda a identificação: a
  // reclassificação não o lê.
  bd.prepare(`UPDATE emails SET corpo_html = '' WHERE id IN (?, ?)`).run(id, velho);
  reclassificar();
  const nid = (x: number) => (bd.prepare(`SELECT newsletter_id FROM emails WHERE id = ?`).get(x) as { newsletter_id: string | null }).newsletter_id;
  assert.equal(nid(id), "record-geral");
  assert.equal(nid(velho), "vidas-geral");
});

// ── 2. Caixa cortada ───────────────────────────────────────────────────────

const cortada = (agora: Date) => saudeCaixa(agora).caixaCortada.map((c) => c.dominio);

test("caixa cortada: 2 dias esperados sem nenhuma diária do domínio", () => {
  db().prepare(`DELETE FROM emails`).run();
  gravar("Record Geral <info@news.jornalrecord.pt>", "Manchete", lisboa("2026-10-05", "09:00"), "record-geral", "<p>a</p>");

  // Um dia esperado sem nada: ainda não.
  assert.deepEqual(cortada(lisboa("2026-10-06", "23:00")), []);
  // O segundo dia só conta depois do limite.
  assert.deepEqual(cortada(lisboa("2026-10-07", "08:00")), []);
  const r = saudeCaixa(lisboa("2026-10-08", "23:00"));
  assert.deepEqual(r.caixaCortada, [
    { dominio: "news.jornalrecord.pt", desde: "2026-10-06", ultimaEdicao: lisboa("2026-10-05", "09:00").toISOString(), diasEsperadosSemEdicao: 3 },
  ]);
  const d = r.dominios.find((x) => x.dominio === "news.jornalrecord.pt");
  assert.equal(d?.diasDesdeUltimaEdicao, 3);
  // Domínios sem nenhuma diária recebida não são "cortados": não há prova de inscrição.
  assert.ok(!r.caixaCortada.some((c) => c.dominio === "news.flash.pt"));

  // Chega uma edição de outra diária do mesmo domínio: deixa de estar cortada.
  gravar("Record Sporting <info@news.jornalrecord.pt>", "Sporting", lisboa("2026-10-08", "11:00"), "record-sporting", "<p>b</p>");
  assert.deepEqual(cortada(lisboa("2026-10-08", "23:00")), []);
});

test("caixa cortada: fins de semana não contam nas de dias úteis; semanais não contam", () => {
  // Máxima Geral é de dias úteis; a Fim de Semana é semanal.
  gravar("Máxima <info@news.maxima.pt>", "Geral", lisboa("2026-10-09", "09:00"), "maxima-geral", "<p>c</p>"); // sexta
  gravar("Máxima <info@news.maxima.pt>", "FdS", lisboa("2026-10-11", "09:00"), "maxima-fim-de-semana", "<p>d</p>");
  assert.ok(!cortada(lisboa("2026-10-12", "23:00")).includes("news.maxima.pt"), "só a segunda conta");
  const r = saudeCaixa(lisboa("2026-10-13", "23:00"));
  const c = r.caixaCortada.find((x) => x.dominio === "news.maxima.pt");
  assert.equal(c?.desde, "2026-10-12");
  assert.equal(c?.diasEsperadosSemEdicao, 2);
  // A última edição de qualquer newsletter do domínio vem no detalhe.
  assert.equal(r.dominios.find((x) => x.dominio === "news.maxima.pt")?.ultimaEdicao, lisboa("2026-10-11", "09:00").toISOString());
});

test("vigia: uma linha no log quando a caixa é cortada, nenhuma enquanto não muda", async () => {
  const linhas: string[] = [];
  const escrever = (l: string) => linhas.push(l);
  const a = await vigiarCaixa(lisboa("2026-10-13", "23:00"), escrever);
  assert.match(a ?? "", /CAIXA CORTADA.*news\.maxima\.pt desde 2026-10-12/);
  assert.equal(await vigiarCaixa(lisboa("2026-10-13", "23:05"), escrever), null);
  // A Máxima volta a mandar: nova linha, só com o que continua cortado (a Record).
  gravar("Máxima <info@news.maxima.pt>", "Geral", lisboa("2026-10-13", "09:00"), "maxima-geral", "<p>e</p>");
  const b = (await vigiarCaixa(lisboa("2026-10-13", "23:10"), escrever)) ?? "";
  assert.match(b, /news\.jornalrecord\.pt/);
  assert.doesNotMatch(b, /maxima/);
  // A Record também: a caixa normalizou.
  gravar("Record Geral <info@news.jornalrecord.pt>", "Geral", lisboa("2026-10-13", "09:00"), "record-geral", "<p>f</p>");
  assert.match((await vigiarCaixa(lisboa("2026-10-13", "23:15"), escrever)) ?? "", /normalizada/);
  assert.equal(linhas.length, 3);
});

test("/api/estado: caixaCortada vem como campo extra e não mexe no 200/503", async () => {
  const { estadoCompleto, respostaSaude } = await import("../src/lib/saude.ts");
  // Sem leitura: 503, com os campos da caixa presentes.
  let r = estadoCompleto();
  assert.equal(r.status, 503);
  assert.equal(r.corpo.saudavel, false);
  assert.ok(Array.isArray(r.corpo.caixaCortada));
  assert.ok(Array.isArray(r.corpo.caixa));
  assert.equal(respostaSaude().status, 503);

  // Leitura boa agora, mesmo com domínios cortados (a Record, sem nada desde 13/10): 200.
  leitura.registarLeitura(null, new Date(Date.now() - 7 * 86_400_000));
  r = estadoCompleto();
  assert.equal(r.status, 200);
  assert.equal(r.corpo.saudavel, true);
  assert.ok(r.corpo.caixaCortada!.some((c) => c.dominio === "news.jornalrecord.pt"));
  assert.equal(respostaSaude().status, 200);

  // Uma falha de leitura dá 503, com ou sem caixa cortada; o erro em bruto só aqui.
  leitura.registarLeitura(new Error("IMAP em baixo"));
  r = estadoCompleto();
  assert.equal(r.status, 503);
  assert.equal(r.corpo.falha, "IMAP em baixo");
});

test("/api/saude é público: só o essencial, com o mesmo 200/503", async () => {
  const { respostaSaude } = await import("../src/lib/saude.ts");
  const chaves = ["falha", "minutosDesdeLeitura", "saudavel", "ultimaLeitura"];

  // Falha (do teste anterior): 503, código genérico, nada do erro em bruto nem da caixa.
  leitura.registarLeitura(new Error("IMAP em baixo: user@exemplo.pt 10.0.0.1"));
  let r = respostaSaude();
  assert.equal(r.status, 503);
  assert.deepEqual(Object.keys(r.corpo).sort(), chaves);
  assert.equal(r.corpo.falha, "leitura_falhou");
  assert.doesNotMatch(JSON.stringify(r.corpo), /IMAP|exemplo|10\.0\.0\.1|jornalrecord/);

  // Leitura boa: 200 e o corpo traz a string que a verificação do Google procura.
  leitura.registarLeitura(null);
  r = respostaSaude();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.corpo).sort(), chaves);
  assert.equal(r.corpo.falha, null);
  assert.match(JSON.stringify(r.corpo), /"saudavel":true/);
});
