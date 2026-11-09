/**
 * Testes da camada de conteúdo: a data de publicação dos artigos, o perfil de
 * cada newsletter e os sinais de conteúdo desatualizado contra o histórico.
 *   npm test
 *
 * Base de dados temporária própria; nenhuma página verdadeira é pedida.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pasta = mkdtempSync(join(tmpdir(), "nwl-perfil-"));
process.env.DATABASE_PATH = join(pasta, "teste.db");
delete process.env.MONITOR_INICIO;
delete process.env.HEALTHCHECK_URL;

const { dataPublicacao, recolherDatasArtigos, publicadoEm, esquecerDatas, POR_CICLO } = await import(
  "../src/lib/datas-artigos.ts"
);
const { sinaisConteudo, perfilDe } = await import("../src/lib/perfil.ts");
const { classificar } = await import("../src/lib/classificacao.ts");
const { dataNoTopo } = await import("../src/lib/datas.ts");
const { newsletterPorId } = await import("../config/newsletters.ts");
const { paraInstante } = await import("../src/lib/tempo.ts");
const { db, fecharDb } = await import("../src/lib/db.ts");
import type { EdicaoVista } from "../src/lib/perfil.ts";

test.after(() => {
  fecharDb();
  rmSync(pasta, { recursive: true, force: true });
});

// ── Data de publicação de um artigo ────────────────────────────────────────

test("data de publicação: meta article:published_time, nas duas ordens, e JSON-LD", () => {
  assert.equal(
    dataPublicacao(`<meta property="article:published_time" content="2026-09-29T19:16:00+01:00" />`),
    "2026-09-29T18:16:00.000Z",
  );
  assert.equal(
    dataPublicacao(`<meta content="2026-10-01T08:00:00Z" property="article:published_time">`),
    "2026-10-01T08:00:00.000Z",
  );
  // Só o dia: 00h de Lisboa (23h UTC do dia anterior, no verão).
  assert.equal(dataPublicacao(`{"@type":"NewsArticle","datePublished":"2026-09-30"}`), "2026-09-29T23:00:00.000Z");
  // Negócios: o meta "published_time" (sem "article:") tem a hora; o JSON-LD só o dia.
  assert.equal(
    dataPublicacao(`{"dateModified":"2026-10-27T16:58:49+00:00","datePublished":"2026-10-27"}<meta name="published_time" content="2026-10-27T16:58:38+00:00" />`),
    "2026-10-27T16:58:38.000Z",
  );
  // FLASH!/Máxima: datePublished só o dia, dateCreated com hora do mesmo dia.
  assert.equal(
    dataPublicacao(`{"dateCreated":"2026-09-29T13:21:42+01:00","dateModified":"2026-09-29T20:50:24+01:00","datePublished":"2026-09-29"}`),
    "2026-09-29T12:21:42.000Z",
  );
  // MUST: o datePublished é o dia da atualização; o dateCreated, de outro dia, não se usa.
  assert.equal(
    dataPublicacao(`{"dateCreated":"2026-09-11T13:32:08+01:00","datePublished":"2026-09-25"}`),
    "2026-09-24T23:00:00.000Z",
  );
  assert.equal(dataPublicacao(`<html><head><title>sem data</title></head></html>`), null);
  assert.equal(dataPublicacao(`<meta property="article:published_time" content="ontem">`), null);
});

test("data no topo: a primeira data dos primeiros caracteres, não as das notícias", () => {
  const html = `<p>Newsletter Diaria - FLASH!</p><p>Sexta-feira, 30 de Outubro de 2026</p>` +
    `<p>${"texto ".repeat(100)} o casamento foi a 12 de dezembro</p>`;
  assert.equal(dataNoTopo(html, "2026-10-30"), "2026-10-30");
  assert.equal(dataNoTopo(`<p>${"x ".repeat(300)} 12 de dezembro</p>`, "2026-10-30"), null);
});

// ── Recolha das datas ──────────────────────────────────────────────────────

const LINK = (caminho: string) =>
  `<a href="https://sgdbs6pn.r.eu-west-1.awstrack.me/L0/https:%2F%2Fwww.record.pt%2F${encodeURIComponent(caminho)}/1/010201a1ba69cca7-426b9237-0c3f-4354-803d-0db423b6224a-000000/UDVoBcpZW-3h1mzVho=">x</a>`;

function gravarEmail(msgId: string, newsletterId: string, quando: Date, caminhos: string[]): number {
  const r = db()
    .prepare(
      `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html, newsletter_id)
       VALUES (?, 'info@news.jornalrecord.pt', 'teste', ?, ?, ?)`,
    )
    .run(msgId, quando.toISOString(), `<html><body>${caminhos.map(LINK).join("")}</body></html>`, newsletterId);
  return Number(r.lastInsertRowid);
}

test("recolha das datas: recentes primeiro, depois o histórico; cada artigo uma vez; falhas repetidas depois de esperar", async () => {
  const agora = new Date();
  const a1 = "futebol/detalhe/benfica-vence-o-porto-no-classico";
  const a2 = "futebol/detalhe/sporting-supera-os-200-mil-socios";
  const a3 = "futebol/detalhe/artigo-que-falha-a-primeira-vez";
  const id1 = gravarEmail("<d1@t>", "record-geral", new Date(agora.getTime() - 3_600_000), [a1, a2]);
  const id2 = gravarEmail("<d2@t>", "record-geral", new Date(agora.getTime() - 1_800_000), [a2, a3]);
  const id3 = gravarEmail("<d3@t>", "record-geral", new Date(agora.getTime() - 10 * 86_400_000), ["futebol/detalhe/antigo-do-historico"]);
  gravarEmail("<d5@t>", "record-geral", new Date(agora.getTime() - 120 * 86_400_000), ["futebol/detalhe/velho-fora-dos-90-dias"]);

  const pedidos: string[] = [];
  let falhar = true;
  const pedir = async (url: string) => {
    pedidos.push(url);
    if (url.includes("falha")) {
      if (falhar) return { estado: 0, corpo: "" };
      return { estado: 200, corpo: `<meta property="article:published_time" content="2026-11-01T10:00:00Z">` };
    }
    return { estado: 200, corpo: `<meta property="article:published_time" content="2026-11-08T07:00:00Z">` };
  };

  const r1 = await recolherDatasArtigos(agora, pedir);
  assert.equal(r1.pedidos, 4, "três artigos dos últimos dias e um do histórico; o de há 120 dias fica de fora");
  assert.ok(pedidos.at(-1)!.includes("antigo-do-historico"), "o histórico vem depois dos recentes");
  assert.ok(!pedidos.some((u) => u.includes("fora-dos-90-dias")));
  assert.equal(r1.comData, 3);
  assert.deepEqual(new Set(r1.emails), new Set([id1, id2, id3]));
  assert.equal(publicadoEm(`record.pt/${a1}`), Date.parse("2026-11-08T07:00:00Z"));

  // Logo a seguir: nada a pedir (os bons estão feitos, a falha espera 30 min).
  pedidos.length = 0;
  const r2 = await recolherDatasArtigos(new Date(agora.getTime() + 60_000), pedir);
  assert.equal(r2.pedidos, 0);

  // Passada a espera, a falha volta a ser pedida — e agora responde.
  falhar = false;
  const r3 = await recolherDatasArtigos(new Date(agora.getTime() + 31 * 60_000), pedir);
  assert.equal(r3.pedidos, 1);
  assert.deepEqual(r3.emails, [id2]);

  // A memória e a base dizem o mesmo depois de esquecer.
  esquecerDatas();
  assert.equal(publicadoEm(`record.pt/${a3}`), Date.parse("2026-11-01T10:00:00Z"));
  assert.ok(POR_CICLO >= 10);
});

test("recolha das datas: uma exceção do pedido nunca escapa", async () => {
  gravarEmail("<d4@t>", "record-geral", new Date(), ["futebol/detalhe/pedido-que-rebenta-sempre"]);
  const r = await recolherDatasArtigos(new Date(Date.now() + 2 * 3_600_000), async () => {
    throw new Error("rebentou");
  });
  assert.ok(r.pedidos >= 1);
  assert.equal(r.comData, 0);
});

// ── Perfil e sinais ────────────────────────────────────────────────────────

const DIA = 86_400_000;
let seq = 0;
/** Uma edição: dia, idades (dias) dos artigos, hash e artigos opcionais. */
function ed(data: string, idades: number[], extra: Partial<EdicaoVista> = {}): EdicaoVista {
  const artigos = extra.artigos ?? idades.map(() => `record.pt/a/detalhe/artigo-${++seq}-unico`);
  return {
    data,
    recebidoEm: new Date(`${data}T09:00:00Z`),
    hash: extra.hash ?? `h-${data}-${seq}`,
    artigos,
    idades,
    dataTopo: extra.dataTopo ?? null,
  };
}
const dias = (de: string, n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(`${de}T12:00:00Z`) + i * DIA).toISOString().slice(0, 10));

