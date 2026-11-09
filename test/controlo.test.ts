/**
 * Testes do controlo manual do cliente: ler o Excel (sem o alterar), gravar
 * as marcas e o efeito nos registos — só onde a nossa caixa não tem email.
 *   npm test
 *
 * Base de dados temporária própria: nunca toca em data/monitor.db.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pasta = mkdtempSync(join(tmpdir(), "nwl-controlo-"));
process.env.DATABASE_PATH = join(pasta, "teste.db");
delete process.env.MONITOR_INICIO;
delete process.env.HEALTHCHECK_URL;

const { construirXlsx } = await import("../src/lib/excel.ts");
const { lerXlsx } = await import("../src/lib/xlsx-leitor.ts");
const { lerControlo, esquecerControlo } = await import("../src/lib/controlo-cliente.ts");
const { importarControlo, comparacao } = await import("../src/lib/importar-controlo.ts");
const registos = await import("../src/lib/registos.ts");
const { paraInstante } = await import("../src/lib/tempo.ts");
const { db, fecharDb } = await import("../src/lib/db.ts");

test.after(() => {
  fecharDb();
  rmSync(pasta, { recursive: true, force: true });
});

type V = string | number | null;

/**
 * Uma folha "TODOS OS DIAS" como a do cliente: meses na linha 1, dias na 3,
 * dias da semana na 4, newsletters da linha 5 em diante (marca em B, nome em
 * C, as marcas a partir da coluna N). Os dias vão de 28/10 a 03/11/2026.
 */
function folhaDiaria(linhas: [string, string, V[]][]): V[][] {
  const dias = [28, 29, 30, 31, 1, 2, 3];
  const semana = ["4ª", "5ª", "6ª", "S", "D", "2ª", "3ª"];
  const vazio = (n: number): V[] => Array.from({ length: n }, () => null);
  const r1 = vazio(13).concat([null, null, null, null, "NOVEMBRO", null, null]);
  r1[13] = "OUTUBRO";
  const r2 = vazio(20);
  const r3 = vazio(13).concat(dias);
  const r4 = vazio(13).concat(semana);
  const corpo = linhas.map(([m, n, vs]) => [null, m, n, ...vazio(10), ...vs]);
  return [r1, r2, r3, r4, ...corpo];
}

function xlsx(linhas: [string, string, V[]][]): Buffer {
  return construirXlsx([
    { nome: "TODOS OS DIAS", linhas: folhaDiaria(linhas) },
    { nome: "Horário", linhas: [["Newsletter"], ["nada aqui"]] },
  ]);
}

test("leitor de xlsx: valores, texto e folhas", () => {
  const folhas = lerXlsx(construirXlsx([{ nome: "A", linhas: [["x", 2], [null, "Olá & adeus"]] }]));
  assert.equal(folhas[0].nome, "A");
  assert.equal(folhas[0].celula(1, 1), "x");
  assert.equal(folhas[0].celula(1, 2), 2);
  assert.equal(folhas[0].celula(2, 2), "Olá & adeus");
  assert.equal(folhas[0].celula(2, 1), null);
});

test("ler o controlo: datas pelo cabeçalho, nomes pela configuração, gralhas toleradas", () => {
  const l = lerControlo(
    xlsx([
      ["CM", "Exclusivos", [1, 1, 5, 1, 1, 2, 1]],
      ["Negócios", "Opinião do dia", [1, 1, 1, null, null, 1, 1]],
      ["TV GUIA", "Coisa que não existe", [1, 1, 1, 1, 1, 1, 1]],
      ["Record", "Geral", ["x", 9, 7, null, null, null, null]],
    ]),
    "2026-11-02",
  );
  assert.equal(l.folhas.length, 1, "só as folhas de controlo");
  assert.equal(l.folhas[0].erro, undefined);
  const de = (id: string) => l.marcas.filter((m) => m.newsletterId === id).map((m) => `${m.data.slice(5)}:${m.valor}`).sort();
  // 03/11 é depois de "hoje": fica de fora.
  assert.deepEqual(de("cm-exclusivos"), ["10-28:1", "10-29:1", "10-30:5", "10-31:1", "11-01:1", "11-02:2"]);
  assert.deepEqual(de("negocios-opiniao"), ["10-28:1", "10-29:1", "10-30:1", "11-02:1"]);
  // Só 1 a 7 conta; texto e 9 ignorados.
  assert.deepEqual(de("record-geral"), ["10-30:7"]);
  assert.ok(l.ignoradas.some((i) => /Coisa que não existe/.test(i.texto) && /configuração/.test(i.motivo)));
});

