/**
 * Testes das salvaguardas contra o corte das listas pelo editor: a abertura
 * gravada e repetida quando falha, a newsletter em silêncio (lista a lista) e
 * os emails de reconquista.
 *   npm test
 *
 * Base de dados temporária própria: nunca toca em data/monitor.db, e nenhum
 * pixel verdadeiro é pedido (o `pedir` é sempre um falso).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const pasta = mkdtempSync(join(tmpdir(), "nwl-listas-"));
process.env.DATABASE_PATH = join(pasta, "teste.db");
delete process.env.MONITOR_INICIO;
delete process.env.HEALTHCHECK_URL;
delete process.env.MARCAR_ABERTURA;

const abertura = await import("../src/lib/abertura.ts");
const { recolher } = await import("../src/lib/recolha.ts");
const { saudeCaixa, vigilanciaListas, EDICOES_PARA_CORTE } = await import("../src/lib/caixa.ts");
const { vigiarListas } = await import("../src/lib/vigia.ts");
const { processarCorpo } = await import("../src/lib/conteudo.ts");
const { paraInstante } = await import("../src/lib/tempo.ts");
const { db, fecharDb } = await import("../src/lib/db.ts");
import type { MensagemGraph } from "../src/lib/graph/mail.ts";

const lisboa = (data: string, hora: string) => paraInstante(data, hora);

test.after(() => {
  fecharDb();
  rmSync(pasta, { recursive: true, force: true });
});

const PIXEL = "https://sgdbs6pn.r.eu-west-1.awstrack.me/I0/010201a0ecd8543f-db5bc714/abc=473";
const comPixel = (texto: string, pixel = PIXEL) =>
  `<html><body><a href="https://sgdbs6pn.r.eu-west-1.awstrack.me/L0/https:%2F%2Fwww.record.pt/1/x">${texto}</a>` +
  `<img src="https://cdn.record.pt/foto.jpg"><img alt="" src="${pixel}" width="1" height="1"></body></html>`;

const mensagem = (id: string, remetente: string, assunto: string, quando: Date, html: string): MensagemGraph => ({
  internetMessageId: id,
  receivedDateTime: quando.toISOString(),
  from: { emailAddress: { address: remetente } },
  subject: assunto,
  body: { contentType: "html", content: html },
});

/** Um `pedir` falso que regista cada pedido. */
function falso(responde: (url: string) => boolean | "rede") {
  const pedidos: string[] = [];
  const pedir = async (url: string) => {
    pedidos.push(url);
    const r = responde(url);
    if (r === "rede") throw new Error("rede em baixo");
    return { ok: r };
  };
  return { pedidos, pedir };
}

const linha = (msgId: string) =>
  db()
    .prepare(
      `SELECT aberto_em AS aberto, abertura_falhas AS falhas, abertura_tentada_em AS tentada
         FROM emails WHERE internet_message_id = ?`,
    )
    .get(msgId) as { aberto: string | null; falhas: number; tentada: string | null };

const minutos = (m: number) => new Date(Date.now() + m * 60_000);

// ── 1. Abertura gravada e repetida ─────────────────────────────────────────

test("abertura que falha volta a ser tentada nos ciclos seguintes, com espera", async () => {
  const agora = new Date();
  const p1 = "https://abcd1234.r.eu-west-1.awstrack.me/I0/falha-1";
  const f = falso(() => "rede");
  const r = await recolher(
    24,
    async () => [mensagem("falha-1@teste", "Record Geral <info@news.jornalrecord.pt>", "Manchete", agora, comPixel("a", p1))],
    f.pedir,
  );
  assert.equal(r.abertos, 0);
  assert.deepEqual(f.pedidos, [p1]);
  let l = linha("falha-1@teste");
  assert.equal(l.aberto, null);
  assert.equal(l.falhas, 1);
  assert.ok(l.tentada);

  // No ciclo seguinte (daqui a 1 min) ainda está em espera: não se pede.
  const g = falso(() => true);
  assert.deepEqual(await abertura.abrirPendentes(minutos(1), g.pedir), { abertos: 0, falhados: 0 });
  assert.deepEqual(g.pedidos, []);

  // Passada a espera (5 min depois da 1.ª falha), tenta outra vez e abre.
  assert.deepEqual(await abertura.abrirPendentes(minutos(6), g.pedir), { abertos: 1, falhados: 0 });
  assert.deepEqual(g.pedidos, [p1]);
  l = linha("falha-1@teste");
  assert.ok(l.aberto);
  assert.equal(l.falhas, 1, "as falhas ficam como estavam");
});

