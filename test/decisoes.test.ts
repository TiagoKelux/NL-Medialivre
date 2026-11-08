/**
 * As decisões de produto de 16/10/2026, uma secção por decisão:
 *   1. feriados — uma "dias úteis" não é esperada num feriado nacional;
 *   2. o calendário de cada dia congela quando o dia passa;
 *   3. edição ou não: o critério da campanha do Echobox, e as exclusões do painel;
 *   4. duplicados: só envios distintos do editor ao mesmo endereço;
 *   5. prazo: até 6 h depois da hora prevista é "Atrasada", depois é "Não Saiu".
 *   npm test
 *
 * Base de dados temporária, própria deste ficheiro.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pasta = mkdtempSync(join(tmpdir(), "nwl-decisoes-"));
process.env.DATABASE_PATH = join(pasta, "teste.db");
delete process.env.MONITOR_INICIO;
delete process.env.GMAIL_USER;
delete process.env.GMAIL_APP_PASSWORD;
delete process.env.HEALTHCHECK_URL;

const { classificar, ehDiaEsperado } = await import("../src/lib/classificacao.ts");
const { feriado, pascoa } = await import("../src/lib/feriados.ts");
const { dataEdicao } = await import("../src/lib/edicao.ts");
const { newsletterPorId } = await import("../config/newsletters.ts");
const { paraInstante } = await import("../src/lib/tempo.ts");
const { db, fecharDb } = await import("../src/lib/db.ts");
const registos = await import("../src/lib/registos.ts");
const { processarCorpo } = await import("../src/lib/conteudo.ts");
const marcas = await import("../src/lib/marcas.ts");
const prova = await import("../src/lib/prova.ts");
const regras = await import("../src/lib/regras.ts");
const apresentacao = await import("../src/lib/apresentacao.ts");
import type { Ocorrencia } from "../src/lib/classificacao.ts";
import type { Registo } from "../src/lib/tipos.ts";

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

let seq = 0;
/** Grava um email como a recolha o faria, com as marcas extraídas à entrada. Devolve o id. */
const gravar = (remetente: string, assunto: string, quando: Date, nid: string | null, html?: string) => {
  const corpoHtml = html ?? `<p>${assunto} ${++seq}</p>`;
  const corpo = processarCorpo(corpoHtml);
  const id = Number(
    db()
      .prepare(
        `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html,
           corpo_normalizado, hash_conteudo, newsletter_id, marcas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(`dec${++seq}@teste`, remetente, assunto, quando.toISOString(), corpoHtml, corpo.normalizado,
        corpo.hash, nid, JSON.stringify(marcas.extrairMarcas(corpoHtml)))
      .lastInsertRowid,
  );
  marcas.esquecerCampanhas();
  return id;
};
const registo = (nid: string, dia: string) =>
  db()
    .prepare(`SELECT * FROM registos WHERE newsletter_id = ? AND data_prevista = ?`)
    .get(nid, dia) as Registo;
const estado = (nid: string, dia: string) => {
  const r = registo(nid, dia);
  return { fechado: r.fechado, codigo: r.codigo_estado, ressalva: r.ressalva };
};
const NAO_SAIU = { fechado: 1, codigo: 5, ressalva: null };
const SEM_PROVA = { fechado: 0, codigo: 5, ressalva: "sem-prova" };
/** Uma leitura boa, bem depois de todos os prazos, a cobrir tudo desde agosto. */
const leituraBoa = () =>
  registos.fecharVencidos({ ok: lisboa("2026-10-14", "12:00"), desde: lisboa("2026-08-01", "00:00") });
const RECORD = (nome: string) => `Record ${nome} <info@news.jornalrecord.pt>`;
const CM = (nome: string) => `Correio da Manhã ${nome} <info@news.correiodamanha.pt>`;
const anuncio = (marca: string, nome: string) =>
  `<img src="https://securepubads.g.doubleclick.net/gampad/ad?iu=/4196/${marca}_MASTHEAD/NEWSLETTER_${nome}_LEADERBOARD&sz=600x100">`;

/**
 * O token "ver no browser" do Echobox, no formato real: JWT dentro de um link
 * do Amazon SES, com o "?" e o "=" codificados.
 */
const token = (campanha: string, envio: string, destino = "nlmedialivre@gmail.com") => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `${b64({ kid: "v1", typ: "JWT", alg: "RS256" })}.${b64({
    iss: "prod.email.service.echobox.com",
    "custom:key": `${campanha}/${envio}/00000000-0000-4000-8000-000000000000/recipients.parquet.email_service`,
    email: destino,
  })}.assinatura`;
  return `<a href="https://sgdbs6pn.r.eu-west-1.awstrack.me/L0/https:%2F%2Fview-mail.echobox.com%2Fviewinbrowser%3Ftoken=${jwt}/1/x">Ver no browser</a>`;
};
const uuid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;

// ── 1. Feriados ────────────────────────────────────────────────────────────

test("feriados nacionais: os fixos e os móveis (Sexta-feira Santa, Páscoa, Corpo de Deus)", () => {
  assert.equal(pascoa(2026), "2026-04-05");
  assert.equal(pascoa(2027), "2027-03-28");
  assert.equal(feriado("2026-04-03"), "Sexta-feira Santa");
  assert.equal(feriado("2026-06-04"), "Corpo de Deus");
  assert.equal(feriado("2026-10-05"), "Implantação da República");
  assert.equal(feriado("2026-12-08"), "Imaculada Conceição");
  assert.equal(feriado("2026-02-17"), null, "o Carnaval não é feriado nacional");
  assert.equal(feriado("2026-10-06"), null);
});

test("feriado sem nada recebido: uma 'dias úteis' fica 6 'não prevista', nunca 'Não Saiu'", () => {
  const fecho = nl("negocios-fecho");
  assert.equal(ehDiaEsperado(fecho, "2026-12-08"), false);
  assert.equal(ehDiaEsperado(fecho, "2026-12-09"), true);
  assert.equal(ehDiaEsperado(nl("cm-exclusivos"), "2026-12-08"), true, "as diárias não mudam");
  const dia = "2026-12-08";
  registos.gerarDia(dia);
  const r = registo("negocios-fecho", dia);
  assert.equal(r.codigo_estado, 6);
  assert.equal(r.fechado, 1);
  assert.match(r.detalhe, /Feriado nacional \(Imaculada Conceição\): não prevista/);
});

test("feriado com edição recebida: conta como qualquer outro dia (05/10: o Fecho saiu)", () => {
  // A 05/10/2026 saíram a Abertura, a Opinião, a Tecnologia e o Fecho.
  const r = classificar({
    newsletter: nl("negocios-fecho"),
    dataPrevista: "2026-10-05",
    horaLimite: lisboa("2026-10-05", "19:30"),
    ocorrencias: [{ recebidoEm: lisboa("2026-10-05", "18:33"), hash: "a" }],
    edicaoAnterior: { data: "2026-10-02", hash: "b" },
    fechado: true,
  });
  assert.equal(r.codigo, 1);
});

// ── 2. O calendário de cada dia congela ────────────────────────────────────

test("mudar o calendário no Excel não reescreve os dias passados", () => {
  const dia = "2026-09-30"; // quarta-feira: a Lex é à quinta
  registos.gerarDia(dia);
  assert.equal(registo("negocios-lex", dia).codigo_estado, 6);
  const lex = nl("negocios-lex");
  const antes = lex.diasSemana;
  lex.diasSemana = [3, 4];
  try {
    registos.reavaliar("negocios-lex", dia);
    assert.equal(registo("negocios-lex", dia).codigo_estado, 6, "a quarta passada não era dia de envio");
    assert.deepEqual(JSON.parse(registo("negocios-lex", dia).calendario!).diasSemana, [4]);
  } finally {
    lex.diasSemana = antes;
  }
});

test("um registo antigo sem calendário gravado usa o atual e passa a tê-lo", () => {
  const dia = "2026-09-29";
  registos.gerarDia(dia);
  db().prepare(`UPDATE registos SET calendario = NULL WHERE newsletter_id = 'negocios-lex' AND data_prevista = ?`).run(dia);
  registos.reavaliar("negocios-lex", dia);
  assert.equal(JSON.parse(registo("negocios-lex", dia).calendario!).periodicidade, nl("negocios-lex").periodicidade);
});

// ── 3. Edição ou não: a campanha do Echobox ────────────────────────────────

test("lerEnvio: lê campanha, envio e destino do token, com e sem codificação", () => {
  const html = token(uuid(1), uuid(2));
  assert.deepEqual(marcas.lerEnvio(html), { campanha: uuid(1), envio: uuid(2), destino: "nlmedialivre@gmail.com" });
  const simples = html.replace("%3F", "?").replace("token=", "token=");
  assert.equal(marcas.lerEnvio(simples)?.envio, uuid(2));
  assert.equal(marcas.lerEnvio("<p>sem token</p>"), null);
  assert.equal(marcas.lerEnvio("viewinbrowser?token=abc.!!!.x"), null, "token ilegível não rebenta");
});

test("campanhaDecide: a campanha da newsletter é dela, a de outra não é, sem token não é", () => {
  const geral = nl("record-geral");
  const campanhas = {
    dona: new Map([[uuid(10), "record-geral"], [uuid(11), "record-sporting"]]),
    daNewsletter: new Map([["record-geral", new Set([uuid(10)])], ["record-sporting", new Set([uuid(11)])]]),
  };
  const m = (html: string) => marcas.extrairMarcas(html);
  assert.equal(prova.campanhaDecide(geral, m(token(uuid(10), uuid(1))), campanhas), true);
  assert.equal(prova.campanhaDecide(geral, m(token(uuid(11), uuid(1))), campanhas), false, "campanha da Sporting");
  assert.equal(prova.campanhaDecide(geral, m(token(uuid(99), uuid(1))), campanhas), false, "promoção, campanha própria");
  assert.equal(prova.campanhaDecide(geral, m("<p>sem token</p>"), campanhas), false, "as edições trazem sempre token");
  assert.equal(prova.campanhaDecide(nl("record-porto"), m("<p>x</p>"), campanhas), null, "sem campanha conhecida: não decide");
});

test("as campanhas aprendem-se das edições atribuídas; uma partilhada não conta", () => {
  gravar(RECORD("Benfica"), "ed", lisboa("2026-08-03", "11:45"), "record-benfica", token(uuid(20), uuid(1)));
  gravar(RECORD("Benfica"), "ed", lisboa("2026-08-04", "11:45"), "record-benfica", token(uuid(20), uuid(2)));
  gravar(RECORD("Porto"), "ed", lisboa("2026-08-03", "11:00"), "record-porto", token(uuid(21), uuid(3)));
  gravar(RECORD("Sporting"), "ed", lisboa("2026-08-03", "11:00"), "record-sporting", token(uuid(21), uuid(4)));
  const c = marcas.lerCampanhas();
  assert.equal(c.dona.get(uuid(20)), "record-benfica");
  assert.ok(!c.dona.has(uuid(21)), "vista em duas newsletters: não serve de prova");
});

test("promoção da marca por atribuir, com campanha própria, já não trava o 'Não Saiu'", () => {
  // Record Geral: edições da campanha 30. Um "Record Indica" do mesmo
  // endereço configurado, com a campanha 31, ficava "sem prova" para sempre.
  const dia = "2026-08-12";
  registos.gerarDia(dia);
  gravar(RECORD("Geral"), "véspera", lisboa("2026-08-11", "09:03"), "record-geral",
    token(uuid(30), uuid(1)) + anuncio("RECORD", "GERAL"));
  gravar(RECORD("Sporting"), "canário", lisboa(dia, "11:05"), "record-sporting", token(uuid(32), uuid(2)));
  gravar(RECORD("Indica"), "A câmara de bolso mais desejada", lisboa(dia, "09:30"), null, token(uuid(31), uuid(3)));
  leituraBoa();
  assert.deepEqual(estado("record-geral", dia), NAO_SAIU);
});

test("email por atribuir COM a campanha da newsletter continua a travar o 'Não Saiu'", () => {
  // A marca no corpo falhou (template novo), mas a campanha é a da Geral: é
  // a edição. "Não Saiu" seria falso.
  const dia = "2026-08-13";
  registos.gerarDia(dia);
  gravar(RECORD("Sporting"), "canário", lisboa(dia, "11:05"), "record-sporting", token(uuid(32), uuid(4)));
  gravar(RECORD("Geral"), "Edição com template novo", lisboa(dia, "09:04"), null, token(uuid(30), uuid(5)));
  leituraBoa();
  assert.deepEqual(estado("record-geral", dia), SEM_PROVA);
  assert.match(registo("record-geral", dia).detalhe, /por atribuir/);
});

test("'não é newsletter' no painel deixa de travar o 'Não Saiu'", () => {
  // Sem token (newsletter sem campanha conhecida): a campanha não decide, e o
  // email do endereço configurado travava. A equipa marcou-o no painel.
  const dia = "2026-08-17";
  registos.gerarDia(dia);
  gravar(CM("Boa tarde"), "véspera", lisboa("2026-08-16", "19:00"), "cm-boa-tarde");
  gravar(CM("Bom dia"), "canário", lisboa(dia, "21:00"), "cm-bom-dia");
  const solto = gravar(CM("Novidades"), "Hoje no CM", lisboa(dia, "18:50"), null);
  leituraBoa();
  assert.deepEqual(estado("cm-boa-tarde", dia), SEM_PROVA, "pré-condição: o solto trava");
  assert.ok(regras.excluir(solto, "mensagem").ok);
  leituraBoa();
  assert.deepEqual(estado("cm-boa-tarde", dia), NAO_SAIU);
});

// ── 4. Duplicados ──────────────────────────────────────────────────────────

const exclusivos = (ocorrencias: Ocorrencia[]) =>
  classificar({
    newsletter: nl("cm-exclusivos"),
    dataPrevista: "2026-10-01",
    horaLimite: lisboa("2026-10-01", "07:00"),
    ocorrencias,
    edicaoAnterior: { data: "2026-09-30", hash: "anterior" },
    fechado: true,
  });

test("duplicada: dois envios distintos do editor ao mesmo endereço (Máxima 02/10)", () => {
  const r = exclusivos([
    { recebidoEm: lisboa("2026-10-01", "06:03"), hash: "a", envio: uuid(1), destino: "nlmedialivre@gmail.com" },
    { recebidoEm: lisboa("2026-10-01", "06:33"), hash: "b", envio: uuid(2), destino: "nlmedialivre@gmail.com" },
  ]);
  assert.equal(r.codigo, 3);
  assert.match(r.detalhe, /ids de envio diferentes/);
});

test("não é duplicada: o mesmo envio entregue duas vezes", () => {
  const r = exclusivos([
    { recebidoEm: lisboa("2026-10-01", "06:03"), hash: "a", envio: uuid(1), destino: "nlmedialivre@gmail.com" },
    { recebidoEm: lisboa("2026-10-01", "06:04"), hash: "a", envio: uuid(1), destino: "nlmedialivre@gmail.com" },
  ]);
  assert.equal(r.codigo, 1);
  assert.equal(r.nrOcorrencias, 1);
  assert.match(r.detalhe, /chegou 2 vezes — conta como um/);
});

test("não é duplicada: a caixa inscrita com dois endereços (o Gmail ignora os pontos)", () => {
  const r = exclusivos([
    { recebidoEm: lisboa("2026-10-01", "06:03"), hash: "a", envio: uuid(1), destino: "nlmedialivre@gmail.com" },
    { recebidoEm: lisboa("2026-10-01", "06:03"), hash: "a", envio: uuid(2), destino: "nl.medialivre@gmail.com" },
  ]);
  assert.equal(r.codigo, 1);
  assert.match(r.detalhe, /inscrita mais de uma vez/);
});

test("sem token, dois Message-ID diferentes continuam a ser 'Duplicada'", () => {
  const r = exclusivos([
    { recebidoEm: lisboa("2026-10-01", "06:03"), hash: "a" },
    { recebidoEm: lisboa("2026-10-01", "06:33"), hash: "b" },
  ]);
  assert.equal(r.codigo, 3);
});

test("de ponta a ponta: duas edições do mesmo envio na base dão uma ocorrência", () => {
  const dia = "2026-08-20";
  registos.gerarDia(dia);
  const html = token(uuid(40), uuid(41)) + anuncio("CORREIODAMANHA", "EXCLUSIVOS");
  gravar(CM("Exclusivos"), "Manchete", lisboa(dia, "06:02"), "cm-exclusivos", html);
  gravar(CM("Exclusivos"), "Manchete", lisboa(dia, "06:02"), "cm-exclusivos", html);
  const r = registos.reavaliar("cm-exclusivos", dia)!;
  assert.notEqual(r.codigo_estado, 3);
  assert.equal(r.nr_ocorrencias, 1);
});

// ── 5. Regra do cliente (08/11): 30 min, depois "saiu tarde" ────────────────

test("depois da janela de 30 min é 'Saiu Atrasada' (tarde)", () => {
  const r = exclusivos([{ recebidoEm: lisboa("2026-10-01", "11:30"), hash: "a" }]);
  assert.equal(r.codigo, 2);
  assert.match(r.detalhe, /saiu tarde/);
});

test("13 h depois continua a ser 'Saiu Atrasada' — um email que chegou nunca é 'Não Saiu'", () => {
  const r = exclusivos([{ recebidoEm: lisboa("2026-10-01", "19:00"), hash: "a" }]);
  assert.equal(r.codigo, 2);
  assert.match(r.detalhe, /Recebida às 19:00.*saiu tarde/);
  assert.equal(dataEdicao(nl("cm-exclusivos"), lisboa("2026-10-01", "19:00")), "2026-10-01", "não passa para o dia seguinte");
});

test("a das 21:00 que chega às 00:30 do dia seguinte é 'Atrasada' no seu dia", () => {
  const noite = nl("sabado-edicao-noite");
  assert.equal(dataEdicao(noite, lisboa("2026-10-02", "00:30")), "2026-10-01");
  const r = classificar({
    newsletter: noite,
    dataPrevista: "2026-10-01",
    horaLimite: registos.horaLimiteDe(noite, "2026-10-01"),
    ocorrencias: [{ recebidoEm: lisboa("2026-10-02", "00:30"), hash: "a" }],
    edicaoAnterior: null,
    fechado: true,
  });
  assert.equal(r.codigo, 2);
});

test("de ponta a ponta: chegou 13 h depois → 'Saiu Atrasada', e não contamina o dia seguinte", () => {
  const dia = "2026-08-24";
  registos.gerarDia(dia);
  registos.gerarDia("2026-08-25");
  gravar(CM("Exclusivos"), "atrasada 13 h", lisboa(dia, "19:00"), "cm-exclusivos");
  leituraBoa();
  assert.equal(registo("cm-exclusivos", dia).codigo_estado, 2);
  assert.equal(registo("cm-exclusivos", "2026-08-25").nr_ocorrencias, 0);
});

test("semanal que sai 3 dias depois: o 'Não Saiu' passa a 'Saiu Atrasada' retroativamente", () => {
  // flash-weekend: à quinta, 07:00.
  const n = nl("flash-weekend");
  assert.deepEqual(n.diasSemana, [4]);
  const quinta = "2026-08-27";
  registos.gerarDia(quinta);
  registos.gerarDia("2026-08-28");
  registos.gerarDia("2026-08-29");
  registos.gerarDia("2026-08-30");
  // Chega no domingo (3 dias depois): não é dia de envio, conta para a de quinta.
  gravar("FLASH! Weekend <info@news.flash.pt>", "fim de semana", lisboa("2026-08-30", "10:00"), "flash-weekend");
  registos.reavaliar("flash-weekend", quinta);
  const r = registo("flash-weekend", quinta);
  assert.equal(r.codigo_estado, 2);
  assert.match(r.detalhe, /Recebida às 10:00 de 30\/08.*saiu tarde/);
  // Mas se a de quinta tivesse chegado, o de domingo não a tornava duplicada.
  const quinta2 = "2026-09-03";
  registos.gerarDia(quinta2);
  for (const d of ["2026-09-04", "2026-09-05", "2026-09-06"]) registos.gerarDia(d);
  gravar("FLASH! Weekend <info@news.flash.pt>", "a horas", lisboa(quinta2, "07:05"), "flash-weekend");
  gravar("FLASH! Weekend <info@news.flash.pt>", "extra", lisboa("2026-09-06", "10:00"), "flash-weekend");
  registos.reavaliar("flash-weekend", quinta2);
  assert.equal(registo("flash-weekend", quinta2).codigo_estado, 1);
});

test("depois do limite (+30 min) e da margem, uma leitura que cobre o dia fecha", () => {
  const dia = "2026-08-26";
  registos.gerarDia(dia);
  // Antes do limite (06:30) + margem: não fecha.
  registos.fecharVencidos({ ok: lisboa(dia, "06:35"), desde: lisboa("2026-08-01", "00:00") });
  assert.equal(registo("cm-exclusivos", dia).fechado, 0);
  assert.equal(
    apresentacao.variante({ codigo: 5, fechado: false, limitePassou: true, semEmail: false, paga: false, ressalva: null }),
    "por-confirmar",
  );
});

// ── 3b. Rede de segurança da campanha ──────────────────────────────────────

test("com cara de edição (bloco de publicidade ou marca), a campanha nunca descarta", () => {
  const geral = nl("record-geral");
  const campanhas = {
    dona: new Map([[uuid(10), "record-geral"], [uuid(11), "record-sporting"]]),
    daNewsletter: new Map([["record-geral", new Set([uuid(10)])], ["record-sporting", new Set([uuid(11)])]]),
  };
  const m = (html: string) => marcas.extrairMarcas(html);
  // Campanha nova, mas com o bloco de publicidade da Geral: template novo.
  assert.equal(prova.campanhaDecide(geral, m(token(uuid(98), uuid(1)) + anuncio("RECORD", "GERAL2")), campanhas), null);
  // Sem token, mas com a marca configurada: o Echobox mudou o link.
  assert.equal(prova.campanhaDecide(geral, m(anuncio("RECORD", "GERAL")), campanhas), null);
  // Campanha de outra newsletter com cara de edição: na dúvida, não descarta.
  assert.equal(prova.campanhaDecide(geral, m(token(uuid(11), uuid(1)) + anuncio("RECORD", "X")), campanhas), null);
});

test("edição com template novo (campanha nova + bloco de publicidade) continua a travar o 'Não Saiu'", () => {
  const dia = "2026-08-14";
  registos.gerarDia(dia);
  gravar(RECORD("Sporting"), "canário", lisboa(dia, "11:05"), "record-sporting", token(uuid(32), uuid(6)));
  gravar(RECORD("Geral"), "Edição", lisboa(dia, "09:04"), null, token(uuid(97), uuid(7)) + anuncio("RECORD", "GERALNOVA"));
  leituraBoa();
  assert.deepEqual(estado("record-geral", dia), SEM_PROVA);
});

// ── 2b. Corrigir o passado de propósito ────────────────────────────────────

test("descongelar aplica o calendário atual aos dias pedidos, e só a esses", async () => {
  const { descongelar } = await import("../src/lib/calendario.ts");
  const quarta = "2026-09-16";
  const outra = "2026-09-23";
  registos.gerarDia(quarta);
  registos.gerarDia(outra);
  const lex = nl("negocios-lex");
  const antes = lex.diasSemana;
  lex.diasSemana = [3, 4];
  try {
    assert.equal(descongelar("negocios-lex", quarta, quarta), 1);
    registos.reavaliar("negocios-lex", quarta);
    registos.reavaliar("negocios-lex", outra);
    assert.notEqual(registo("negocios-lex", quarta).codigo_estado, 6, "o dia pedido passou a ser esperado");
    assert.equal(registo("negocios-lex", outra).codigo_estado, 6, "os outros ficam como estavam");
  } finally {
    lex.diasSemana = antes;
    descongelar("negocios-lex", quarta, quarta);
    registos.reavaliar("negocios-lex", quarta);
  }
});

test("as edições seguidas em falta contam pelo calendário de cada dia", async () => {
  const { esperadoNoDia } = await import("../src/lib/calendario.ts");
  const quarta = "2026-09-09";
  registos.gerarDia(quarta);
  const lex = nl("negocios-lex");
  const antes = lex.diasSemana;
  lex.diasSemana = [3, 4];
  try {
    assert.equal(esperadoNoDia(lex, quarta), false, "nessa quarta a Lex não era esperada");
  } finally {
    lex.diasSemana = antes;
  }
});

// ── Abrir os emails, para o editor não cortar a caixa ──────────────────────

test("abertura: só o pixel do SES (I0), nunca links nem outras imagens", async () => {
  const { pixelDeAbertura, marcarAbertos } = await import("../src/lib/abertura.ts");
  const pixel = "https://sgdbs6pn.r.eu-west-1.awstrack.me/I0/010201a0ecd8543f-db5bc714/abc=473";
  const html =
    `<a href="https://sgdbs6pn.r.eu-west-1.awstrack.me/L0/https:%2F%2Fwww.flash.pt/1/x">link</a>` +
    `<img src="https://cdn.flash.pt/foto.jpg"><img alt="" src="${pixel}" width="1" height="1">`;
  assert.equal(pixelDeAbertura(html), pixel);
  assert.equal(pixelDeAbertura("<img src='https://x.pt/a.png'>"), null);
  const pedidos: string[] = [];
  const n = await marcarAbertos([html, "<p>sem pixel</p>"], async (u) => (pedidos.push(u), { ok: true }));
  assert.equal(n, 1);
  assert.deepEqual(pedidos, [pixel]);
  // Uma falha de rede não rebenta.
  assert.equal(await marcarAbertos([html], async () => { throw new Error("rede"); }), 0);
  process.env.MARCAR_ABERTURA = "0";
  try {
    assert.equal(await marcarAbertos([html], async () => ({ ok: true })), 0);
  } finally {
    delete process.env.MARCAR_ABERTURA;
  }
});