test("cabeçalho que não bate com os dias da semana: a folha não é lida", () => {
  const linhas = folhaDiaria([["CM", "Exclusivos", [1, 1, 1, 1, 1, 1, 1]]]);
  linhas[3] = linhas[3].map((v) => (v === "D" ? "2ª" : v)); // 1/11/2026 é domingo
  const l = lerControlo(construirXlsx([{ nome: "TODOS OS DIAS", linhas }]), "2026-11-02");
  assert.equal(l.marcas.length, 0);
  assert.match(l.folhas[0].erro ?? "", /não batem/);
  const r = importarControlo(construirXlsx([{ nome: "TODOS OS DIAS", linhas }]), "x.xlsx", null);
  assert.equal(r.ok, false);
});

test("importar: sem email na nossa caixa, a marca do cliente decide; com email, vale o monitor", () => {
  const dias = ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"];
  for (const d of dias) registos.gerarDia(d);
  // Vidas a 29/10: chegou à nossa caixa.
  db()
    .prepare(
      `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html, newsletter_id)
       VALUES ('<v@t>', 'Vidas Geral <info@news.correiodamanha.pt>', 'x', ?, '<p>vidas</p>', 'vidas-geral')`,
    )
    .run(paraInstante("2026-10-29", "10:05").toISOString());
  for (const d of dias) {
    registos.reavaliar("cm-exclusivos", d);
    registos.reavaliar("vidas-geral", d);
  }
  assert.equal(registos.registoDe("vidas-geral", "2026-10-29")!.codigo_estado, 1);

  const r = importarControlo(
    xlsx([
      ["CM", "Exclusivos", [1, 2, 5, 6, 7, 1, null]],
      ["Vidas", "Geral", [1, 5, 1, 1, 1, 1, null]],
    ]),
    "Newsletters Horários.xlsx",
    "teste",
  );
  assert.ok(r.ok, r.mensagem);

  const reg = (id: string, d: string) => registos.registoDe(id, d)!;
  let x = reg("cm-exclusivos", "2026-10-28");
  assert.equal(x.codigo_estado, 1);
  assert.equal(x.fonte, "cliente");
  assert.equal(x.fechado, 1);
  assert.equal(x.ressalva, null);
  assert.match(x.detalhe, /Não chegou à caixa do monitor, mas o controlo manual do cliente/);
  assert.equal(reg("cm-exclusivos", "2026-10-29").codigo_estado, 2);
  // 5 do cliente e nada na nossa: Não Saiu provado pelas duas caixas.
  x = reg("cm-exclusivos", "2026-10-30");
  assert.equal(x.codigo_estado, 5);
  assert.equal(x.fonte, "cliente");
  assert.equal(x.fechado, 1);
  assert.match(x.detalhe, /nem na caixa do monitor nem na do cliente/);
  assert.equal(reg("cm-exclusivos", "2026-10-31").codigo_estado, 6);
  // 7 ("Saiu Errada") conta como 4.
  assert.equal(reg("cm-exclusivos", "2026-11-01").codigo_estado, 4);

  // Com email: o monitor mantém o 1 e a diferença aparece na comparação.
  x = reg("vidas-geral", "2026-10-29");
  assert.equal(x.codigo_estado, 1);
  assert.equal(x.fonte ?? null, null);
  const c = comparacao(30, "2026-11-03");
  const vidas = c.linhas.find((l) => l.newsletterId === "vidas-geral")!;
  assert.deepEqual(vidas.porCategoria["cliente-nao-recebeu"]!.map((d) => d.data), ["2026-10-29"]);
  assert.ok(c.totais["confirmada-pelo-cliente"] >= 5);
  assert.equal(c.importacoes[0].quem, "teste");

  // Reimportar o mesmo: nada muda. Reavaliar continua a dar o mesmo (idempotente).
  const r2 = importarControlo(
    xlsx([
      ["CM", "Exclusivos", [1, 2, 5, 6, 7, 1, null]],
      ["Vidas", "Geral", [1, 5, 1, 1, 1, 1, null]],
    ]),
    "Newsletters Horários.xlsx",
    null,
  );
  assert.equal(r2.alteradas, 0);
  esquecerControlo();
  registos.reavaliar("cm-exclusivos", "2026-10-28");
  assert.equal(reg("cm-exclusivos", "2026-10-28").fonte, "cliente");
});
