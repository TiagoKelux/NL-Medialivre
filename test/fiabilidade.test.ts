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
const { NEWSLETTERS, estaConfigurada, newsletterPorId } = await import("../config/newsletters.ts");
const { paraInstante } = await import("../src/lib/tempo.ts");
const { db, fecharDb } = await import("../src/lib/db.ts");
const registos = await import("../src/lib/registos.ts");
const { processarCorpo } = await import("../src/lib/conteudo.ts");
const prova = await import("../src/lib/prova.ts");
const apresentacao = await import("../src/lib/apresentacao.ts");
const { PAGAS } = await import("../config/pagas.ts");
const leitura = await import("../src/lib/leitura.ts");

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

/** O bloco de publicidade que cada edição traz, como vem no HTML real. */
const anuncio = (marca: string, nome: string, barra = "/") =>
  `<a href="https://pubads.g.doubleclick.net/gampad/jump?iu=/4196/${marca}_MASTHEAD${barra}NEWSLETTER_${nome}_LEADERBOARD&sz=600x100">` +
  `<img src="https://securepubads.g.doubleclick.net/gampad/ad?iu=/4196/${marca}_MASTHEAD${barra}NEWSLETTER_${nome}_LEADERBOARD&sz=600x100"></a>`;
const corpoSemAnuncio = "<p>Continua connosco? Seguir canal. Gerir newsletters.</p>";

