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
const conteudo = await import("../src/lib/conteudo.ts");
const { processarCorpo } = conteudo;
const { datasNoEmail } = await import("../src/lib/datas.ts");
const prova = await import("../src/lib/prova.ts");
const apresentacao = await import("../src/lib/apresentacao.ts");
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
  // Janela: 6 h antes a 18 h depois da hora prevista.
  const noite = nl("sabado-edicao-noite"); // 21:00
  assert.equal(dataEdicao(noite, lisboa("2026-10-02", "00:30")), "2026-10-01");
  assert.equal(dataEdicao(noite, lisboa("2026-10-01", "21:05")), "2026-10-01");
  assert.equal(dataEdicao(noite, lisboa("2026-10-02", "10:00")), "2026-10-01", "13 h depois: fora de prazo do dia 1");
  assert.equal(dataEdicao(noite, lisboa("2026-10-02", "15:00")), "2026-10-02", "6 h antes da do dia 2");
});

test("edição da manhã adiantada ou atrasada fica no seu dia", () => {
  const exclusivos = nl("cm-exclusivos"); // 06:00
  assert.equal(dataEdicao(exclusivos, lisboa("2026-10-01", "05:10")), "2026-10-01");
  assert.equal(dataEdicao(exclusivos, lisboa("2026-10-01", "00:00")), "2026-10-01");
  assert.equal(dataEdicao(exclusivos, lisboa("2026-10-01", "13:00")), "2026-10-01");
  assert.equal(dataEdicao(exclusivos, lisboa("2026-09-30", "19:00")), "2026-09-30");
  assert.equal(dataEdicao(exclusivos, lisboa("2026-09-30", "23:59")), "2026-09-30");
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

// ── Conteúdo: entidades, imagens, artigos ──────────────────────────────────

test("entidades HTML: decimais, hexadecimais e com nome, incluindo todos os acentos portugueses", () => {
  const { descodificarEntidades, extrairTexto } = conteudo;
  assert.equal(descodificarEntidades("Mar&#xe7;o"), "Março");
  assert.equal(descodificarEntidades("Mar&#XE7;o &#231; &#x00E3;"), "Março ç ã");
  assert.equal(descodificarEntidades("&Aacute;gua &Eacute;vora &Ccedil;"), "Água Évora Ç");
  const nomes = "aacute eacute iacute oacute uacute agrave atilde otilde acirc ecirc ocirc ccedil".split(" ");
  const esperado = "áéíóúàãõâêôç";
  assert.equal(descodificarEntidades(nomes.map((n) => `&${n};`).join("")), esperado);
  assert.equal(
    descodificarEntidades(nomes.map((n) => `&${n[0].toUpperCase()}${n.slice(1)};`).join("")),
    esperado.toUpperCase(),
  );
  assert.equal(descodificarEntidades("&amp;lt; &lt;b&gt; &quot;x&quot; &rsquo; &euro; &laquo;&raquo;"), '&lt; <b> "x" ’ € «»');
  // Desconhecida: fica como está, não parte a palavra com um espaço.
  assert.equal(descodificarEntidades("a&naoexiste;b"), "a&naoexiste;b");
  assert.equal(extrairTexto("<p>15 de Mar&#xe7;o</p>").trim(), "15 de Março");
});

test("data por extenso com o mês acentuado em entidade é reconhecida", () => {
  assert.deepEqual(datasNoEmail("", "<p>Segunda, 16 de Mar&#xe7;o de 2026</p>", "2026-03-16"), ["2026-03-16"]);
  assert.deepEqual(datasNoEmail("", "<p>2 de mar&#231;o</p>", "2026-03-02"), ["2026-03-02"]);
});

test("datas tiram-se do texto, não dos endereços das imagens", () => {
  const img = (s: string) => `<p>Manchete do dia</p><img src="https://cdn.flash.pt/images/${s}.jpg" alt="Foto">`;
  // Duas imagens diferentes, que só diferem nos números com forma de data.
  const a = processarCorpo(img("img_828x523uu2026-10-03-15-32-44-413052"));
  const b = processarCorpo(img("img_828x523uu2026-10-04-09-11-02-413999"));
  assert.notEqual(a.hash, b.hash);
  assert.match(a.normalizado, /2026-10-03-15-32-44-413052/);
  // A data do cabeçalho, no texto, continua a não contar.
  const c = processarCorpo("<p>Sexta-feira, 3 de outubro de 2026</p><p>Manchete</p>");
  const d = processarCorpo("<p>Sábado, 4 de outubro de 2026</p><p>Manchete</p>");
  assert.equal(c.hash, d.hash);
});

/** Um link como vem nas newsletters: embrulhado no tracking da Amazon SES. */
const ses = (destino: string) =>
  `https://sgdbs6pn.r.eu-west-1.awstrack.me/L0/${encodeURIComponent(destino)}` +
  `/1/010201a0f155ab11-f77c0f02-f1b9-4869-8aa8-2a9d3849a4f2-000000/jBZ47Z8vESq4upcXtM1G6ooBU3A=473`;

test("links: o tracking desembrulha-se e a query e o fragmento caem", () => {
  const { desembrulharLink } = conteudo;
  const artigo =
    "https://www.maxima.pt/atual/detalhe/caso-cornell-o-que-portugal-pode-aprender?utm_campaign=geral&utm_edition=202610050800#topo";
  assert.equal(desembrulharLink(ses(artigo)), "maxima.pt/atual/detalhe/caso-cornell-o-que-portugal-pode-aprender");
  // Destino só parcialmente codificado, como a SES também os escreve.
  assert.equal(
    desembrulharLink(
      "https://x.r.eu-west-1.awstrack.me/L0/https:%2F%2Fwww.maxima.pt/1/010201a0f155ab11-f77c0f02-f1b9-4869-8aa8-2a9d3849a4f2-000000/abc=473",
    ),
    "maxima.pt",
  );
  // Redirecionador com o destino num parâmetro (Echobox e afins).
  assert.equal(
    desembrulharLink(
      `https://click.echobox.com/redirect?url=${encodeURIComponent("https://www.flash.pt/casas-reais/detalhe/carlos-iii-recebe-ameaca?utm_source=x")}`,
    ),
    "flash.pt/casas-reais/detalhe/carlos-iii-recebe-ameaca",
  );
  assert.equal(desembrulharLink("https://www.record.pt/x/detalhe/a-b-c?a=1&amp;b=2"), "record.pt/x/detalhe/a-b-c");
});

test("só contam artigos da marca: fora redes sociais, anúncios, lojas de apps, subscrições e secções", () => {
  const html = [
    ses("https://www.maxima.pt/moda/tendencias/detalhe/os-giros-os-wow-e-os-looks-mais-estranhos?utm_campaign=geral"),
    ses("https://www.maxima.pt/moda/tendencias/detalhe/os-giros-os-wow-e-os-looks-mais-estranhos?utm_campaign=outro"),
    ses("https://www.record.pt/opiniao/cronistas/octavio-ribeiro/detalhe/cris-aquece"),
    ses("https://www.record.pt/opiniao/detalhe/contas-aprovadas-e-futuro-semeado"),
    ses("https://view-mail.echobox.com/viewinbrowser?token=abc"),
    ses("https://securepubads.g.doubleclick.net/gampad/jump?iu=/4196/MAXIMA_MASTHEAD"),
    ses("https://subscribe.campaign-list.com/v1/public/campaigns/unsubscribe?campaignURN=x"),
    ses("https://www.instagram.com/maxima.pt/"),
    ses("https://www.facebook.com/www.maxima.pt"),
    "https://www.whatsapp.com/channel/0029VaCHWoaKQuJDudSYSR1a",
    "https://apps.apple.com/pt/app/cm-jornal/id455241749",
    "https://play.google.com/store/apps/details?id=pt.cm",
    "https://www.record.pt/assinaturas/compra/20250813-1431-estudantes",
    "https://www.flash.pt/subscrevernewsletters",
    "https://www.jornaldenegocios.pt/cotacoes/cotacao/TEIXEIRA-DUARTE",
    "https://www.maxima.pt?utm_campaign=reativacao1",
    "https://www.flash.pt/celebridades/mundo",
    "#?utm_campaign=mundo",
  ]
    .map((h) => `<a href="${h}">x</a>`)
    .join("");
  assert.deepEqual(conteudo.extrairArtigos(html), [
    "maxima.pt/moda/tendencias/detalhe/os-giros-os-wow-e-os-looks-mais-estranhos",
    "record.pt/opiniao/cronistas/octavio-ribeiro/detalhe/cris-aquece",
    "record.pt/opiniao/detalhe/contas-aprovadas-e-futuro-semeado",
  ]);
});

const arts = (...ids: number[]) => ids.map((i) => `maxima.pt/atual/detalhe/artigo-numero-${i}`);
const ant = (hash: string, artigos: string[]) => ({ edicaoAnterior: { data: "2026-09-30", hash, artigos } });
const ocA = (hora: string, hash: string, artigos: string[]) => ({ recebidoEm: lisboa("2026-10-01", hora), hash, artigos });

test("conteúdo: hash igual → 4", () => {
  const r = classificar(ctx({ ocorrencias: [ocA("06:06", "h1", arts(1, 2, 3))], ...ant("h1", arts(4, 5, 6)) }));
  assert.equal(r.codigo, 4);
  assert.match(r.detalhe, /Hash igual/);
});

test("conteúdo: hash diferente mas exatamente os mesmos artigos (Jaccard 1) → 4", () => {
  const r = classificar(ctx({ ocorrencias: [ocA("06:06", "h2", arts(3, 1, 2))], ...ant("h1", arts(1, 2, 3)) }));
  assert.equal(r.codigo, 4);
  assert.equal(r.semComparacao, false);
  assert.match(r.detalhe, /Os mesmos 3 artigos da edição de 30\/09 → conteúdo repetido/);
  // Atrasada e com os mesmos artigos: o 4 tem precedência sobre o 2.
  assert.equal(
    classificar(ctx({ ocorrencias: [ocA("07:30", "h2", arts(1, 2, 3))], ...ant("h1", arts(1, 2, 3)) })).codigo,
    4,
  );
});

test("conteúdo: Jaccard 1 com menos de 3 artigos não prova repetição — só avisa", () => {
  const r = classificar(ctx({ ocorrencias: [ocA("06:06", "h2", arts(1, 2))], ...ant("h1", arts(1, 2)) }));
  assert.equal(r.codigo, 1);
  assert.equal(r.provavelmenteRepetida, true);
  assert.match(r.detalhe, /provavelmente repetida: 2 de 2 artigos iguais à edição anterior/);
});

test("conteúdo: a maioria dos artigos da anterior (Jaccard ≥ 0,75) é Duplicada; entre 0,7 e 0,75 só avisa", () => {
  // maxima-geral 02/10: a edição de 01/10 com mais um bloco — 6 de 7 (0,86).
  // O controlo do cliente marcou 3 (Duplicada) aqui, a 29/10 e a 06/11.
  const r = classificar(
    ctx({ ocorrencias: [ocA("06:06", "h2", arts(1, 2, 3, 4, 5, 6, 7))], ...ant("h1", arts(1, 2, 3, 4, 5, 6)) }),
  );
  assert.equal(r.codigo, 3);
  assert.match(r.detalhe, /6 de 7 artigos iguais aos dessa edição → conteúdo duplicado/);
  assert.doesNotMatch(r.detalhe, /conteúdo novo/);
  // negocios-ip 19/10: 8 de 9 com uma semanal de 10 (0,73) — o cliente marcou 1.
  const ip = classificar(
    ctx({ ocorrencias: [ocA("06:06", "h2", arts(1, 2, 3, 4, 5, 6, 7, 8, 20))], ...ant("h1", arts(1, 2, 3, 4, 5, 6, 7, 8, 30, 31)) }),
  );
  assert.equal(ip.codigo, 1);
  assert.equal(ip.provavelmenteRepetida, true);
  assert.match(ip.detalhe, /⚠ provavelmente repetida: 8 de 9 artigos/);
  // flash-mundo 04/10: 5 de 6 (0,71). Atrasada: fica 2, com o mesmo aviso.
  const f = classificar(
    ctx({ ocorrencias: [ocA("07:30", "h2", arts(1, 2, 3, 4, 5, 9))], ...ant("h1", arts(1, 2, 3, 4, 5, 6)) }),
  );
  assert.equal(f.codigo, 2);
  assert.match(f.detalhe, /provavelmente repetida: 5 de 6 artigos/);
  // Com a correção do editor 30 min depois: 3 (Duplicada), e o aviso continua.
  const d = classificar(
    ctx({
      ocorrencias: [ocA("06:03", "h2", arts(1, 2, 3, 4, 5, 6, 7)), ocA("06:33", "h3", arts(8, 9, 10))],
      ...ant("h1", arts(1, 2, 3, 4, 5, 6)),
    }),
  );
  assert.equal(d.codigo, 3);
  assert.match(d.detalhe, /1\.º envio: .*6 de 7 artigos iguais aos dessa edição → conteúdo duplicado/);
});

test("conteúdo: abaixo do limiar (negocios-tecnologia 01/10, 0,67) é conteúdo novo, sem aviso", () => {
  const r = classificar(
    ctx({
      ocorrencias: [ocA("06:06", "h2", arts(1, 2, 3, 4, 5, 6, 7, 8, 11, 12))],
      ...ant("h1", arts(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)),
    }),
  );
  assert.equal(r.codigo, 1);
  assert.equal(r.provavelmenteRepetida, undefined);
  assert.match(r.detalhe, /conteúdo novo/);
  assert.doesNotMatch(r.detalhe, /provavelmente/);
});

test("conteúdo: sem artigos de um dos lados, decide só o hash", () => {
  const r = classificar(ctx({ ocorrencias: [ocA("06:06", "h2", [])], ...ant("h1", arts(1, 2, 3)) }));
  assert.equal(r.codigo, 1);
  assert.match(r.detalhe, /conteúdo novo/);
});

test("conteúdo: o assunto nunca é prova; artigos repetidos dão 3 ou 4 (de ponta a ponta)", () => {
  // flash-weekend 15/10 repetiu o assunto de 08/10 ("n.º 203") com 8 artigos novos.
  const n = nl("negocios-tecnologia");
  const de = "Jornal de Negócios Tecnologia <info@news.jornaldenegocios.pt>";
  const corpo = (ids: number[]) =>
    ids
      .map(
        (i) =>
          `<a href="${ses(`https://www.jornaldenegocios.pt/empresas/tecnologias/detalhe/peca-numero-${i}?utm_source=newsletter`)}">Peça ${i}</a>`,
      )
      .join("");
  gravarEmail(de, "Há moda na cidade", lisboa("2026-10-19", "15:05"), n.id, corpo([1, 2, 3, 4, 5, 6]));
  gravarEmail(de, "Há moda na cidade", lisboa("2026-10-20", "15:05"), n.id, corpo([11, 12, 13, 14, 15, 16]));
  registos.reavaliar(n.id, "2026-10-20");
  let r = registo(n.id, "2026-10-20");
  assert.equal(r.codigo_estado, 1);
  assert.doesNotMatch(r.detalhe, /provavelmente|repetido/);
  assert.match(r.detalhe, /Hash diferente da edição de 19\/10 → conteúdo novo/);

  // Assunto novo, mas 6 de 7 artigos de ontem: Duplicada (critério do cliente).
  gravarEmail(de, "Assunto completamente novo", lisboa("2026-10-21", "15:05"), n.id, corpo([11, 12, 13, 14, 15, 16, 17]));
  registos.reavaliar(n.id, "2026-10-21");
  r = registo(n.id, "2026-10-21");
  assert.equal(r.codigo_estado, 3);
  assert.match(r.detalhe, /6 de 7 artigos iguais aos dessa edição → conteúdo duplicado/);

  // Exatamente os mesmos artigos, com outro texto à volta: 4.
  gravarEmail(
    de,
    "Outro assunto",
    lisboa("2026-10-22", "15:05"),
    n.id,
    `<p>Texto diferente</p>${corpo([17, 16, 15, 14, 13, 12, 11])}`,
  );
  registos.reavaliar(n.id, "2026-10-22");
  r = registo(n.id, "2026-10-22");
  assert.equal(r.codigo_estado, 4);
  assert.match(r.detalhe, /Os mesmos 7 artigos/);
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
const gravarEmail = (remetente: string, assunto: string, quando: Date, nid: string | null, html?: string) => {
  // Sem HTML dado, cada email tem um corpo único: dois emails de teste nunca
  // são "conteúdo repetido" por acaso.
  const corpoHtml = html ?? `<p>${assunto} ${seq}</p>`;
  const corpo = processarCorpo(corpoHtml);
  db()
    .prepare(
      `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html,
         corpo_normalizado, hash_conteudo, newsletter_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(`t${++seq}@teste`, remetente, assunto, quando.toISOString(), corpoHtml,
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
  const limite = lisboa(dia, "06:30"); // cm-exclusivos: 06:00 + 30 min

  // Última leitura antes do limite (PC desligado de manhã): não fecha.
  registos.fecharVencidos({ ok: lisboa(dia, "06:20"), desde: lisboa("2026-09-20", "00:00") });
  assert.equal(registo("cm-exclusivos", dia).fechado, 0);

  // Leitura logo a seguir ao limite, dentro da margem: ainda não fecha.
  registos.fecharVencidos({ ok: new Date(limite.getTime() + 5 * 60_000), desde: lisboa("2026-09-20", "00:00") });
  assert.equal(registo("cm-exclusivos", dia).fechado, 0);

  // Leitura que não cobriu o dia (janela começa depois): não fecha.
  registos.fecharVencidos({ ok: lisboa(dia, "09:00"), desde: lisboa(dia, "08:00") });
  assert.equal(registo("cm-exclusivos", dia).fechado, 0);

  // Regra do cliente: leitura boa depois do limite (+30 min) e da margem, a
  // cobrir o dia: fecha logo como 5 — já não há prazo de 6 h.
  registos.fecharVencidos({ ok: lisboa(dia, "06:45"), desde: lisboa("2026-09-20", "00:00") });
  assert.deepEqual(estado("cm-exclusivos", dia), NAO_SAIU);
  assert.match(registo("cm-exclusivos", dia).detalhe, /→ Não Saiu/);
});

test("email que chega depois de fechado corrige o 'Não Saiu'", () => {
  const dia = "2026-10-01";
  gravarEmail(CM("Exclusivos"), "x", lisboa(dia, "07:20"), "cm-exclusivos");
  const r = registos.reavaliar("cm-exclusivos", dia);
  assert.equal(r?.codigo_estado, 2);
  assert.equal(r?.atraso_minutos, 50);
  assert.match(r!.detalhe, /saiu tarde \(50 min de atraso\)/);
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
  const livres = NEWSLETTERS.filter((n) => n.ativa && !estaConfigurada(n));
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
  // A 04/10 a inscrição já está provada (os dias seguintes, se também
  // faltarem, tiram a prova pela regra das edições seguidas — não por isto).
  assert.doesNotMatch(registo("flash-mundo", "2026-10-04").detalhe, /nunca chegou|primeiro email/);
});

test("pagas: já não são grupo de controlo — mesmas provas que as outras (acesso premium desde 05/11)", () => {
  const dia = "2026-10-07";
  registos.gerarDia(dia);
  // Nunca chegou nada da Premium Plus antes deste dia: sem prova de inscrição,
  // nunca "Não Saiu".
  assert.ok(prova.motivosSemProva(nl("record-premium-plus"), dia, lisboa(dia, "10:00")).length > 0);
  leituraBoa();
  assert.deepEqual(estado("record-premium-plus", dia), SEM_PROVA);
  assert.doesNotMatch(registo("record-premium-plus", dia).detalhe, /controlo/);
  // Uma paga sem remetente é "Não assinada no email", como as outras.
  const f = { codigo: 5 as const, fechado: true, limitePassou: false, semEmail: true, paga: true, ressalva: null };
  assert.equal(apresentacao.variante(f), "sem-email");
  assert.equal(apresentacao.codigoMostrado(f), null);
});

test("pagas reais (05/11): a edição da Premium Plus é reconhecida e conta como Saiu", () => {
  const corpo = '<a href="https://www.record.pt/%3Futm_campaign=premium-plus%26utm_medium=email%26utm_edition=2026110509">x</a>';
  assert.equal(corresponder("Record Premium Plus <info@assinaturas.jornalrecord.pt>", "Paulo Fonseca já manda", corpo)?.id, "record-premium-plus");
  // A Record Premium (sem -plus) continua na dela.
  const premium = '<a href="https://www.record.pt/%3Futm_campaign=premium%26utm_medium=email">x</a>';
  assert.equal(corresponder("Record Premium <info@assinaturas.jornalrecord.pt>", "Crónica", premium)?.id, "record-premium");
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
  // As três fazem a mesma série: nenhuma é "Não Saiu" — também as duas
  // primeiras, que sozinhas pareciam (o primeiro dia de um corte da caixa).
  for (const d of ["2026-10-10", "2026-10-11", "2026-10-12"]) {
    assert.deepEqual(estado("cm-boa-tarde", d), SEM_PROVA, d);
    assert.match(registo("cm-boa-tarde", d).detalhe, /3 edições seguidas/);
  }
});

test("'Não Saiu' já fechado volta a abrir se aparecer um email que pode ser dela", () => {
  const dia = "2026-10-08";
  registos.gerarDia(dia);
  gravarEmail("Record Geral <info@news.jornalrecord.pt>", "x", lisboa("2026-10-07", "09:00"), "record-geral");
  gravarEmail("Record Sporting <info@news.jornalrecord.pt>", "canário", lisboa(dia, "11:00"), "record-sporting");
  // O dia seguinte chegou: 08/10 é uma falta isolada, não um corte.
  gravarEmail("Record Geral <info@news.jornalrecord.pt>", "y", lisboa("2026-10-09", "09:00"), "record-geral");
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

test("invariante: nenhum 'Não Saiu' fechado sem prova de ausência", () => {
  // O ciclo revê os "Não Saiu" recentes; aqui, todos.
  registos.reverNaoSaiu(400);
  const todos = db()
    .prepare(`SELECT newsletter_id, data_prevista, hora_limite, detalhe FROM registos WHERE codigo_estado = 5 AND fechado = 1`)
    .all() as { newsletter_id: string; data_prevista: string; hora_limite: string; detalhe: string }[];
  assert.ok(todos.length > 0);
  for (const r of todos) {
    const n = nl(r.newsletter_id);
    assert.deepEqual(prova.motivosSemProva(n, r.data_prevista, new Date(r.hora_limite)), [], `${n.id} ${r.data_prevista}`);
  }
  // E nenhum detalhe em aberto afirma "Não Saiu".
  const abertos = db()
    .prepare(`SELECT newsletter_id, detalhe FROM registos WHERE fechado = 0`)
    .all() as { newsletter_id: string; detalhe: string }[];
  for (const r of abertos) assert.doesNotMatch(r.detalhe, /→ Não Saiu/, r.newsletter_id);
});

// ── Regras guardadas no painel ("Por classificar") ─────────────────────────

const fusao = await import("../src/lib/regras-fusao.ts");
const regras = await import("../src/lib/regras.ts");

/** Grava um email com o HTML dado, como a recolha o faria. Devolve o id. */
const gravarComCorpo = (remetente: string, assunto: string, quando: Date, html: string, nid: string | null = null) => {
  const corpo = processarCorpo(html);
  return Number(
    db()
      .prepare(
        `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html,
           corpo_normalizado, hash_conteudo, newsletter_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(`r${++seq}@teste`, remetente, assunto, quando.toISOString(), html, corpo.normalizado, corpo.hash, nid)
      .lastInsertRowid,
  );
};
const nidDe = (id: number) =>
  (db().prepare(`SELECT newsletter_id FROM emails WHERE id = ?`).get(id) as { newsletter_id: string | null })
    .newsletter_id;
const SABADO = "Sábado <info@news.sabado.pt>";
const marcaSabado = (nome: string) => `/4196/SABADO_MASTHEAD/NEWSLETTER_${nome}_LEADERBOARD`;

test("deteção da marca no corpo: com '/' e com '%2F', sem repetições", () => {
  assert.deepEqual(fusao.marcasNoCorpo(anuncio("JORNALDENEGOCIOS", "LEX") + anuncio("JORNALDENEGOCIOS", "LEX", "%2F")), [
    "/4196/JORNALDENEGOCIOS_MASTHEAD/NEWSLETTER_LEX_LEADERBOARD",
  ]);
  assert.deepEqual(fusao.marcasNoCorpo(anuncio("JORNALDENEGOCIOS", "5_COISAS_A_SABER", "%2f")), [
    "/4196/JORNALDENEGOCIOS_MASTHEAD/NEWSLETTER_5_COISAS_A_SABER_LEADERBOARD",
  ]);
  assert.deepEqual(fusao.marcasNoCorpo(corpoSemAnuncio), []);
});

test("fusão: o ficheiro é a base, o painel só acrescenta", () => {
  const copia = (id: string) => structuredClone(nl(id));
  const lista = [copia("cm-exclusivos"), copia("sabado-capa")];
  const novas = [
    { id: 1, newsletterId: "cm-exclusivos", remetente: "novo@news.correiodamanha.pt", marcaCorpo: "/4196/CORREIODAMANHA_MASTHEAD/NEWSLETTER_EXCL2_LEADERBOARD" },
    { id: 2, newsletterId: "sabado-capa", remetente: "info@news.sabado.pt", marcaCorpo: marcaSabado("CAPA") },
  ];
  const [cm, capa] = fusao.fundirTodas(novas, lista);

  // Configurada no ficheiro: o critério do ficheiro mantém-se, a regra entra como alternativa.
  assert.equal(cm.marcaCorpo, "/4196/CORREIODAMANHA_MASTHEAD/NEWSLETTER_EXCLUSIVOS_LEADERBOARD");
  assert.equal(cm.alternativas?.length, 1);
  assert.deepEqual(cm.remetentes, ["info@news.correiodamanha.pt", "novo@news.correiodamanha.pt"]);
  assert.equal(corresponder(CM("Exclusivos"), "x", anuncio("CORREIODAMANHA", "EXCLUSIVOS"), [cm])?.id, "cm-exclusivos");
  assert.equal(corresponder("CM <novo@news.correiodamanha.pt>", "x", anuncio("CORREIODAMANHA", "EXCL2"), [cm])?.id, "cm-exclusivos");
  // A alternativa exige o endereço exato: a marca nova do endereço antigo não serve.
  assert.equal(corresponder(CM("Exclusivos"), "x", anuncio("CORREIODAMANHA", "EXCL2"), [cm]), null);

  // Por configurar no ficheiro: a regra passa a ser o critério principal.
  assert.ok(!estaConfigurada(lista[1]));
  assert.ok(estaConfigurada(capa));
  assert.equal(capa.marcaCorpo, marcaSabado("CAPA"));
  assert.equal(capa.alternativas, undefined);
  assert.equal(corresponder(SABADO, "Capa da semana", anuncio("SABADO", "CAPA"), [capa])?.id, "sabado-capa");
  // Marketing do mesmo remetente, sem a marca, continua de fora.
  assert.equal(corresponder(SABADO, "Assine já", corpoSemAnuncio, [capa]), null);

  // Aplicar sem regras repõe o ficheiro, e aplicar duas vezes dá o mesmo.
  fusao.aplicarNaConfig(novas, lista);
  fusao.aplicarNaConfig(novas, lista);
  assert.equal(lista[0].alternativas?.length, 1);
  fusao.aplicarNaConfig([], lista);
  assert.equal(lista[0].alternativas, undefined);
  assert.deepEqual(lista[0].remetentes, ["info@news.correiodamanha.pt"]);
  assert.deepEqual(lista[1].remetentes, []);
  assert.equal(lista[1].marcaCorpo, "");
});

test("atribuir no painel: grava a regra, reclassifica e reavalia o dia", () => {
  const dia = "2026-10-15"; // quinta-feira: dia da Sábado · Capa
  registos.gerarDia(dia);
  assert.ok(!estaConfigurada(nl("sabado-capa")));
  const edicao = gravarComCorpo(SABADO, "A capa desta semana", lisboa(dia, "08:05"), `<p>capa</p>${anuncio("SABADO", "CAPA")}`);
  const marketing = gravarComCorpo(SABADO, "Assine a Sábado com desconto", lisboa(dia, "09:00"), corpoSemAnuncio);

  const solto = regras.porClassificar(3650).find((e) => e.id === edicao);
  assert.ok(solto, "aparece em 'por classificar'");
  assert.deepEqual(solto.marcas, [marcaSabado("CAPA")]);
  assert.equal(solto.sugestao, "sabado-capa");

  // Validação no servidor: marca que o email não traz, newsletter inexistente.
  assert.equal(regras.atribuir(edicao, "sabado-capa", marcaSabado("OUTRA")).ok, false);
  assert.equal(regras.atribuir(edicao, "nao-existe", marcaSabado("CAPA")).ok, false);
  assert.equal(regras.atribuir(marketing, "sabado-capa", marcaSabado("CAPA")).ok, false);

  const r = regras.atribuir(edicao, "sabado-capa", marcaSabado("CAPA"), "medialivre");
  assert.ok(r.ok, r.mensagem);
  assert.equal(nidDe(edicao), "sabado-capa");
  assert.equal(nidDe(marketing), null);
  assert.ok(estaConfigurada(nl("sabado-capa")));
  assert.deepEqual(nl("sabado-capa").remetentes, ["info@news.sabado.pt"]);
  const reg = registo("sabado-capa", dia);
  assert.ok([1, 2].includes(reg.codigo_estado), `código ${reg.codigo_estado}`);
  assert.ok(regras.porClassificar(3650).every((e) => e.id !== edicao));
  assert.equal(regras.estadoNewsletters().find((s) => s.id === "sabado-capa")?.origem, "painel");

  // Outra vez é recusado (o email já conta); ficou registado quem e o quê.
  assert.equal(regras.atribuir(edicao, "sabado-capa", marcaSabado("CAPA")).ok, false);
  const alteracao = regras.ultimasAlteracoes(1)[0];
  assert.equal(alteracao.acao, "Regra acrescentada");
  assert.equal(alteracao.quem, "medialivre");
  assert.match(alteracao.detalhe, /Sábado · Capa/);

  // Um email novo com a marca, de outra semana, entra direto pela recolha.
  assert.equal(corresponder(SABADO, "Outra capa", anuncio("SABADO", "CAPA", "%2F"))?.id, "sabado-capa");
});

test("regra que faria um email contar para duas newsletters é recusada", async () => {
  // Um email já atribuído à Capa traz também a marca da "O Melhor do Mês".
  const duplo = gravarComCorpo(SABADO, "Especial", lisboa("2026-10-01", "12:05"),
    anuncio("SABADO", "CAPA") + anuncio("SABADO", "MELHOR"));
  registos.reavaliar("sabado-capa", "2026-10-01");
  await reclassificarAgora();
  assert.equal(nidDe(duplo), "sabado-capa");

  const melhor = gravarComCorpo(SABADO, "O melhor de setembro", lisboa("2026-10-01", "12:10"), anuncio("SABADO", "MELHOR"));
  const antes = regras.lerRegras().length;
  const r = regras.atribuir(melhor, "sabado-o-melhor-do-mes", marcaSabado("MELHOR"));
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /duas newsletters/);
  assert.match(r.mensagem, /Sábado · Capa/);
  assert.equal(regras.lerRegras().length, antes, "nada gravado");
  assert.equal(nidDe(duplo), "sabado-capa");
  assert.ok(!estaConfigurada(nl("sabado-o-melhor-do-mes")));

  // Marca que já identifica outra newsletter (no ficheiro): recusada também.
  const lex = gravarComCorpo("Lex <info@outro-endereco.pt>", "Contratos", lisboa("2026-10-08", "16:00"), anuncio("JORNALDENEGOCIOS", "LEX"));
  const r2 = regras.atribuir(lex, "negocios-financas", "/4196/JORNALDENEGOCIOS_MASTHEAD/NEWSLETTER_LEX_LEADERBOARD");
  assert.equal(r2.ok, false);
  assert.match(r2.mensagem, /já identifica Negócios · Lex/);
});

/** O que a recolha faz no fim de cada leitura. */
async function reclassificarAgora() {
  const m = await import("../src/lib/recolha.ts");
  return m.reavaliarAfetados(m.reclassificar());
}

test("'não é newsletter': por assunto ou só a mensagem, sem mexer em estados", () => {
  const quando = lisboa("2026-10-14", "15:00");
  const a = gravarComCorpo("Loja <promo@loja.pt>", "Promoção de outono", quando, corpoSemAnuncio);
  const b = gravarComCorpo("Loja <promo@loja.pt>", "  promoção  de OUTONO ", quando, corpoSemAnuncio);
  const c = gravarComCorpo("Loja <promo@loja.pt>", "Novidades da loja", quando, corpoSemAnuncio);
  const ids = () => new Set(regras.porClassificar(3650).map((e) => e.id));
  assert.ok(ids().has(a) && ids().has(b) && ids().has(c));

  const r = regras.excluir(a, "assunto");
  assert.ok(r.ok, r.mensagem);
  assert.ok(!ids().has(a) && !ids().has(b), "o mesmo assunto, escrito de outra forma, também sai");
  assert.ok(ids().has(c));
  assert.equal(regras.excluir(a, "assunto").ok, false, "repetido");

  assert.ok(regras.excluir(c, "mensagem").ok);
  assert.ok(!ids().has(c));
  assert.equal(nidDe(a), null);
  assert.equal(regras.ultimasAlteracoes(1)[0].acao, "Email ignorado");

  const assunto = regras.lerExclusoes().find((x) => x.tipo === "assunto")!;
  assert.ok(regras.removerExclusao(assunto.id).ok);
  assert.ok(ids().has(a) && ids().has(b));
});

test("remover a regra do painel repõe o ficheiro e reavalia", () => {
  const regra = regras.lerRegras().find((r) => r.newsletterId === "sabado-capa")!;
  const r = regras.removerRegra(regra.id);
  assert.ok(r.ok, r.mensagem);
  assert.ok(!estaConfigurada(nl("sabado-capa")));
  const edicao = db().prepare(`SELECT id FROM emails WHERE assunto = 'A capa desta semana'`).get() as { id: number };
  assert.equal(nidDe(edicao.id), null);
  const reg = db()
    .prepare(`SELECT nr_ocorrencias FROM registos WHERE newsletter_id = 'sabado-capa' AND data_prevista = '2026-10-15'`)
    .get() as { nr_ocorrencias: number };
  assert.equal(reg.nr_ocorrencias, 0);
  assert.equal(regras.ultimasAlteracoes(1)[0].acao, "Regra removida");
});
