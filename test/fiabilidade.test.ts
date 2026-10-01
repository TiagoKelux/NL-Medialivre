/**
 * Testes dos mecanismos contra falsos positivos e falsos negativos.
 *   npm test
 *
 * Usam uma base de dados temporária: nunca tocam em data/monitor.db.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pasta = mkdtempSync(join(tmpdir(), "nwl-teste-"));
process.env.DATABASE_PATH = join(pasta, "teste.db");
delete process.env.MONITOR_INICIO;

const { corresponder, naoEEdicao } = await import("../src/lib/correspondencia.ts");
const { dataEdicao } = await import("../src/lib/edicao.ts");
const { classificar } = await import("../src/lib/classificacao.ts");
const { lerEml } = await import("../src/lib/eml.ts");
const { newsletterPorId } = await import("../config/newsletters.ts");
const { paraInstante } = await import("../src/lib/tempo.ts");
const { db, fecharDb } = await import("../src/lib/db.ts");
const registos = await import("../src/lib/registos.ts");
const { processarCorpo } = await import("../src/lib/conteudo.ts");

const nl = (id: string) => {
  const n = newsletterPorId(id);
  assert.ok(n, `newsletter ${id} existe`);
  return n;
};
const lisboa = (data: string, hora: string) => paraInstante(data, hora);

test.after(() => {
  fecharDb();
  rmSync(pasta, { recursive: true, force: true });
});

// ── Identificação ──────────────────────────────────────────────────────────

test("emails reais caem na newsletter certa", () => {
  const casos: [string, string, string | null][] = [
    ["Correio da Manhã Exclusivos <info@news.correiodamanha.pt>", "Demissões na PJ", "cm-exclusivos"],
    ["Correio da Manhã Bom dia <info@news.correiodamanha.pt>", "Ator Chad Lowe", "cm-bom-dia"],
    ["Correio da Manhã Boa tarde <info@news.correiodamanha.pt>", "Detido piloto", "cm-boa-tarde"],
    ["Vidas Geral <info@news.correiodamanha.pt>", "Identidade de psicólogo", "vidas-geral"],
    ["Jornal de Negócios - 5 Coisas a Saber <info@news.jornaldenegocios.pt>", "Desemprego", "negocios-5-coisas"],
    ["Jornal de Negócios Abertura <info@news.jornaldenegocios.pt>", "Ásia recupera", "negocios-abertura"],
    ["Jornal de Negócios Opinião do Dia <info@news.jornaldenegocios.pt>", "A certeza deste OE", "negocios-opiniao"],
    ["Jornal de Negócios Tecnologia <info@news.jornaldenegocios.pt>", "Trump", "negocios-tecnologia"],
    ["Jornal de Negócios Fecho <info@news.jornaldenegocios.pt>", "Wall Street", "negocios-fecho"],
    ["Negócios Premium - MUST <info@assinaturas.jornaldenegocios.pt>", "Inovação", "must-must"],
    ["FLASH! Bom dia <info@news.flash.pt>", "Onde estão", "flash-bom-dia"],
    ["FLASH! Mundo <info@news.flash.pt>", "Do estrelato", "flash-mundo"],
    ["FLASH! Weekend <info@news.flash.pt>", "Fim de semana", "flash-weekend"],
    ["FLASH! Moda & Beleza <info@news.flash.pt>", "Vera Wang", "flash-moda-e-beleza"],
    ["Record Geral <info@news.jornalrecord.pt>", "Transfermarkt", "record-geral"],
    ["Record Benfica <info@news.jornalrecord.pt>", "Transfermarkt", "record-benfica"],
    ["Record Sporting <info@news.jornalrecord.pt>", "João Simões", "record-sporting"],
    ["Record Porto <info@news.jornalrecord.pt>", "Devolvido", "record-porto"],
    ["Máxima <info@news.maxima.pt>", "Os giros", "maxima-geral"],
    // Não são edições
    ["Correio da Manhã Bom dia <info@news.correiodamanha.pt>", "Bem-vindo(a) à Vidas", null],
    ["Jornal de Negócios Opinião do dia <info@news.jornaldenegocios.pt>", "Queremos garantir que continua connosco", null],
    ["Correio da Manhã Bom dia <info@news.correiodamanha.pt>", "Queremos a informação do seu lado", null],
    ["FLASH! Mundo <info@news.flash.pt>", "Acompanhe as notícias mais recentes e as novidades", null],
    // Endereço desconhecido
    ["Google <no-reply@accounts.google.com>", "Alerta de segurança", null],
  ];
  for (const [de, assunto, esperado] of casos) {
    assert.equal(corresponder(de, assunto)?.id ?? null, esperado, `${de} | ${assunto}`);
  }
});

test("promoções e boas-vindas não contam como 'por classificar'", () => {
  assert.ok(naoEEdicao("Bem-vinda à Máxima"));
  assert.ok(naoEEdicao("  Queremos garantir que continua connosco"));
  assert.ok(!naoEEdicao("Queremos saber a sua opinião sobre o OE"));
});

test("regra mais específica ganha; empate fica por atribuir", () => {
  const base = { ...nl("negocios-fecho"), remetentes: ["x@y.pt"] };
  const fecho = { ...base, id: "fecho", padraoRemetente: "Fecho" };
  const dj = { ...base, id: "dj-fecho", padraoRemetente: "Dow Jones - Fecho" };
  const outra = { ...base, id: "outra", padraoRemetente: "Fecho" };
  assert.equal(corresponder("Negócios Dow Jones - Fecho <x@y.pt>", "a", [fecho, dj])?.id, "dj-fecho");
  assert.equal(corresponder("Negócios Fecho <x@y.pt>", "a", [fecho, dj])?.id, "fecho");
  assert.equal(corresponder("Negócios Fecho <x@y.pt>", "a", [fecho, outra]), null);
});

// ── Dia da edição ──────────────────────────────────────────────────────────

test("edição da noite que chega depois da meia-noite conta para o dia certo", () => {
  const noite = nl("sabado-edicao-noite"); // 21:00
  assert.equal(dataEdicao(noite, lisboa("2026-10-02", "00:30")), "2026-10-01");
  assert.equal(dataEdicao(noite, lisboa("2026-10-01", "21:05")), "2026-10-01");
  assert.equal(dataEdicao(noite, lisboa("2026-10-02", "10:00")), "2026-10-02");
});

test("edição da manhã adiantada ou atrasada fica no seu dia", () => {
  const exclusivos = nl("cm-exclusivos"); // 06:00
  assert.equal(dataEdicao(exclusivos, lisboa("2026-10-01", "05:10")), "2026-10-01");
  assert.equal(dataEdicao(exclusivos, lisboa("2026-10-01", "13:00")), "2026-10-01");
  assert.equal(dataEdicao(exclusivos, lisboa("2026-09-30", "19:00")), "2026-10-01");
});

test("mudança da hora (25/10/2026) não troca o dia", () => {
  const exclusivos = nl("cm-exclusivos");
  assert.equal(dataEdicao(exclusivos, lisboa("2026-10-25", "06:05")), "2026-10-25");
  assert.equal(dataEdicao(exclusivos, lisboa("2026-03-29", "06:05")), "2026-03-29");
});

// ── Classificação ──────────────────────────────────────────────────────────

const ctx = (extra: Partial<Parameters<typeof classificar>[0]>) => ({
  newsletter: nl("cm-exclusivos"),
  dataPrevista: "2026-10-01", // quinta-feira
  horaLimite: lisboa("2026-10-01", "07:00"),
  ocorrencias: [],
  edicaoAnterior: null,
  fechado: true,
  ...extra,
});
const oc = (hora: string, hash = "a") => ({ recebidoEm: lisboa("2026-10-01", hora), hash });

test("códigos 1 a 5", () => {
  assert.equal(classificar(ctx({ ocorrencias: [oc("06:06")] })).codigo, 1);
  assert.equal(classificar(ctx({ ocorrencias: [oc("07:30")] })).codigo, 2);
  assert.equal(classificar(ctx({ ocorrencias: [oc("06:06"), oc("06:40", "b")] })).codigo, 3);
  assert.equal(
    classificar(ctx({ ocorrencias: [oc("06:06")], edicaoAnterior: { data: "2026-09-30", hash: "a" } })).codigo,
    4,
  );
  assert.equal(classificar(ctx({})).codigo, 5);
});

test("envio fora do calendário fica assinalado no detalhe", () => {
  const capa = nl("sabado-capa"); // só à quinta
  const r = classificar(ctx({ newsletter: capa, dataPrevista: "2026-10-02", ocorrencias: [oc("08:00")] }));
  assert.equal(r.codigo, 6);
  assert.match(r.detalhe, /fora do calendário/);
});

test("corpo vazio nunca dá 'conteúdo repetido'", () => {
  const vazio = processarCorpo("").hash;
  const r = classificar(
    ctx({ ocorrencias: [oc("06:06", vazio)], edicaoAnterior: { data: "2026-09-30", hash: vazio } }),
  );
  assert.equal(r.codigo, 1);
});

// ── Leitura de emails ──────────────────────────────────────────────────────

test("email sem Message-ID nem Date não é deitado fora na leitura da caixa", () => {
  const bruto = "From: X <a@b.pt>\r\nSubject: Teste\r\nContent-Type: text/html\r\n\r\n<p>ola</p>";
  assert.throws(() => lerEml(bruto));
  const lido = lerEml(bruto, { tolerante: true });
  assert.equal(lido.internetMessageId, "");
  assert.equal(lido.assunto, "Teste");
});

// ── Fecho só com prova ─────────────────────────────────────────────────────

test("'Não Saiu' só fecha com uma leitura feita depois do limite", () => {
  const dia = "2026-10-01";
  registos.gerarDia(dia);
  const limite = lisboa(dia, "07:00"); // cm-exclusivos
  const estado = () =>
    db()
      .prepare(`SELECT fechado, codigo_estado FROM registos WHERE newsletter_id = ? AND data_prevista = ?`)
      .get("cm-exclusivos", dia) as { fechado: number; codigo_estado: number };

  // Última leitura antes do limite (PC desligado de manhã): não fecha.
  registos.fecharVencidos({ ok: lisboa(dia, "06:50"), desde: lisboa("2026-09-20", "00:00") });
  assert.equal(estado().fechado, 0);

  // Leitura logo a seguir ao limite, dentro da margem: ainda não fecha.
  registos.fecharVencidos({ ok: new Date(limite.getTime() + 5 * 60_000), desde: lisboa("2026-09-20", "00:00") });
  assert.equal(estado().fechado, 0);

  // Leitura que não cobriu o dia (janela começa depois): não fecha.
  registos.fecharVencidos({ ok: lisboa(dia, "09:00"), desde: lisboa(dia, "08:00") });
  assert.equal(estado().fechado, 0);

  // Leitura boa, depois do limite e da margem, a cobrir o dia: fecha como 5.
  registos.fecharVencidos({ ok: lisboa(dia, "09:00"), desde: lisboa("2026-09-20", "00:00") });
  assert.deepEqual(estado(), { fechado: 1, codigo_estado: 5 });
});

test("email que chega depois de fechado corrige o 'Não Saiu'", () => {
  const dia = "2026-10-01";
  const corpo = processarCorpo("<p>edição</p>");
  db()
    .prepare(
      `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html,
         corpo_normalizado, hash_conteudo, newsletter_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("m1@teste", "Correio da Manhã Exclusivos <info@news.correiodamanha.pt>", "x",
      lisboa(dia, "07:20").toISOString(), "<p>edição</p>", corpo.normalizado, corpo.hash, "cm-exclusivos");
  const r = registos.reavaliar("cm-exclusivos", dia);
  assert.equal(r?.codigo_estado, 2);
  assert.equal(r?.atraso_minutos, 20);
});