test("emails reais caem na newsletter certa", () => {
  const CM = "CORREIODAMANHA", NG = "JORNALDENEGOCIOS";
  const casos: [string, string, string, string | null][] = [
    ["Correio da Manhã Exclusivos <info@news.correiodamanha.pt>", "Demissões na PJ", anuncio(CM, "EXCLUSIVOS"), "cm-exclusivos"],
    ["Correio da Manhã Bom dia <info@news.correiodamanha.pt>", "Ator Chad Lowe", anuncio(CM, "BOMDIA"), "cm-bom-dia"],
    ["Correio da Manhã Boa tarde <info@news.correiodamanha.pt>", "Detido piloto", anuncio(CM, "BOATARDE", "%2F"), "cm-boa-tarde"],
    ["Vidas Geral <info@news.correiodamanha.pt>", "Identidade de psicólogo", '<img src="https://www.cmjornal.pt/i/newsletters/logo.png" alt="Vidas">', "vidas-geral"],
    ["Jornal de Negócios - 5 Coisas a Saber <info@news.jornaldenegocios.pt>", "Desemprego", anuncio(NG, "5_COISAS_A_SABER"), "negocios-5-coisas"],
    ["Jornal de Negócios Abertura <info@news.jornaldenegocios.pt>", "Ásia recupera", anuncio(NG, "ABERTURA"), "negocios-abertura"],
    ["Jornal de Negócios Opinião do Dia <info@news.jornaldenegocios.pt>", "A certeza deste OE", anuncio(NG, "OPINIAO"), "negocios-opiniao"],
    ["Jornal de Negócios Tecnologia <info@news.jornaldenegocios.pt>", "Trump", anuncio(NG, "TECNOLOGIA"), "negocios-tecnologia"],
    ["Jornal de Negócios Fecho <info@news.jornaldenegocios.pt>", "Wall Street", anuncio(NG, "FECHO"), "negocios-fecho"],
    ["Jornal de Negócios Finanças <info@news.jornaldenegocios.pt>", "CGD prepara emissão", anuncio(NG, "FINANCAS"), "negocios-financas"],
    ["Jornal de Negócios Investidor Privado <info@news.jornaldenegocios.pt>", "Mitos, erros e tabus", anuncio(NG, "INVPRIVADO"), "negocios-ip"],
    ["Jornal de Negócios Lex <info@news.jornaldenegocios.pt>", "Contribuições extraordinárias", anuncio(NG, "LEX"), "negocios-lex"],
    ["Jornal de Negócios - Sua Semana <info@news.jornaldenegocios.pt>", "A sua semana dia a dia", anuncio(NG, "SUASEMANA"), "negocios-sua-semana"],
    ["Negócios Premium - MUST <info@assinaturas.jornaldenegocios.pt>", "Inovação", '<img src="https://www.must.jornaldenegocios.pt/i/newsletters/logo.png" alt="MUST">', "must-must"],
    ["FLASH! Bom dia <info@news.flash.pt>", "Onde estão", anuncio("FLASH", "BOMDIA"), "flash-bom-dia"],
    ["FLASH! Mundo <info@news.flash.pt>", "Do estrelato", anuncio("FLASH", "MUNDO"), "flash-mundo"],
    ["FLASH! Weekend <info@news.flash.pt>", "Fim de semana", anuncio("FLASH", "WEEKEND"), "flash-weekend"],
    ["FLASH! Moda & Beleza <info@news.flash.pt>", "Vera Wang", anuncio("FLASH", "MODABELEZA"), "flash-moda-e-beleza"],
    ["FLASH! The Mag <info@news.flash.pt>", "O mundo ao contrário - THE MAG", anuncio("FLASH", "THEMAG"), "flash-the-mag"],
    ["Record Geral <info@news.jornalrecord.pt>", "Transfermarkt", anuncio("RECORD", "GERAL"), "record-geral"],
    ["Record Benfica <info@news.jornalrecord.pt>", "Transfermarkt", anuncio("RECORD", "BENFICA"), "record-benfica"],
    ["Record Sporting <info@news.jornalrecord.pt>", "João Simões", anuncio("RECORD", "SPORTING"), "record-sporting"],
    ["Record Porto <info@news.jornalrecord.pt>", "Devolvido", anuncio("RECORD", "FCPORTO"), "record-porto"],
    ["Máxima <info@news.maxima.pt>", "Os giros", anuncio("MAXIMA", "GERAL"), "maxima-geral"],
    // Fim de Semana com o nome "Máxima", igual ao da Geral: só o anúncio as separa.
    ["Máxima <info@news.maxima.pt>", "Caso Cornell", anuncio("MAXIMA", "FIM_DE_SEMANA"), "maxima-fim-de-semana"],
    ["Máxima Fim de Semana <info@news.maxima.pt>", "Caso Cornell", anuncio("MAXIMA", "FIM_DE_SEMANA"), "maxima-fim-de-semana"],
    // Grupo de controlo (paga, sem regra): a edição chegou, mas não se atribui.
    ["Record Premium <info@assinaturas.jornalrecord.pt>", "A crónica do Dinamarca-Portugal", "<p>versão online premium</p>", null],
    // Comércio afiliado: fora de âmbito.
    ["Correio da Manhã Indica <info@projetos.correiodamanha.pt>", "Este é o gadget", corpoSemAnuncio, null],
    ["FLASH! Indica <info@news.flash.pt>", "Descobrimos os ténis", corpoSemAnuncio, null],
    // Endereço desconhecido
    ["Google <no-reply@accounts.google.com>", "Alerta de segurança", corpoSemAnuncio, null],
  ];
  for (const [de, assunto, html, esperado] of casos) {
    assert.equal(corresponder(de, assunto, html)?.id ?? null, esperado, `${de} | ${assunto}`);
  }
});

test("promoções e boas-vindas não contam como 'por classificar'", () => {
  assert.ok(naoEEdicao("Bem-vinda à Máxima"));
  assert.ok(naoEEdicao("  Queremos garantir que continua connosco"));
  assert.ok(!naoEEdicao("Queremos saber a sua opinião sobre o OE"));
});

test("marketing do remetente certo, sem o bloco de publicidade, nunca é edição", () => {
  // Mesmo endereço e mesmo nome que a edição, assunto que nenhuma lista
  // conhece: sem a marca no corpo fica por atribuir.
  const casos: [string, string][] = [
    ["Correio da Manhã Bom dia <info@news.correiodamanha.pt>", "Uma novidade que ainda ninguém viu"],
    ["Jornal de Negócios Opinião do Dia <info@news.jornaldenegocios.pt>", "Sentimos a sua falta"],
    ["FLASH! Mundo <info@news.flash.pt>", "Há tanto para descobrir esta semana"],
    ["Máxima <info@news.maxima.pt>", "Temos saudades suas"],
    ["Record Geral <info@news.jornalrecord.pt>", "O desporto não para"],
    ["Vidas Geral <info@news.correiodamanha.pt>", "As melhores histórias da semana"],
  ];
  for (const [de, assunto] of casos) {
    assert.equal(corresponder(de, assunto, corpoSemAnuncio), null, `${de} | ${assunto}`);
  }
  // A edição verdadeira, do mesmo remetente, passa.
  assert.equal(
    corresponder("FLASH! Mundo <info@news.flash.pt>", "Há tanto para descobrir", anuncio("FLASH", "MUNDO"))?.id,
    "flash-mundo",
  );
});