/** Histórico típico do Record: o artigo mais recente com ~2 h. */
const historicoFresco = () => dias("2026-10-01", 10).map((d) => ed(d, [0.08, 0.3, 1, 2]));

test("perfil: aprende o artigo mais recente de cada edição", () => {
  const p = perfilDe(historicoFresco());
  assert.equal(p.edicoes, 10);
  assert.ok(p.idade && p.idade.p90 < 0.1);
  assert.equal(p.dataNoTopo, false);
});

test("edição reenviada de há um mês (nenhum artigo novo) → prova de conteúdo desatualizado", () => {
  const s = sinaisConteudo(ed("2026-10-11", [30, 31, 32, 33]), historicoFresco());
  assert.ok(s.desatualizada?.includes("conteúdo desatualizado"), s.desatualizada ?? "");
  assert.equal(s.frescoProvado, false);
});

test("artigos de contexto antigos ao lado das notícias do dia (Negócios 5 Coisas, 27/10) → NÃO é desatualizada", () => {
  const hist = dias("2026-10-01", 10).map((d) => ed(d, [0.2, 3, 20, 60]));
  const s = sinaisConteudo(ed("2026-10-11", [0.1, 11, 20, 40, 75, 90]), hist);
  assert.equal(s.desatualizada, null);
  assert.equal(s.frescoProvado, true);
});

