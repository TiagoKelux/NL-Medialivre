/**
 * Testes das fichas das newsletters: o normal de cada uma, calculado com o
 * histórico guardado, e a última edição medida contra ele.
 *   npm test
 *
 * Base de dados temporária própria: nunca toca em data/monitor.db, e nenhuma
 * página verdadeira é pedida (as datas dos artigos gravam-se à mão).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pasta = mkdtempSync(join(tmpdir(), "nwl-fichas-"));
process.env.DATABASE_PATH = join(pasta, "teste.db");
delete process.env.MONITOR_INICIO;
delete process.env.HEALTHCHECK_URL;

const { fichaDe, fichas } = await import("../src/lib/fichas.ts");
const { extrairArtigos } = await import("../src/lib/conteudo.ts");
const { newsletterPorId } = await import("../config/newsletters.ts");
const { paraInstante, somarDias } = await import("../src/lib/tempo.ts");
const { db, fecharDb } = await import("../src/lib/db.ts");

test.after(() => {
  fecharDb();
  rmSync(pasta, { recursive: true, force: true });
});

const HOJE = "2026-11-09";
const LINK = (caminho: string) =>
  `<a href="https://sgdbs6pn.r.eu-west-1.awstrack.me/L0/https:%2F%2Fwww.record.pt%2F${encodeURIComponent(caminho)}/1/010201a1ba69cca7-426b9237-0c3f-4354-803d-0db423b6224a-000000/UDVoBcpZW-3h1mzVho=">x</a>`;

let seq = 0;

/**
 * Grava um email com `datados` artigos publicados `idadeDias` antes de chegar
 * e `semData` artigos sem data conhecida.
 */
function gravar(newsletterId: string, data: string, hora: string, datados: number, idadeDias: number, semData = 0): void {
  const quando = paraInstante(data, hora);
  const caminhos = Array.from({ length: datados + semData }, () => `futebol/detalhe/artigo-numero-${++seq}-da-ficha`);
  const html = `<html><body><p>edição ${seq}</p>${caminhos.map(LINK).join("")}</body></html>`;
  db()
    .prepare(
      `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html, newsletter_id)
       VALUES (?, 'info@news.jornalrecord.pt', 'teste', ?, ?, ?)`,
    )
    .run(`<f${seq}@t>`, quando.toISOString(), html, newsletterId);
  const urls = extrairArtigos(html);
  assert.equal(urls.length, datados + semData, "os links contam como artigos");
  const publicado = new Date(quando.getTime() - idadeDias * 86_400_000).toISOString();
  const gravarArtigo = db().prepare(`INSERT INTO artigos (url, publicado_em, estado, tentativas) VALUES (?, ?, 200, 1)`);
  for (const u of urls.slice(0, datados)) gravarArtigo.run(u, publicado);
}

// Record Premium (diária, janela 7h-8h: 07:00 com tolerância até 08:30): 12 edições até hoje, a
// de hoje com artigos de há 10 dias — nada de novo desde a anterior.
for (let i = 11; i >= 0; i--) {
  const data = somarDias(HOJE, -i);
  const tarde = i === 4 || i === 7;
  if (i === 0) gravar("record-premium", data, "07:05", 3, 10, 1);
  else gravar("record-premium", data, tarde ? "08:45" : "07:05", 3, 0.25, 1);
  // Um segundo envio no mesmo dia não é outra edição nem mexe na hora.
  if (i === 5) gravar("record-premium", data, "11:00", 3, 0.1);
}

// FLASH! Mundo: só 3 edições.
for (let i = 2; i >= 0; i--) gravar("flash-mundo", somarDias(HOJE, -i), "08:10", 4, 1.4);

test("ficha com perfil estável: edições, dias, hora, artigos, idade e cobertura", () => {
  const f = fichaDe(newsletterPorId("record-premium")!, HOJE);
  assert.equal(f.estadoPerfil, "estável");
  assert.equal(f.edicoes, 12, "a edição de hoje conta; o segundo envio não");
  assert.equal(f.primeira, somarDias(HOJE, -11));
  assert.equal(f.ultima, HOJE);
  assert.deepEqual(f.dias.configurados, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(f.dias.vistos.reduce((a, b) => a + b, 0), 12);
  assert.equal(f.dias.vistos[0], 2, "duas segundas-feiras (02/11 e 09/11)");
  assert.equal(f.dias.foraDoCalendario, 0);

  assert.deepEqual(f.hora, { prevista: "07:00", limite: "08:30", mediana: "07:05", p90: "08:45", aTempo: 10 / 12 });

  assert.deepEqual(f.artigos, { mediana: 4, min: 4, max: 4 });
  assert.equal(f.coberturaDatas, 0.75);
  assert.ok(f.idade);
  assert.equal(f.idade.edicoes, 12);
  assert.ok(Math.abs(f.idade.p50 - 0.25) < 1e-9);
  assert.ok(Math.abs(f.idade.p90 - 0.25) < 1e-9);
  assert.ok(Math.abs(f.idade.max - 10) < 1e-9);
  assert.equal(f.reusoP90, 0);
  assert.equal(f.dataNoTopo, false);
});

test("ficha: a última edição medida contra as anteriores — conteúdo desatualizado", () => {
  const u = fichaDe(newsletterPorId("record-premium")!, HOJE).ultimaEdicao;
  assert.ok(u);
  assert.equal(u.data, HOJE);
  assert.equal(u.hora, "07:05");
  assert.equal(u.artigos, 4);
  assert.ok(u.maisRecenteDias !== null && Math.abs(u.maisRecenteDias - 10) < 1e-9);
  assert.match(u.desatualizada ?? "", /nada publicado desde a edição anterior \(08\/11\)/);
  assert.equal(u.igualA, null);
  assert.equal(u.frescoProvado, false);

  // Ontem, a edição estava dentro do normal.
  const ontem = fichaDe(newsletterPorId("record-premium")!, somarDias(HOJE, -1)).ultimaEdicao;
  assert.ok(ontem);
  assert.equal(ontem.data, somarDias(HOJE, -1));
  assert.equal(ontem.desatualizada, null);
  assert.equal(ontem.frescoProvado, true);
});

test("ficha sem histórico e ficha sem edições", () => {
  const f = fichaDe(newsletterPorId("flash-mundo")!, HOJE);
  assert.equal(f.estadoPerfil, "sem histórico");
  assert.equal(f.edicoes, 3);
  assert.equal(f.artigos, null, "com menos de 5 edições não há normal");
  assert.equal(f.idade, null);
  assert.equal(f.coberturaDatas, 1);
  assert.equal(f.hora?.mediana, "08:10");
  assert.equal(f.ultimaEdicao?.artigos, 4);
  assert.equal(f.ultimaEdicao?.desatualizada, null);

  const vazia = fichaDe(newsletterPorId("negocios-5-coisas")!, HOJE);
  assert.equal(vazia.edicoes, 0);
  assert.equal(vazia.estadoPerfil, "sem histórico");
  assert.equal(vazia.hora, null);
  assert.equal(vazia.coberturaDatas, null);
  assert.equal(vazia.ultimaEdicao, null);
  assert.deepEqual(vazia.dias.configurados, [1, 2, 3, 4, 5]);
});

test("fichas(): uma por newsletter configurada", () => {
  const todas = fichas(HOJE);
  assert.ok(todas.length > 10);
  assert.equal(new Set(todas.map((f) => f.id)).size, todas.length);
  assert.ok(todas.some((f) => f.id === "record-premium" && f.edicoes === 12));
});