test("o bloco de outra marca ou de outra newsletter não serve", () => {
  // NEWSLETTER_BOMDIA existe na CM e na FLASH!: a marca conta.
  assert.equal(
    corresponder("FLASH! Bom dia <info@news.flash.pt>", "x", anuncio("CORREIODAMANHA", "BOMDIA")),
    null,
  );
  // NEWSLETTER_GERAL existe no Record e na Máxima.
  assert.equal(corresponder("Máxima <info@news.maxima.pt>", "x", anuncio("RECORD", "GERAL")), null);
  // Uma newsletter sem regra (Dow Jones - Fecho) não cai na Fecho.
  assert.equal(
    corresponder(
      "Jornal de Negócios Dow Jones - Fecho <info@news.jornaldenegocios.pt>",
      "x",
      anuncio("JORNALDENEGOCIOS", "DOWJONES_FECHO"),
    ),
    null,
  );
});

test("assuntos de marketing conhecidos ficam fora, mesmo com remetente de edição", () => {
  const mundo = "FLASH! Mundo <info@news.flash.pt>";
  for (const assunto of [
    "Bem-vindo(a) à FLASH! The Mag",
    "Acompanhe as notícias mais recentes e as novidades supreendentes.",
    "Não queremos que perca as histórias, tendências e novidades que todos comentam",
  ]) {
    assert.equal(corresponder(mundo, assunto, anuncio("FLASH", "MUNDO")), null, assunto);
  }
});

test("nome do remetente, quando usado, compara-se por inteiro", () => {
  const html = '<img src="https://www.cmjornal.pt/i/newsletters/logo.png">';
  assert.equal(corresponder("Vidas Geral <info@news.correiodamanha.pt>", "x", html)?.id, "vidas-geral");
  assert.equal(corresponder("VIDAS  geral <info@news.correiodamanha.pt>", "x", html)?.id, "vidas-geral");
  assert.equal(corresponder("Vidas Geral Extra <info@news.correiodamanha.pt>", "x", html), null);
});