test("uma resposta de erro (não 2xx) também conta como falha", async () => {
  const p2 = "https://abcd1234.r.eu-west-1.awstrack.me/I0/falha-2";
  const f = falso(() => false);
  await recolher(24, async () => [
    mensagem("falha-2@teste", "Record Geral <info@news.jornalrecord.pt>", "Manchete", new Date(), comPixel("b", p2)),
  ], f.pedir);
  assert.equal(linha("falha-2@teste").falhas, 1);
  assert.equal(linha("falha-2@teste").aberto, null);
  // As esperas crescem e têm teto.
  assert.equal(abertura.esperaDepoisDe(1), 5 * 60_000);
  assert.equal(abertura.esperaDepoisDe(2), 10 * 60_000);
  assert.equal(abertura.esperaDepoisDe(30), 6 * 3_600_000);
  // Deixar este aberto, para não interferir com os testes seguintes.
  await abertura.abrirPendentes(minutos(6), falso(() => true).pedir);
  assert.ok(linha("falha-2@teste").aberto);
});

test("um email aberto com sucesso nunca se pede outra vez", async () => {
  const p3 = "https://abcd1234.r.eu-west-1.awstrack.me/I0/ok-3";
  const f = falso(() => true);
  const r = await recolher(24, async () => [
    mensagem("ok-3@teste", "Record Geral <info@news.jornalrecord.pt>", "Manchete", new Date(), comPixel("c", p3)),
  ], f.pedir);
  assert.equal(r.abertos, 1);
  assert.deepEqual(f.pedidos, [p3]);
  const aberto = linha("ok-3@teste").aberto;
  assert.ok(aberto);

  // Ciclos seguintes, mesmo muito depois e com o email outra vez na leitura:
  // nada se pede.
  const g = falso(() => true);
  for (const m of [5, 60, 600]) await abertura.abrirPendentes(minutos(m), g.pedir);
  await recolher(24, async () => [
    mensagem("ok-3@teste", "Record Geral <info@news.jornalrecord.pt>", "Manchete", new Date(), comPixel("c", p3)),
  ], g.pedir);
  assert.deepEqual(g.pedidos, []);
  assert.equal(linha("ok-3@teste").aberto, aberto);
});

test("só o pixel I0: sem pixel não se pede nada (nem links, nem outras imagens)", async () => {
  const f = falso(() => true);
  await recolher(24, async () => [
    mensagem(
      "sem-pixel@teste",
      "Record Geral <info@news.jornalrecord.pt>",
      "Manchete",
      new Date(),
      `<a href="https://sgdbs6pn.r.eu-west-1.awstrack.me/L0/https:%2F%2Fx.pt/1">link</a><img src="https://cdn.record.pt/a.jpg">`,
    ),
  ], f.pedir);
  assert.deepEqual(f.pedidos, []);
  assert.equal(linha("sem-pixel@teste").falhas, abertura.SEM_PIXEL);
  assert.equal(abertura.estadoAbertura(null, abertura.SEM_PIXEL), "sem-pixel");
});

test("MARCAR_ABERTURA=0: nada é pedido; o email fica por abrir e abre quando voltar a ligar", async () => {
  const p4 = "https://abcd1234.r.eu-west-1.awstrack.me/I0/desligado-4";
  const f = falso(() => true);
  process.env.MARCAR_ABERTURA = "0";
  try {
    const r = await recolher(24, async () => [
      mensagem("desligado-4@teste", "Record Geral <info@news.jornalrecord.pt>", "Manchete", new Date(), comPixel("d", p4)),
    ], f.pedir);
    assert.equal(r.abertos, 0);
    assert.deepEqual(await abertura.abrirPendentes(minutos(10), f.pedir), { abertos: 0, falhados: 0 });
    assert.deepEqual(f.pedidos, []);
    assert.equal(linha("desligado-4@teste").falhas, 0);
  } finally {
    delete process.env.MARCAR_ABERTURA;
  }
  assert.equal((await abertura.abrirPendentes(new Date(), f.pedir)).abertos, 1);
  assert.deepEqual(f.pedidos, [p4]);
});