test("mais velho do que o costume mas abaixo do limite → só aviso", () => {
  // FLASH!: o mais recente anda pelos 1,4 dias; 2,4 dias é estranho, não prova.
  const hist = dias("2026-10-01", 10).map((d) => ed(d, [1.3, 1.4, 2, 3]));
  const s = sinaisConteudo(ed("2026-10-11", [2.4, 3, 4]), hist);
  assert.equal(s.desatualizada, null);
  assert.equal(s.avisos.length, 1);
  assert.match(s.avisos[0], /mais velho do que em qualquer edição anterior/);
});

test("sem histórico suficiente: nunca prova, só avisa se for muito velha", () => {
  const hist = dias("2026-10-01", 3).map((d) => ed(d, [0.1, 1, 2]));
  const velha = sinaisConteudo(ed("2026-10-05", [40, 41, 42]), hist);
  assert.equal(velha.desatualizada, null);
  assert.equal(velha.avisos.length, 1);
  const normal = sinaisConteudo(ed("2026-10-05", [0.1, 1, 2]), hist);
  assert.equal(normal.avisos.length, 0);
  assert.equal(normal.frescoProvado, false, "sem perfil não há prova de conteúdo atualizado");
});

test("poucos artigos datados: a idade não se mede", () => {
  const s = sinaisConteudo(ed("2026-10-11", [30, 31], { artigos: ["a/detalhe/x-y-z", "b/detalhe/x-y-z", "c/detalhe/x-y-z", "d/detalhe/x-y-z"] }), historicoFresco());
  assert.equal(s.desatualizada, null);
  assert.equal(s.idade, null);
});

test("igual a uma edição antiga qualquer: pelo hash e pelos mesmos artigos", () => {
  const hist = historicoFresco();
  const antiga = hist[2];
  const porHash = sinaisConteudo(ed("2026-10-11", [0.1, 1, 2], { hash: antiga.hash }), hist);
  assert.deepEqual(porHash.igualA, { data: antiga.data, como: "hash" });
  const porArtigos = sinaisConteudo(ed("2026-10-11", [0.1, 1, 2, 3], { artigos: [...antiga.artigos].reverse() }), hist);
  assert.deepEqual(porArtigos.igualA, { data: antiga.data, como: "artigos" });
  const parecida = sinaisConteudo(ed("2026-10-11", [0.1, 1, 2, 3], { artigos: [...antiga.artigos.slice(0, 3), "outro/detalhe/a-b-c"] }), hist);
  assert.equal(parecida.igualA, null);
});

test("data no topo errada numa newsletter que a escreve sempre → prova; numa que não escreve, nada", () => {
  const comData = dias("2026-10-01", 10).map((d) => ed(d, [1.3, 2, 3], { dataTopo: d }));
  const errada = sinaisConteudo(ed("2026-10-11", [1.3, 2, 3], { dataTopo: "2026-10-04" }), comData);
  assert.match(errada.desatualizada ?? "", /diz "04\/10" no topo/);
  const certa = sinaisConteudo(ed("2026-10-11", [1.3, 2, 3], { dataTopo: "2026-10-11" }), comData);
  assert.equal(certa.desatualizada, null);
  const semHabito = sinaisConteudo(ed("2026-10-11", [0.1, 1, 2], { dataTopo: "2026-10-04" }), historicoFresco());
  assert.equal(semHabito.desatualizada, null);
});

test("reaproveitamento e número de artigos fora do costume → avisos", () => {
  const hist = historicoFresco();
  const reaproveitada = sinaisConteudo(
    ed("2026-10-11", [0.1, 1, 2, 3, 4], { artigos: [...hist[5].artigos, "novo/detalhe/a-b-c"] }),
    hist,
  );
  assert.ok(reaproveitada.avisos.some((a) => /já tinham saído/.test(a)));
  const curta = sinaisConteudo(ed("2026-10-11", [0.1], { artigos: ["x/detalhe/a-b-c"] }), hist);
  assert.ok(curta.avisos.some((a) => /1 artigos \(o costume é 4 a 4\)/.test(a)));
});