test("regra mais específica ganha; empate fica por atribuir", () => {
  const base = { ...nl("negocios-fecho"), remetentes: ["x@y.pt"], marcaCorpo: "", padraoRemetente: "Negócios Fecho" };
  const fecho = { ...base, id: "fecho" };
  const dj = { ...base, id: "dj-fecho", padraoAssunto: "Dow Jones" };
  const outra = { ...base, id: "outra" };
  assert.equal(corresponder("Negócios Fecho <x@y.pt>", "Dow Jones fecha em alta", "", [fecho, dj])?.id, "dj-fecho");
  assert.equal(corresponder("Negócios Fecho <x@y.pt>", "Wall Street", "", [fecho, dj])?.id, "fecho");
  assert.equal(corresponder("Negócios Fecho <x@y.pt>", "a", "", [fecho, outra]), null);
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

let seq = 0;
/** Grava um email como a recolha o faria; `nid` null = ficou por atribuir. */
const gravarEmail = (remetente: string, assunto: string, quando: Date, nid: string | null) => {
  const corpo = processarCorpo(`<p>${assunto} ${seq}</p>`);
  db()
    .prepare(
      `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html,
         corpo_normalizado, hash_conteudo, newsletter_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(`t${++seq}@teste`, remetente, assunto, quando.toISOString(), `<p>${assunto}</p>`,
      corpo.normalizado, corpo.hash, nid);
};
const registo = (nid: string, dia: string) =>
  db()
    .prepare(
      `SELECT fechado, codigo_estado, detalhe, ressalva FROM registos WHERE newsletter_id = ? AND data_prevista = ?`,
    )
    .get(nid, dia) as { fechado: number; codigo_estado: number; detalhe: string; ressalva: string | null };
/** Só o que decide o que o painel mostra. */
const estado = (nid: string, dia: string) => {
  const r = registo(nid, dia);
  return { fechado: r.fechado, codigo: r.codigo_estado, ressalva: r.ressalva };
};
const NAO_SAIU = { fechado: 1, codigo: 5, ressalva: null };
const SEM_PROVA = { fechado: 0, codigo: 5, ressalva: "sem-prova" };
/** Uma leitura boa, bem depois de todos os limites, a cobrir tudo desde setembro. */
const leituraBoa = () =>
  registos.fecharVencidos({ ok: lisboa("2026-10-14", "12:00"), desde: lisboa("2026-09-01", "00:00") });
const CM = (nome: string) => `Correio da Manhã ${nome} <info@news.correiodamanha.pt>`;

test("positivo: 'Não Saiu' só fecha com uma leitura feita depois do limite, e com prova", () => {
  const dia = "2026-10-01";
  registos.gerarDia(dia);
  // Inscrição: a edição da véspera chegou. Canário: a "Bom dia", do mesmo
  // remetente, chegou depois do limite — a caixa estava a receber do editor.
  gravarEmail(CM("Exclusivos"), "véspera", lisboa("2026-09-30", "06:05"), "cm-exclusivos");
  gravarEmail(CM("Bom dia"), "manchete", lisboa(dia, "10:00"), "cm-bom-dia");
  const limite = lisboa(dia, "07:00"); // cm-exclusivos

  // Última leitura antes do limite (PC desligado de manhã): não fecha.
  registos.fecharVencidos({ ok: lisboa(dia, "06:50"), desde: lisboa("2026-09-20", "00:00") });
  assert.equal(registo("cm-exclusivos", dia).fechado, 0);

  // Leitura logo a seguir ao limite, dentro da margem: ainda não fecha.
  registos.fecharVencidos({ ok: new Date(limite.getTime() + 5 * 60_000), desde: lisboa("2026-09-20", "00:00") });
  assert.equal(registo("cm-exclusivos", dia).fechado, 0);

  // Leitura que não cobriu o dia (janela começa depois): não fecha.
  registos.fecharVencidos({ ok: lisboa(dia, "09:00"), desde: lisboa(dia, "08:00") });
  assert.equal(registo("cm-exclusivos", dia).fechado, 0);

  // Leitura boa, depois do limite e da margem, a cobrir o dia: fecha como 5.
  registos.fecharVencidos({ ok: lisboa(dia, "12:00"), desde: lisboa("2026-09-20", "00:00") });
  assert.deepEqual(estado("cm-exclusivos", dia), NAO_SAIU);
  assert.match(registo("cm-exclusivos", dia).detalhe, /→ Não Saiu/);
});

test("email que chega depois de fechado corrige o 'Não Saiu'", () => {
  const dia = "2026-10-01";
  gravarEmail(CM("Exclusivos"), "x", lisboa(dia, "07:20"), "cm-exclusivos");
  const r = registos.reavaliar("cm-exclusivos", dia);
  assert.equal(r?.codigo_estado, 2);
  assert.equal(r?.atraso_minutos, 20);
});

// ── Prova de ausência: sem ela não há "Não Saiu" ───────────────────────────

test("(a) email por atribuir que pode ser da newsletter impede o 'Não Saiu'", () => {
  const dia = "2026-10-05";
  registos.gerarDia(dia);
  gravarEmail("Record Geral <info@news.jornalrecord.pt>", "edição anterior", lisboa("2026-10-04", "09:00"), "record-geral");
  gravarEmail("Record Sporting <info@news.jornalrecord.pt>", "canário", lisboa(dia, "11:00"), "record-sporting");
  // Mesmo endereço configurado, nome que nenhuma regra reconhece: ficou por atribuir.
  gravarEmail("Record Novidades <info@news.jornalrecord.pt>", "Hoje no Record", lisboa(dia, "09:10"), null);
  leituraBoa();
  assert.deepEqual(estado("record-geral", dia), SEM_PROVA);
  assert.match(registo("record-geral", dia).detalhe, /não se pode afirmar "Não Saiu".*por atribuir/);
});

test("(a) marketing do mesmo domínio, de outro endereço, não trava o 'Não Saiu' das gratuitas", () => {
  const dia = "2026-10-06";
  registos.gerarDia(dia);
  gravarEmail("Record Sporting <info@news.jornalrecord.pt>", "canário", lisboa(dia, "11:00"), "record-sporting");
  gravarEmail("Record Premium <info@assinaturas.jornalrecord.pt>", "Assine já com 50% de desconto", lisboa(dia, "09:10"), null);
  leituraBoa();
  assert.deepEqual(estado("record-geral", dia), NAO_SAIU);
});

test("(a) o que conta como plausível", () => {
  const geral = nl("record-geral");
  assert.ok(prova.podeSerDe(geral, "Outro Nome <info@news.jornalrecord.pt>", "x"), "mesmo endereço");
  assert.ok(prova.podeSerDe(geral, "Record Geral <novo@outro.pt>", "x"), "padrão do remetente");
  assert.ok(!prova.podeSerDe(geral, "Record Premium <info@assinaturas.jornalrecord.pt>", "x"), "só o domínio");
  assert.ok(!prova.podeSerDe(geral, "Vidas Geral <info@news.correiodamanha.pt>", "x"), "nome sem a marca");
  assert.ok(!prova.podeSerDe(geral, "Record Geral <info@news.jornalrecord.pt>", "Bem-vindo à Record"), "boas-vindas");
  const semPadrao = { ...geral, padraoRemetente: "" };
  assert.ok(prova.podeSerDe(semPadrao, "Jornal Récord <novo@outro.pt>", "O Geral de hoje"), "marca + nome, sem acentos");
});

test("(b) newsletter gratuita sem remetente configurado: nunca 'Não Saiu', nem no detalhe", () => {
  const semRemetente = { ...nl("record-geral"), remetentes: [], padraoRemetente: "" };
  const motivos = prova.motivosSemProva(semRemetente, "2026-10-06", lisboa("2026-10-06", "10:00"));
  assert.ok(motivos.some((m) => /remetente configurado/.test(m)), motivos.join(" | "));

  // As da configuração que estejam nesse caso: depois de uma leitura boa,
  // nenhuma fica "Não Saiu" e o detalhe nunca o afirma.
  const livres = NEWSLETTERS.filter((n) => n.ativa && !estaConfigurada(n) && !PAGAS.has(n.id));
  for (const n of livres) {
    const r = registo(n.id, "2026-10-06");
    if (!r || r.codigo_estado !== 5) continue;
    assert.equal(r.fechado, 0, n.id);
    assert.doesNotMatch(r.detalhe, /→ Não Saiu/, n.id);
    assert.equal(
      apresentacao.variante({ codigo: 5, fechado: false, limitePassou: true, semEmail: true, paga: false, ressalva: "sem-prova" }),
      "sem-email",
    );
  }
});

test("(c) newsletter que nunca chegou à caixa antes do dia não dá 'Não Saiu'", () => {
  registos.gerarDia("2026-10-02");
  leituraBoa();
  assert.deepEqual(estado("flash-mundo", "2026-10-02"), SEM_PROVA);
  assert.match(registo("flash-mundo", "2026-10-02").detalhe, /nunca chegou à caixa nenhum email/);

  // Chega a primeira edição a 03/10: prova a inscrição daí em diante, não antes.
  registos.gerarDia("2026-10-03");
  registos.gerarDia("2026-10-04");
  gravarEmail("FLASH! Mundo <info@news.flash.pt>", "Do estrelato", lisboa("2026-10-03", "08:00"), "flash-mundo");
  gravarEmail("FLASH! Bom dia <info@news.flash.pt>", "canário", lisboa("2026-10-04", "10:00"), "flash-bom-dia");
  registos.reavaliar("flash-mundo", "2026-10-02");
  registos.reavaliar("flash-mundo", "2026-10-03");
  leituraBoa();
  assert.deepEqual(estado("flash-mundo", "2026-10-02"), SEM_PROVA);
  assert.match(registo("flash-mundo", "2026-10-02").detalhe, /primeiro email desta newsletter na caixa é de 03\/10/);
  assert.deepEqual(estado("flash-mundo", "2026-10-04"), NAO_SAIU);
});

test("pagas: grupo de controlo — fecham e mostram 'Não Saiu', isentas das outras provas", () => {
  const dia = "2026-10-07";
  registos.gerarDia(dia);
  // Nem o marketing da própria marca, nem a falta de canário, nem nunca ter
  // chegado nada travam o 5.
  gravarEmail("Record Premium <info@assinaturas.jornalrecord.pt>", "Assine o Record Premium", lisboa(dia, "07:10"), null);
  assert.deepEqual(prova.motivosSemProva(nl("record-premium"), dia, lisboa(dia, "08:00")), []);
  leituraBoa();
  assert.deepEqual(estado("record-premium", dia), NAO_SAIU);
  assert.match(registo("record-premium", dia).detalhe, /→ Não Saiu.*Grupo de controlo/);
  // O painel e o Excel mostram 5, mesmo sem remetente configurado.
  const f = { codigo: 5 as const, fechado: true, limitePassou: false, semEmail: true, paga: true, ressalva: null };
  assert.equal(apresentacao.variante(f), "controlo");
  assert.equal(apresentacao.codigoMostrado(f), 5);
  assert.equal(apresentacao.ROTULO.controlo.texto, "Não Saiu (controlo)");
});

test("(d) intervalo sem leitura na janela: não fecha; a cobertura só encadeia sem buracos", () => {
  const { registarLeitura, coberturaDesde } = leitura;
  const dia = "2026-10-09";
  registos.gerarDia(dia);
  gravarEmail(CM("Exclusivos"), "véspera", lisboa("2026-10-08", "06:00"), "cm-exclusivos");
  gravarEmail(CM("Bom dia"), "canário", lisboa(dia, "10:00"), "cm-bom-dia");

  registarLeitura(null, lisboa("2026-10-01", "00:00"));
  assert.equal(coberturaDesde()?.toISOString(), lisboa("2026-10-01", "00:00").toISOString());
  // Uma falha não apaga a cobertura; a leitura seguinte, que começa antes da
  // anterior acabar, encadeia.
  registarLeitura(new Error("IMAP em baixo"));
  registarLeitura(null, lisboa("2026-10-08", "00:00"));
  assert.equal(coberturaDesde()?.toISOString(), lisboa("2026-10-01", "00:00").toISOString());
  // Uma leitura que só começa depois do fim da anterior deixa um buraco: a
  // cobertura recomeça nela.
  const depois = new Date(Date.now() + 60 * 60_000);
  registarLeitura(null, depois);
  assert.equal(coberturaDesde()?.toISOString(), depois.toISOString());

  // Com a cobertura a começar depois da janela do dia, nada fecha.
  registos.fecharVencidos({ ok: lisboa("2026-10-14", "12:00"), desde: coberturaDesde()! });
  assert.equal(registo("cm-exclusivos", dia).fechado, 0);
  assert.equal(
    apresentacao.variante({ codigo: 5, fechado: false, limitePassou: true, semEmail: false, paga: false, ressalva: null }),
    "por-confirmar",
  );

  // Com cobertura contínua desde antes da janela, fecha como 5.
  leituraBoa();
  assert.deepEqual(estado("cm-exclusivos", dia), NAO_SAIU);
});

test("sem canário (nada do mesmo remetente depois do limite): sem prova", () => {
  const dia = "2026-10-13";
  registos.gerarDia(dia);
  gravarEmail("Máxima <info@news.maxima.pt>", "Os giros", lisboa("2026-10-12", "09:00"), "maxima-geral");
  leituraBoa();
  assert.deepEqual(estado("maxima-geral", dia), SEM_PROVA);
  assert.match(registo("maxima-geral", dia).detalhe, /nenhum outro email do mesmo remetente/);
});

test("email de reconquista do editor nos 30 dias anteriores: sem prova", () => {
  const dia = "2026-10-13";
  const neg = (nome: string) => `Jornal de Negócios ${nome} <info@news.jornaldenegocios.pt>`;
  gravarEmail(neg("Abertura"), "Ásia", lisboa("2026-10-12", "10:30"), "negocios-abertura");
  gravarEmail(neg("Opinião do Dia"), "canário", lisboa(dia, "12:00"), "negocios-opiniao");
  gravarEmail(neg("Opinião do Dia"), "Notámos que há algum tempo que não lê as nossas newsletters",
    lisboa("2026-10-02", "15:00"), null);
  leituraBoa();
  assert.deepEqual(estado("negocios-abertura", dia), SEM_PROVA);
  assert.match(registo("negocios-abertura", dia).detalhe, /reconquista/);
});

test("3 edições diárias seguidas em falta: a terceira já não é 'Não Saiu'", () => {
  gravarEmail(CM("Boa tarde"), "véspera", lisboa("2026-10-09", "19:00"), "cm-boa-tarde");
  for (const [d, seguinte] of [["2026-10-10", "2026-10-11"], ["2026-10-11", "2026-10-12"], ["2026-10-12", "2026-10-13"]]) {
    registos.gerarDia(d);
    gravarEmail(CM("Bom dia"), "canário", lisboa(seguinte, "10:00"), "cm-bom-dia");
  }
  leituraBoa();
  assert.deepEqual(estado("cm-boa-tarde", "2026-10-10"), NAO_SAIU);
  assert.deepEqual(estado("cm-boa-tarde", "2026-10-11"), NAO_SAIU);
  assert.deepEqual(estado("cm-boa-tarde", "2026-10-12"), SEM_PROVA);
  assert.match(registo("cm-boa-tarde", "2026-10-12").detalhe, /3\.ª edição seguida/);
});

test("'Não Saiu' já fechado volta a abrir se aparecer um email que pode ser dela", () => {
  const dia = "2026-10-08";
  registos.gerarDia(dia);
  gravarEmail("Record Geral <info@news.jornalrecord.pt>", "x", lisboa("2026-10-07", "09:00"), "record-geral");
  gravarEmail("Record Sporting <info@news.jornalrecord.pt>", "canário", lisboa(dia, "11:00"), "record-sporting");
  leituraBoa();
  assert.deepEqual(estado("record-geral", dia), NAO_SAIU);
  gravarEmail("Record Geral <info@news.jornalrecord.pt>", "Bom dia", lisboa(dia, "09:05"), null);
  registos.reavaliar("record-geral", dia);
  assert.deepEqual(estado("record-geral", dia), SEM_PROVA);
});

test("primeira edição, sem anterior comparável: 'Saiu (sem termo de comparação)', não 'Atualizado'", () => {
  assert.equal(classificar(ctx({ ocorrencias: [oc("06:06")] })).semComparacao, true);
  assert.equal(
    classificar(ctx({ ocorrencias: [oc("06:06")], edicaoAnterior: { data: "2026-09-30", hash: "b" } })).semComparacao,
    false,
  );
  // flash-mundo a 03/10 foi a primeira edição de sempre.
  const r = registo("flash-mundo", "2026-10-03");
  assert.equal(r.codigo_estado, 1);
  assert.equal(r.ressalva, "sem-comparacao");
  const f = { codigo: 1 as const, fechado: true, limitePassou: false, semEmail: false, paga: false, ressalva: "sem-comparacao" as const };
  assert.equal(apresentacao.variante(f), "sem-comparacao");
  assert.equal(apresentacao.codigoMostrado(f), null);
  assert.equal(apresentacao.ROTULO["sem-comparacao"].texto, "Saiu (sem termo de comparação)");
});

test("invariante: nenhum 'Não Saiu' fechado de uma gratuita sem prova de ausência", () => {
  const todos = db()
    .prepare(`SELECT newsletter_id, data_prevista, hora_limite, detalhe FROM registos WHERE codigo_estado = 5 AND fechado = 1`)
    .all() as { newsletter_id: string; data_prevista: string; hora_limite: string; detalhe: string }[];
  assert.ok(todos.length > 0);
  for (const r of todos) {
    const n = nl(r.newsletter_id);
    if (PAGAS.has(n.id)) continue;
    assert.deepEqual(prova.motivosSemProva(n, r.data_prevista, new Date(r.hora_limite)), [], `${n.id} ${r.data_prevista}`);
  }
  // E nenhum detalhe em aberto afirma "Não Saiu".
  const abertos = db()
    .prepare(`SELECT newsletter_id, detalhe FROM registos WHERE fechado = 0`)
    .all() as { newsletter_id: string; detalhe: string }[];
  for (const r of abertos) assert.doesNotMatch(r.detalhe, /→ Não Saiu/, r.newsletter_id);
});