test("limite por ciclo e janela de 7 dias", async () => {
  const bd = db();
  const html = comPixel("e", "https://abcd1234.r.eu-west-1.awstrack.me/I0/muitos");
  const inserir = bd.prepare(
    `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html) VALUES (?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < abertura.MAXIMO_POR_CICLO + 5; i++) {
    inserir.run(`muitos-${i}@teste`, "x <info@news.jornalrecord.pt>", "x", new Date(Date.now() - i * 60_000).toISOString(), html);
  }
  // Um de há 8 dias: fora da janela, não se tenta.
  inserir.run("velho@teste", "x <info@news.jornalrecord.pt>", "x", new Date(Date.now() - 8 * 86_400_000).toISOString(), html);

  const f = falso(() => true);
  assert.equal((await abertura.abrirPendentes(new Date(), f.pedir)).abertos, abertura.MAXIMO_POR_CICLO);
  assert.equal((await abertura.abrirPendentes(new Date(), f.pedir)).abertos, 5);
  assert.equal((await abertura.abrirPendentes(new Date(), f.pedir)).abertos, 0);
  assert.equal(f.pedidos.length, abertura.MAXIMO_POR_CICLO + 5);
  assert.equal(linha("velho@teste").aberto, null);
  assert.equal(abertura.resumoAberturas().porAbrir, 0);
});

test("ao fim de MAXIMO_FALHAS desiste-se desse email", async () => {
  const bd = db();
  bd.prepare(
    `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html, abertura_falhas)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("desistido@teste", "x <info@news.jornalrecord.pt>", "x", new Date().toISOString(),
    comPixel("f", "https://abcd1234.r.eu-west-1.awstrack.me/I0/desistido"), abertura.MAXIMO_FALHAS);
  const f = falso(() => true);
  await abertura.abrirPendentes(minutos(24 * 60), f.pedir);
  assert.deepEqual(f.pedidos, []);
  assert.equal(abertura.resumoAberturas().desistidos, 1);
  bd.prepare(`DELETE FROM emails WHERE internet_message_id = 'desistido@teste'`).run();
});

// ── 2. Newsletters em silêncio, lista a lista ──────────────────────────────