// ── Na classificação ───────────────────────────────────────────────────────

const n = newsletterPorId("record-geral")!;
const base = (conteudo?: ReturnType<typeof sinaisConteudo>) =>
  classificar({
    newsletter: n,
    dataPrevista: "2026-10-12",
    horaLimite: paraInstante("2026-10-12", "09:30"),
    ocorrencias: [{ recebidoEm: paraInstante("2026-10-12", "09:04"), hash: "hash-novo", artigos: ["a/detalhe/n-o-v-o"] }],
    edicaoAnterior: { data: "2026-10-11", hash: "hash-ontem", artigos: ["a/detalhe/o-n-t-e-m"] },
    fechado: true,
    conteudo,
  });

test("classificação: edição desatualizada pelo perfil → 4; reenviada de há um mês → 4; fresca → 1", () => {
  const velha = base(sinaisConteudo(ed("2026-10-12", [30, 31, 32]), historicoFresco()));
  assert.equal(velha.codigo, 4);
  assert.match(velha.detalhe, /conteúdo desatualizado/);

  const hist = historicoFresco();
  const reenviada = base(sinaisConteudo(ed("2026-10-12", [0.1, 1, 2], { hash: hist[1].hash }), hist));
  assert.equal(reenviada.codigo, 4);
  assert.match(reenviada.detalhe, /igual ao da edição de 02\/10 → edição antiga reenviada/);

  const fresca = base(sinaisConteudo(ed("2026-10-12", [0.05, 1, 2]), historicoFresco()));
  assert.equal(fresca.codigo, 1);
  assert.match(fresca.detalhe, /Artigo mais recente publicado há 1 h/);

  assert.equal(base(undefined).codigo, 1, "sem sinais, tudo como antes");
});

test("classificação: sem edição anterior mas com idade dentro do normal → já não é 'sem termo de comparação'", () => {
  const r = classificar({
    newsletter: n,
    dataPrevista: "2026-10-12",
    horaLimite: paraInstante("2026-10-12", "09:30"),
    ocorrencias: [{ recebidoEm: paraInstante("2026-10-12", "09:04"), hash: "hash-novo", artigos: [] }],
    edicaoAnterior: null,
    fechado: true,
    conteudo: sinaisConteudo(ed("2026-10-12", [0.05, 1, 2]), historicoFresco()),
  });
  assert.equal(r.codigo, 1);
  assert.equal(r.semComparacao, false);
});

test("segunda-feira de uma 'dias úteis': o mais recente é de sábado mas posterior à de sexta → só aviso, nunca prova", () => {
  // Negócios Opinião 05/10: sexta 02/10 às 12h; segunda 05/10 com o mais recente de sábado (1,5 dias).
  const hist = dias("2026-09-21", 10).map((d) => ed(d, [0.3, 0.4, 1]));
  hist[hist.length - 1] = { ...ed("2026-10-02", [0.3, 0.4, 1]), recebidoEm: new Date("2026-10-02T11:06:00Z") };
  const segunda = { ...ed("2026-10-05", [1.5, 2, 3]), recebidoEm: new Date("2026-10-05T11:06:00Z") };
  const s = sinaisConteudo(segunda, hist);
  assert.equal(s.desatualizada, null);
  assert.ok(s.avisos.some((a) => /posterior à edição anterior/.test(a)));
});

test("a edição de ontem reenviada hoje numa newsletter fresca (Record) → prova", () => {
  const hist = historicoFresco();
  const ontem = hist[hist.length - 1];
  const reenviada = { ...ed("2026-10-11", [1.1, 1.3, 2]), recebidoEm: new Date(ontem.recebidoEm.getTime() + 86_400_000) };
  const s = sinaisConteudo(reenviada, hist);
  assert.match(s.desatualizada ?? "", /nada publicado desde a edição anterior/);
});

test("histórico: inclui a edição de ontem (a imediatamente anterior), nunca a do próprio dia", async () => {
  const { historico } = await import("../src/lib/perfil.ts");
  const nl = newsletterPorId("record-premium")!;
  const quando = (d: string) => paraInstante(d, "07:04");
  for (const d of ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]) {
    gravarEmail(`<h-${d}@t>`, "record-premium", quando(d), [`desporto/detalhe/artigo-do-dia-${d}`]);
  }
  const datas = historico(nl, "2026-10-23").map((e) => e.data);
  assert.deepEqual(datas, ["2026-10-20", "2026-10-21", "2026-10-22"]);
});
