/**
 * Revisão adversarial: cenários em que o painel afirmava um estado sem prova,
 * mudava de estado sem razão, ou rebentava. Cada teste descreve o cenário e o
 * efeito no painel. Os marcados `todo` são decisões de produto em aberto.
 *   npm test
 *
 * Base de dados temporária, própria deste ficheiro.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pasta = mkdtempSync(join(tmpdir(), "nwl-revisao-"));
process.env.DATABASE_PATH = join(pasta, "teste.db");
delete process.env.MONITOR_INICIO;
delete process.env.GMAIL_USER;
delete process.env.GMAIL_APP_PASSWORD;
delete process.env.HEALTHCHECK_URL;

const { corresponder } = await import("../src/lib/correspondencia.ts");
const { dataEdicao } = await import("../src/lib/edicao.ts");
const { ehDiaEsperado } = await import("../src/lib/classificacao.ts");
const { lerEml } = await import("../src/lib/eml.ts");
const { newsletterPorId } = await import("../config/newsletters.ts");
const { paraInstante, dataLocal } = await import("../src/lib/tempo.ts");
const { db, fecharDb } = await import("../src/lib/db.ts");
const registos = await import("../src/lib/registos.ts");
const conteudo = await import("../src/lib/conteudo.ts");
const { processarCorpo } = conteudo;
const marcas = await import("../src/lib/marcas.ts");
const recolha = await import("../src/lib/recolha.ts");
const regras = await import("../src/lib/regras.ts");
const apresentacao = await import("../src/lib/apresentacao.ts");
import type { MensagemGraph } from "../src/lib/graph/mail.ts";
import type { Newsletter } from "../src/lib/tipos.ts";

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
/** Grava um email como a recolha o faria (sem marcas: extraem-se quando preciso). Devolve o id. */
const gravar = (remetente: string, assunto: string, quando: Date, nid: string | null, html?: string) => {
  const corpoHtml = html ?? `<p>${assunto} ${++seq}</p>`;
  const corpo = processarCorpo(corpoHtml);
  return Number(
    db()
      .prepare(
        `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html,
           corpo_normalizado, hash_conteudo, newsletter_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(`rev${++seq}@teste`, remetente, assunto, quando.toISOString(), corpoHtml, corpo.normalizado, corpo.hash, nid)
      .lastInsertRowid,
  );
};
const registo = (nid: string, dia: string) =>
  db()
    .prepare(`SELECT fechado, codigo_estado, detalhe, ressalva FROM registos WHERE newsletter_id = ? AND data_prevista = ?`)
    .get(nid, dia) as { fechado: number; codigo_estado: number; detalhe: string; ressalva: string | null };
const estado = (nid: string, dia: string) => {
  const r = registo(nid, dia);
  return { fechado: r.fechado, codigo: r.codigo_estado, ressalva: r.ressalva };
};
const nidDe = (id: number) =>
  (db().prepare(`SELECT newsletter_id FROM emails WHERE id = ?`).get(id) as { newsletter_id: string | null }).newsletter_id;
const NAO_SAIU = { fechado: 1, codigo: 5, ressalva: null };
const SEM_PROVA = { fechado: 0, codigo: 5, ressalva: "sem-prova" };
/** Uma leitura boa, bem depois de todos os limites, a cobrir tudo desde agosto. */
const leituraBoa = () =>
  registos.fecharVencidos({ ok: lisboa("2026-10-14", "12:00"), desde: lisboa("2026-08-01", "00:00") });
const RECORD = (nome: string) => `Record ${nome} <info@news.jornalrecord.pt>`;
const anuncio = (marca: string, nome: string) =>
  `<img src="https://securepubads.g.doubleclick.net/gampad/ad?iu=/4196/${marca}_MASTHEAD/NEWSLETTER_${nome}_LEADERBOARD&sz=600x100">`;
/** Campanha de CRM do editor: imagens do editor de campanhas, texto curto, sem bloco de publicidade. */
const corpoCrm =
  '<img src="https://assets.unlayer.com/a.png"><img src="https://assets.unlayer.com/b.png">' +
  '<img src="https://assets.unlayer.com/c.png"><p>Continue a acompanhar o desporto connosco.</p>';

// ── Leitura da caixa: "Não recebida" só depois de a caixa ser lida ─────────

test("sem nenhuma leitura da caixa depois do limite, o painel diz 'Por confirmar', não 'Não recebida'", () => {
  // Cenário: o servidor arranca depois de uma paragem (ou a palavra-passe foi
  // revogada). O arranque reavalia 45 dias ANTES de ler a caixa; o registo
  // ficava com a ressalva "sem-prova" — "Não recebida – sem prova" — quando o
  // email pode estar na caixa por ler.
  const dia = "2026-09-29";
  registos.gerarDia(dia);
  registos.reavaliar("cm-exclusivos", dia);
  const r = registo("cm-exclusivos", dia);
  assert.equal(r.fechado, 0);
  assert.equal(r.ressalva, null, r.detalhe);
  assert.match(r.detalhe, /Por confirmar/);
  const v = apresentacao.variante({
    codigo: 5, fechado: false, limitePassou: true, semEmail: false, paga: false, ressalva: r.ressalva as null,
  });
  assert.equal(v, "por-confirmar");
});

// ── Fuso ───────────────────────────────────────────────────────────────────

const tempoTs = pathToFileURL(fileURLToPath(new URL("../src/lib/tempo.ts", import.meta.url))).href;
const correrComTZ = (tz: string) =>
  execFileSync(
    process.execPath,
    ["--input-type=module", "-e",
      `const m = await import(${JSON.stringify(tempoTs)}); ` +
      `console.log(m.dataLocal(new Date("2026-10-15T23:30:00Z")) + " " + m.horaLocal(new Date("2026-10-15T23:30:00Z")));`],
    { env: { ...process.env, TZ: tz }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

test("o fuso do negócio é sempre Lisboa, seja qual for o TZ do servidor", () => {
  // 23:30 UTC de 15/10 são 00:30 de 16/10 em Lisboa. Com TZ=UTC no servidor
  // (o normal num Linux), todas as janelas e limites andavam uma hora.
  assert.equal(correrComTZ("UTC"), "2026-10-16 00:30");
  assert.equal(correrComTZ("Europe/Lisbon"), "2026-10-16 00:30");
});

test("TZ=':/etc/localtime' (comum em servidores) não rebenta o arranque", () => {
  // O Intl não aceita esse valor como fuso: o import de tempo.ts lançava
  // RangeError e o processo inteiro caía.
  assert.equal(correrComTZ(":/etc/localtime"), "2026-10-16 00:30");
});

// ── Geração do dia ─────────────────────────────────────────────────────────

test("o ciclo gera o dia mesmo que o job das 00h05 não tenha corrido", async () => {
  // Cenário: o PC/servidor estava suspenso às 00h05 (o node-cron não repete
  // execuções perdidas) e o processo não reiniciou. Sem registos, hoje não
  // aparece no painel e nada fecha até alguém reiniciar.
  const hoje = dataLocal();
  db().prepare(`DELETE FROM registos WHERE data_prevista = ?`).run(hoje);
  const { correrCiclo } = await import("../src/lib/ciclo.ts");
  await correrCiclo();
  const n = (db().prepare(`SELECT COUNT(*) AS n FROM registos WHERE data_prevista = ?`).get(hoje) as { n: number }).n;
  assert.ok(n > 0, "registos de hoje criados pelo ciclo");
});

// ── Fecho: um 6 que passa a 5 não herda o "fechado" ────────────────────────

test("newsletter reativada (6 → 5) não herda o 'fechado' do 6 nem diz 'Não Saiu' antes do limite", () => {
  // O 6 nasce fechado. Ativá-la (ou mudar o calendário no Excel) e reavaliar
  // dava um 5 já fechado — "Não Saiu" — sem leitura nenhuma da caixa, mesmo
  // num dia cujo limite ainda não chegou.
  const dia = "2030-01-08";
  registos.gerarDia(dia);
  assert.equal(registo("record-euro", dia).codigo_estado, 6);
  const euro = nl("record-euro");
  euro.ativa = true;
  try {
    registos.reavaliar("record-euro", dia);
    const r = registo("record-euro", dia);
    assert.equal(r.codigo_estado, 5);
    assert.equal(r.fechado, 0, "fica em aberto até haver leitura e prova");
    assert.doesNotMatch(r.detalhe, /Não Saiu/);
  } finally {
    euro.ativa = false;
  }
  registos.reavaliar("record-euro", dia);
  assert.deepEqual(estado("record-euro", dia), { fechado: 1, codigo: 6, ressalva: null });
});

test("um 5 fechado cujo limite passou a ser no futuro (hora prevista mudada) volta a abrir", () => {
  const dia = "2030-01-08";
  db().prepare(`UPDATE registos SET fechado = 1 WHERE newsletter_id = 'record-premium' AND data_prevista = ?`).run(dia);
  registos.reavaliar("record-premium", dia);
  const r = registo("record-premium", dia);
  assert.equal(r.fechado, 0);
  assert.doesNotMatch(r.detalhe, /Não Saiu/);
});

// ── Prova de ausência: o canário ───────────────────────────────────────────

test("a própria campanha de reconquista não serve de canário (chega depois do limite)", () => {
  // O editor corta a caixa e manda a campanha de reconquista à tarde (redação
  // nova, reconhecida pela estrutura). A regra da reconquista só olhava para
  // trás do limite; a própria campanha, depois do limite, era aceite como
  // canário → "Não Saiu" fechado.
  const dia = "2026-09-15";
  registos.gerarDia(dia);
  gravar("Máxima <info@news.maxima.pt>", "véspera", lisboa("2026-09-14", "09:00"), "maxima-geral");
  gravar("Máxima <info@news.maxima.pt>", "Temos novidades para si", lisboa(dia, "15:00"), null, corpoCrm);
  leituraBoa();
  assert.deepEqual(estado("maxima-geral", dia), SEM_PROVA);
  assert.match(registo("maxima-geral", dia).detalhe, /reconquista/);
});

test("uma edição de outra newsletter do mesmo editor continua a servir de canário", () => {
  const dia = "2026-09-09";
  registos.gerarDia(dia);
  gravar(RECORD("Geral"), "véspera", lisboa("2026-09-08", "09:00"), "record-geral");
  gravar(RECORD("Sporting"), "canário", lisboa(dia, "11:00"), "record-sporting");
  leituraBoa();
  assert.deepEqual(estado("record-geral", dia), NAO_SAIU);
});

// ── Um email por atribuir que chega depois do fecho ────────────────────────

const mensagem = (id: string, remetente: string, assunto: string, quando: Date, html = "<p>x</p>"): MensagemGraph => ({
  internetMessageId: id,
  receivedDateTime: quando.toISOString(),
  from: { emailAddress: { address: remetente } },
  subject: assunto,
  body: { contentType: "html", content: html },
});

test("email por atribuir que pode ser dela, lido depois do fecho, reabre o 'Não Saiu'", async () => {
  // O "Não Saiu" fecha com o canário (Benfica às 12:10). A edição do Porto
  // chega às 14:00 — ainda dentro da janela — com um nome que nenhuma regra
  // conhece, e fica por atribuir. A recolha só reavaliava as newsletters dos
  // emails atribuídos: o "Não Saiu" ficava, contra a regra 4 da prova.
  const dia = "2026-09-22";
  registos.gerarDia(dia);
  gravar(RECORD("Porto"), "véspera", lisboa("2026-09-21", "11:00"), "record-porto");
  gravar(RECORD("Benfica"), "canário", lisboa(dia, "12:10"), "record-benfica");
  leituraBoa();
  assert.deepEqual(estado("record-porto", dia), NAO_SAIU, "pré-condição");

  await recolha.recolher(24, async () => [
    mensagem("solto-porto@teste", RECORD("Dragões"), "Hoje no Record", lisboa(dia, "14:00")),
  ]);
  assert.deepEqual(estado("record-porto", dia), SEM_PROVA);
  assert.match(registo("record-porto", dia).detalhe, /por atribuir/);
});

// ── Marcas guardadas depois de uma regra do painel ─────────────────────────

test("regra do painel com marca nova reconhece também os emails guardados antes dela", () => {
  // As marcas guardadas levam a impressão digital das marcas configuradas. A
  // impressão ficava em cache pela LISTA (o array), e a regra do painel muda
  // os objetos, não o array: a impressão não mudava, as marcas antigas
  // (sem a marca nova) passavam por atuais e a semana anterior nunca era
  // reconhecida — "Não recebida" onde chegou.
  const SAB = "Sábado <info@news.sabado.pt>";
  const html = `<p>as mais lidas</p>${anuncio("SABADO", "MAISLIDAS")}`;
  const antiga = gravar(SAB, "As mais lidas da semana passada", lisboa("2026-09-18", "16:35"), null, html);
  const nova = gravar(SAB, "As mais lidas", lisboa("2026-09-25", "16:35"), null, html);
  marcas.garantirMarcas(); // a recolha extrai à entrada, antes de haver regra
  const r = regras.atribuir(nova, "sabado-as-mais-lidas", "/4196/SABADO_MASTHEAD/NEWSLETTER_MAISLIDAS_LEADERBOARD");
  assert.ok(r.ok, r.mensagem);
  assert.equal(nidDe(nova), "sabado-as-mais-lidas");
  assert.equal(nidDe(antiga), "sabado-as-mais-lidas");
});

// ── Correspondência ────────────────────────────────────────────────────────

test("email com as marcas de duas newsletters diferentes fica por atribuir, não vai para a de nome mais comprido", () => {
  // A "especificidade" é o comprimento do texto exigido. Com duas marcas
  // diferentes no mesmo corpo, ganhava a de nome mais longo — um palpite.
  const base = { ...nl("negocios-lex"), remetentes: ["x@y.pt"], padraoRemetente: "", padraoAssunto: "" };
  const a: Newsletter = { ...base, id: "a", marcaCorpo: "/4196/X_MASTHEAD/NEWSLETTER_A_LEADERBOARD" };
  const b: Newsletter = { ...base, id: "b", marcaCorpo: "/4196/X_MASTHEAD/NEWSLETTER_BBBBBB_LEADERBOARD" };
  const so = (nome: string) => anuncio("X", nome);
  assert.equal(corresponder("X <x@y.pt>", "s", so("A"), [a, b])?.id, "a");
  assert.equal(corresponder("X <x@y.pt>", "s", so("BBBBBB"), [a, b])?.id, "b");
  assert.equal(corresponder("X <x@y.pt>", "s", so("A") + so("BBBBBB"), [a, b]), null);
  // A mesma marca com um critério a mais continua a desempatar.
  const a2: Newsletter = { ...a, id: "a2", padraoAssunto: "Especial" };
  assert.equal(corresponder("X <x@y.pt>", "Especial de hoje", so("A"), [a, a2])?.id, "a2");
});

// ── MIME ───────────────────────────────────────────────────────────────────

test("cabeçalhos em UTF-8 cru (sem =?UTF-8?…?=) não ficam com o nome estragado", () => {
  // A fonte IMAP lê-se em latin1; um "From: Máxima" em UTF-8 cru dava
  // "MÃ¡xima", e o nome do remetente deixava de bater.
  const bruto = Buffer.from(
    "From: Negócios Premium - MUST <info@assinaturas.jornaldenegocios.pt>\r\n" +
      "Subject: Inovação já\r\nMessage-ID: <a@b>\r\nDate: Wed, 14 Oct 2026 16:30:00 +0100\r\n" +
      "Content-Type: text/html; charset=utf-8\r\n\r\n<p>olá</p>",
    "utf8",
  ).toString("latin1");
  const lido = lerEml(bruto, { tolerante: true });
  assert.equal(lido.remetente, "Negócios Premium - MUST <info@assinaturas.jornaldenegocios.pt>");
  assert.equal(lido.assunto, "Inovação já");
  assert.equal(lido.corpoHtml, "<p>olá</p>");
  // Latin-1 cru verdadeiro continua a ler-se como latin1.
  const latin = Buffer.from("Subject: Inova\xe7\xe3o\r\n\r\nx", "latin1").toString("latin1");
  assert.equal(lerEml(latin, { tolerante: true }).assunto, "Inovação");
});

// ── HTML patológico ────────────────────────────────────────────────────────

test("HTML mal fechado não bloqueia o processo (tempo linear)", () => {
  // Muitas etiquetas por fechar ("<img " sem ">", "<!--" sem "-->") faziam as
  // expressões regulares voltar ao fim do texto a cada uma: 500 KB = 70 s
  // com o servidor parado.
  for (const html of ["<img ".repeat(40_000), "<!-- ".repeat(40_000) + "x", "<style>".repeat(30_000), "<a ".repeat(40_000)]) {
    const t = performance.now();
    processarCorpo(html);
    conteudo.extrairArtigos(html);
    marcas.extrairMarcas(html);
    const ms = performance.now() - t;
    assert.ok(ms < 1500, `${html.slice(0, 6)}…: ${Math.round(ms)} ms`);
  }
  // E o resultado do HTML normal não muda.
  const normal = `<html><head><style>p{}</style></head><body><!-- c --><p>Olá <b>mundo</b></p>` +
    `<img src="https://x.pt/a.jpg?w=1" alt="capa"><a href="https://www.cmjornal.pt/a/b-c-d">x</a></body></html>`;
  assert.equal(processarCorpo(normal).normalizado, "olá mundo x\n[img] https://x.pt/a.jpg capa");
  assert.equal(marcas.comprimentoTexto(normal), "Olá mundo x".length);
});

test("exportar com um 'ate' mal formado não rebenta", async () => {
  const { GET } = await import("../src/app/api/exportar/route.ts");
  const r = GET(new Request("http://localhost/api/exportar?vista=diaria&ate=abc"));
  assert.equal(r.status, 200);
});

test("mudança da hora: limite e dia da edição certos em 25/10/2026 e 28/03/2027", () => {
  // Manhã, noite, tolerância longa e domingo: um email 5 min depois da hora
  // prevista, no dia da mudança e nos vizinhos, conta para esse dia, e o
  // limite é a hora prevista + tolerância na hora local desse dia.
  // (Fica de fora, conhecido: a fronteira da janela, ±12 h, anda 1 h nesses dias.)
  const amostra = ["cm-exclusivos", "sabado-edicao-noite", "negocios-valor-acrescentado", "negocios-sua-semana"].map(nl);
  for (const dia of ["2026-10-24", "2026-10-25", "2026-10-26", "2027-03-27", "2027-03-28", "2027-03-29"]) {
    for (const n of amostra) {
      const recebido = new Date(lisboa(dia, n.horaPrevista).getTime() + 5 * 60_000);
      assert.equal(dataEdicao(n, recebido), dia, `${n.id} ${dia}`);
      const limite = registos.horaLimiteDe(n, dia);
      const [h, m] = n.horaPrevista.split(":").map(Number);
      const esperado = `${String(Math.floor((h * 60 + m + n.toleranciaMinutos) / 60) % 24).padStart(2, "0")}:${String((m + n.toleranciaMinutos) % 60).padStart(2, "0")}`;
      assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(limite), esperado, `${n.id} ${dia}`);
    }
  }
});

// ── Decisões de produto em aberto ──────────────────────────────────────────
// (As decididas a 16/10 — feriados, calendário, prazo de 6 h, duplicados e
// "não é newsletter" — estão em test/decisoes.test.ts.)

test("'dia do mês' 31 (ou 29/30) em meses curtos", {
  todo: "decisão: diasMes [31] nunca é esperado em fevereiro, abril…; falta dizer se é 'último dia do mês'",
}, () => {
  const fim = { ...nl("sabado-o-melhor-do-mes"), diasMes: [31] };
  assert.equal(ehDiaEsperado(fim, "2027-02-28"), true);
});

test("promoção do editor (FLASH! Indica) não prova que a caixa recebe as edições", {
  todo: "decisão: o canário aceita qualquer email do mesmo domínio que não seja marketing de CRM; " +
    "as promoções de comércio afiliado continuam a contar",
}, () => {
  const dia = "2026-09-24";
  registos.gerarDia(dia);
  gravar("FLASH! Mundo <info@news.flash.pt>", "véspera", lisboa("2026-09-23", "08:00"), "flash-mundo");
  // Às 21:00: fora da janela da Mundo (08:00 ± 12 h), dentro das 24 h do canário.
  gravar("FLASH! Indica <info@news.flash.pt>", "Descobrimos os ténis", lisboa(dia, "21:00"), null);
  leituraBoa();
  assert.deepEqual(estado("flash-mundo", dia), SEM_PROVA);
});

test("dois emails diferentes com o mesmo Message-ID contam os dois", {
  todo: "decisão: a deduplicação é só pelo Message-ID; um reenvio corrigido (ou um ESP que repita o ID) " +
    "perde-se em silêncio — e a leitura IMAP nem descarrega o segundo",
}, async () => {
  const quando = lisboa("2026-09-25", "10:00");
  await recolha.recolher(24, async () => [
    mensagem("repetido@teste", RECORD("Geral"), "Edição", quando, anuncio("RECORD", "GERAL")),
    mensagem("repetido@teste", RECORD("Sporting"), "Outra", quando, anuncio("RECORD", "SPORTING")),
  ]);
  const n = (db().prepare(`SELECT COUNT(*) AS n FROM emails WHERE internet_message_id LIKE 'repetido@teste%'`).get() as { n: number }).n;
  assert.equal(n, 2);
});