let seq = 0;
const gravar = (remetente: string, assunto: string, quando: Date, nid: string | null, html: string) => {
  const c = processarCorpo(html);
  const r = db()
    .prepare(
      `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html,
         corpo_normalizado, hash_conteudo, newsletter_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(`l${++seq}@teste`, remetente, assunto, quando.toISOString(), html, c.normalizado, `${c.hash}${seq}`, nid);
  return Number(r.lastInsertRowid);
};

const RECORD = "info@news.jornalrecord.pt";
const silencio = (agora: Date) => vigilanciaListas(agora).listas;

test("lista em silêncio: aviso às 2 edições em falta, mesmo com as outras do domínio a chegar", () => {
  db().prepare(`DELETE FROM emails`).run();
  // A Sporting chega a 01/10 e depois mais nada; a Geral e a Benfica, do mesmo
  // endereço, continuam a chegar todos os dias.
  gravar(`Record Sporting <${RECORD}>`, "Sporting", lisboa("2026-10-01", "11:00"), "record-sporting", "<p>s</p>");
  for (const d of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]) {
    gravar(`Record Geral <${RECORD}>`, "Geral", lisboa(d, "09:00"), "record-geral", `<p>g${d}</p>`);
    gravar(`Record Benfica <${RECORD}>`, "Benfica", lisboa(d, "11:45"), "record-benfica", `<p>b${d}</p>`);
  }

  // 02/10 às 23:00: só uma edição em falta — ainda nada.
  assert.ok(!silencio(lisboa("2026-10-02", "23:00")).some((l) => l.newsletterId === "record-sporting"));
  // 03/10 antes do limite da Sporting: continua uma só.
  assert.ok(!silencio(lisboa("2026-10-03", "10:00")).some((l) => l.newsletterId === "record-sporting"));
  // 03/10 depois do limite: duas — aviso.
  const aviso = silencio(lisboa("2026-10-03", "23:00")).find((l) => l.newsletterId === "record-sporting");
  assert.ok(aviso, "a Sporting está em silêncio");
  assert.equal(aviso.nivel, "aviso");
  assert.equal(aviso.edicoesEmFalta, 2);
  assert.equal(aviso.desde, "2026-10-02");
  assert.equal(aviso.ultimaEdicao, lisboa("2026-10-01", "11:00").toISOString());
  assert.match(aviso.acao, /reinscrever esta newsletter/);
  // As que chegam não aparecem.
  assert.ok(!silencio(lisboa("2026-10-03", "23:00")).some((l) => l.newsletterId !== "record-sporting" && l.marca === "Record" && /Geral|Benfica/.test(l.nome)));

  // O domínio continua a receber diárias: a contagem por domínio não vê nada.
  assert.ok(!saudeCaixa(lisboa("2026-10-06", "23:00")).caixaCortada.some((c) => c.dominio === "news.jornalrecord.pt"));
  // A lista, essa, já está cortada.
  const cortada = silencio(lisboa("2026-10-06", "23:00")).find((l) => l.newsletterId === "record-sporting");
  assert.equal(cortada?.nivel, "cortada");
  assert.equal(cortada?.edicoesEmFalta, 5);
  assert.ok(cortada!.edicoesEmFalta >= EDICOES_PARA_CORTE);
  assert.match(cortada!.acao, /reinscrever esta newsletter/);
});

test("lista em silêncio: dias que não são de envio não contam; nunca recebida não conta", () => {
  // Máxima Geral é de dias úteis: sexta 09/10 recebida; sábado e domingo não contam.
  gravar("Máxima <info@news.maxima.pt>", "Geral", lisboa("2026-10-09", "09:00"), "maxima-geral", "<p>m</p>");
  assert.ok(!silencio(lisboa("2026-10-12", "23:00")).some((l) => l.newsletterId === "maxima-geral"), "só a segunda conta");
  const m = silencio(lisboa("2026-10-13", "23:00")).find((l) => l.newsletterId === "maxima-geral");
  assert.equal(m?.desde, "2026-10-12");
  assert.equal(m?.edicoesEmFalta, 2);
  // Uma newsletter de que nunca chegou nada não é "em silêncio": não há prova de inscrição.
  assert.ok(!silencio(lisboa("2026-10-13", "23:00")).some((l) => l.newsletterId === "flash-mundo"));
});

test("vigia das listas: uma linha quando entra, nenhuma enquanto não muda, outra quando volta", async () => {
  const linhas: string[] = [];
  const escrever = (l: string) => linhas.push(l);
  const a = await vigiarListas(lisboa("2026-10-03", "23:00"), escrever);
  assert.equal(a.length, 1);
  assert.match(a[0], /NEWSLETTER EM SILÊNCIO.*Sporting.*desde 2026-10-02.*reinscrever esta newsletter/);
  assert.deepEqual(await vigiarListas(lisboa("2026-10-03", "23:05"), escrever), []);
  // Passa a cortada: muda o nível, nova linha.
  const b = await vigiarListas(lisboa("2026-10-06", "23:00"), escrever);
  assert.equal(b.length, 1);
  assert.match(b[0], /cortada pelo editor/);
  // A Sporting volta.
  gravar(`Record Sporting <${RECORD}>`, "Sporting", lisboa("2026-10-06", "11:00"), "record-sporting", "<p>s2</p>");
  const c = await vigiarListas(lisboa("2026-10-06", "23:05"), escrever);
  assert.ok(c.some((l) => /de volta à caixa: .*record-sporting/.test(l)), c.join(" | "));
  assert.equal(linhas.length, 3);
});

// ── 3. Emails de reconquista ───────────────────────────────────────────────

const crm = (extra = "") =>
  `<html><head><style>.u-row{width:600px}</style></head><body>` +
  `<img src="https://assets.unlayer.com/projects/88242/1754663928692-new_logo.png">` +
  `<p>Sentimos a sua falta.</p>` +
  Array.from({ length: 3 }, (_, i) =>
    `<img src="https://assets.unlayer.com/projects/88242/17${i}-bloco.jpg"><h3>Secção ${i}</h3>` +
    `<p>Descubra os conte&uacute;dos.</p><a href="https://x.pt/${i}${extra}">Continuar a receber</a>`,
  ).join("") +
  `<p>Est&aacute; a receber este e-mail porque subscreveu esta newsletter.</p></body></html>`;

test("reconquista recente: assinalada, com o estado do pixel", async () => {
  const agora = new Date();
  const pixel = "https://abcd1234.r.eu-west-1.awstrack.me/I0/reconquista";
  const f = falso(() => "rede");
  await recolher(24, async () => [
    mensagem("reconquista@teste", `Record <${RECORD}>`, "Continua connosco?", agora, comPixel("x", pixel).replace("</body>", `${crm()}</body>`)),
  ], f.pedir);
  let r = vigilanciaListas(minutos(1)).reconquistas.find((x) => x.assunto === "Continua connosco?");
  assert.ok(r, "a reconquista é assinalada");
  assert.equal(r.abertura, "falhou");
  assert.equal(r.abertoEm, null);

  // O ciclo seguinte, passada a espera, abre-a.
  await abertura.abrirPendentes(minutos(6), falso(() => true).pedir);
  r = vigilanciaListas(minutos(7)).reconquistas.find((x) => x.assunto === "Continua connosco?");
  assert.equal(r?.abertura, "aberto");
  assert.ok(r?.abertoEm);

  // Mais de 7 dias depois já não aparece.
  assert.ok(!vigilanciaListas(minutos(8 * 24 * 60)).reconquistas.some((x) => x.assunto === "Continua connosco?"));
});

test("reconquista pela campanha reativacao2, mesmo com outro molde", () => {
  const html =
    `<html><body><p>${"Texto comprido de uma campanha sem o molde habitual. ".repeat(40)}</p>` +
    `<a href="https://www.record.pt/?utm_source=echobox&amp;utm_campaign=reativacao2">Quero continuar</a></body></html>`;
  gravar(`Record <${RECORD}>`, "Uma última oportunidade", new Date(), null, html);
  // Um email de outro remetente com a mesma campanha não conta (não é do editor).
  gravar("Loja <promo@loja.pt>", "Promo", new Date(), null, html);
  const r = vigilanciaListas(minutos(1)).reconquistas;
  assert.ok(r.some((x) => x.assunto === "Uma última oportunidade"));
  assert.ok(!r.some((x) => x.assunto === "Promo"));
});

test("/api/estado traz as listas e as reconquistas; /api/saude continua mínimo", async () => {
  const { estadoCompleto, respostaSaude } = await import("../src/lib/saude.ts");
  const e = estadoCompleto();
  assert.ok(Array.isArray(e.corpo.listasEmSilencio));
  assert.ok(Array.isArray(e.corpo.reconquistas));
  assert.ok(e.corpo.aberturas);
  const s = respostaSaude();
  assert.deepEqual(Object.keys(s.corpo).sort(), ["falha", "minutosDesdeLeitura", "saudavel", "ultimaLeitura"]);
  assert.equal(s.status, e.status, "o 200/503 é o mesmo e depende só da leitura");
});

// ── 4. Base antiga ─────────────────────────────────────────────────────────

test("base antiga: as colunas da abertura acrescentam-se e o que lá estava não se volta a abrir", async () => {
  fecharDb();
  const antiga = join(pasta, "antiga.db");
  const velha = new Database(antiga);
  velha.exec(`CREATE TABLE emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT, internet_message_id TEXT NOT NULL UNIQUE,
    remetente TEXT NOT NULL DEFAULT '', assunto TEXT NOT NULL DEFAULT '', recebido_em TEXT NOT NULL,
    corpo_html TEXT NOT NULL DEFAULT '', corpo_normalizado TEXT NOT NULL DEFAULT '',
    hash_conteudo TEXT NOT NULL DEFAULT '', newsletter_id TEXT DEFAULT NULL)`);
  velha
    .prepare(`INSERT INTO emails (internet_message_id, remetente, recebido_em, corpo_html) VALUES (?, ?, ?, ?)`)
    .run("antigo@teste", RECORD, new Date().toISOString(), comPixel("z", "https://abcd1234.r.eu-west-1.awstrack.me/I0/antigo"));
  velha.close();

  const anterior = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = antiga;
  try {
    assert.equal(linha("antigo@teste").falhas, abertura.ANTERIOR_AO_REGISTO);
    const f = falso(() => true);
    assert.equal((await abertura.abrirPendentes(new Date(), f.pedir)).abertos, 0);
    assert.deepEqual(f.pedidos, []);
    assert.equal(abertura.estadoAbertura(null, abertura.ANTERIOR_AO_REGISTO), "desconhecido");
  } finally {
    fecharDb();
    process.env.DATABASE_PATH = anterior;
  }
});
