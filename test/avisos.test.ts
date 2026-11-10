/**
 * Testes dos avisos do cliente e das pausas: quem pode mandar avisos, a
 * validação das propostas (nunca aplicadas sozinhas), o efeito de uma pausa
 * no motor de estados e o fluxo aplicar/rejeitar/anular.
 *   npm test
 *
 * Base de dados temporária própria; sem chave de IA (nunca chama a API).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pasta = mkdtempSync(join(tmpdir(), "nwl-avisos-"));
process.env.DATABASE_PATH = join(pasta, "teste.db");
delete process.env.MONITOR_INICIO;
delete process.env.HEALTHCHECK_URL;
delete process.env.ANTHROPIC_API_KEY;
process.env.AVISOS_REMETENTES = "Ana@Exemplo.pt, invalido, outra@exemplo.pt";

const { remetentesAutorizados, eRemetenteDeAvisos } = await import("../src/lib/avisos-remetentes.ts");
const { erroDaPausa, criarPausa, anularPausa, pausaNoDia } = await import("../src/lib/pausas.ts");
const avisos = await import("../src/lib/avisos.ts");
const { classificar } = await import("../src/lib/classificacao.ts");
const registos = await import("../src/lib/registos.ts");
const { newsletterPorId } = await import("../config/newsletters.ts");
const { dataLocal, paraInstante, somarDias, diaSemanaISO } = await import("../src/lib/tempo.ts");
const { feriado } = await import("../src/lib/feriados.ts");
const { db, fecharDb } = await import("../src/lib/db.ts");

test.after(() => {
  fecharDb();
  rmSync(pasta, { recursive: true, force: true });
});

const hoje = dataLocal();
/** Um dia útil sem feriado, pelo menos `n` dias depois de hoje. */
function diaUtil(n: number): string {
  let d = somarDias(hoje, n);
  while (diaSemanaISO(d) > 5 || feriado(d)) d = somarDias(d, 1);
  return d;
}

test("remetentes autorizados: só endereços válidos, sem maiúsculas, endereço exato", () => {
  assert.deepEqual(remetentesAutorizados(), ["ana@exemplo.pt", "outra@exemplo.pt"]);
  assert.equal(eRemetenteDeAvisos("Ana Rua <ANA@exemplo.pt>"), true);
  assert.equal(eRemetenteDeAvisos("ana@exemplo.pt.falso.com"), false);
  assert.equal(eRemetenteDeAvisos("alguem@exemplo.pt"), false);
  assert.equal(eRemetenteDeAvisos("ana@exemplo.pt", []), false, "lista vazia = funcionalidade desligada");
});

test("regras de uma pausa", () => {
  const base = { newsletterId: "negocios-abertura", de: "2026-12-08", ate: "2026-12-08", motivo: "Feriado" };
  assert.equal(erroDaPausa(base, "2026-11-10"), null);
  assert.match(erroDaPausa({ ...base, newsletterId: "nao-existe" }, "2026-11-10")!, /desconhecida/);
  assert.match(erroDaPausa({ ...base, ate: "2026-12-01" }, "2026-11-10")!, /anterior/);
  assert.match(erroDaPausa({ ...base, de: "2026-12-32" }, "2026-11-10")!, /inválidas/);
  assert.match(erroDaPausa({ ...base, ate: "2027-06-01" }, "2026-11-10")!, /não pode passar/);
  assert.match(erroDaPausa({ ...base, de: "2026-08-01", ate: "2026-08-02" }, "2026-11-10")!, /para trás/);
  assert.match(erroDaPausa({ ...base, motivo: "  " }, "2026-11-10")!, /motivo/);
});

test("propostas da IA: inválidas quando a newsletter, as datas ou a citação falham", () => {
  const texto = "Olá! Por causa do feriado, a Abertura não sai dia 8 de dezembro. Obrigada, Ana";
  const p = avisos.validarPropostas(
    [
      { newsletter_id: "negocios-abertura", de: "2026-12-08", ate: "2026-12-08", motivo: "Feriado", citacao: "a Abertura  não sai dia 8 de dezembro" },
      { newsletter_id: "negocios-abertura", de: "2026-12-08", ate: "2026-12-08", motivo: "Feriado", citacao: "não sai durante todo o mês" },
      { newsletter_id: "inventada", de: "2026-12-08", ate: "2026-12-08", motivo: "x", citacao: "não sai dia 8" },
      { newsletter_id: "negocios-abertura", de: "2026-12-09", ate: "2026-12-08", motivo: "x", citacao: "não sai dia 8" },
    ],
    texto,
    "2026-11-10",
  );
  assert.deepEqual(p.map((x) => x.estado), ["por-decidir", "invalida", "invalida", "invalida"]);
  assert.match(p[1].erro!, /citação/);
});

test("texto do email: sem etiquetas nem estilos, com parágrafos e entidades", () => {
  const t = avisos.textoDoEmail("<style>p{x}</style><p>Olá&nbsp;equipa,</p><p>A <b>Abertura</b> n&atilde;o sai &#8211; dia 8.</p>");
  assert.equal(t, "Olá equipa,\nA Abertura não sai – dia 8.");
});

test("motor de estados: pausa sem email é 6; com email conta como saída", () => {
  const n = newsletterPorId("negocios-abertura")!;
  const dia = "2026-11-04";
  const ctx = {
    newsletter: n,
    dataPrevista: dia,
    horaLimite: paraInstante(dia, "11:00"),
    ocorrencias: [] as { recebidoEm: Date; hash: string }[],
    edicaoAnterior: null,
    fechado: true,
  };
  assert.equal(classificar(ctx).codigo, 5);
  const r = classificar({ ...ctx, pausa: { motivo: "Feriado da redação" } });
  assert.equal(r.codigo, 6);
  assert.match(r.detalhe, /Pausa anunciada \(Feriado da redação\)/);
  const comEmail = classificar({
    ...ctx,
    pausa: { motivo: "Feriado da redação" },
    ocorrencias: [{ recebidoEm: paraInstante(dia, "10:31"), hash: "abc" }],
  });
  assert.notEqual(comEmail.codigo, 6);
});

test("pausa no painel: cria, reavalia o registo e anula com rasto", () => {
  const dia = diaUtil(7);
  registos.gerarDia(dia);
  assert.notEqual(registos.registoDe("negocios-abertura", dia)!.codigo_estado, 6);

  const r = criarPausa({ newsletterId: "negocios-abertura", de: dia, ate: dia, motivo: "Teste" }, { tipo: "painel" }, "teste");
  assert.equal(r.ok, true, r.mensagem);
  assert.ok(pausaNoDia("negocios-abertura", dia));
  assert.equal(registos.registoDe("negocios-abertura", dia)!.codigo_estado, 6);

  assert.equal(anularPausa(r.id!, "teste").ok, true);
  assert.equal(pausaNoDia("negocios-abertura", dia), null);
  assert.notEqual(registos.registoDe("negocios-abertura", dia)!.codigo_estado, 6);
  const rasto = db().prepare(`SELECT acao FROM alteracoes WHERE acao LIKE 'pausa-%' ORDER BY id`).all() as { acao: string }[];
  assert.deepEqual(rasto.map((x) => x.acao), ["pausa-criada", "pausa-anulada"]);
});

test("aviso: sem chave fica para tratar à mão; uma proposta só se aplica por alguém", async () => {
  const dia = diaUtil(14);
  const e = db()
    .prepare(
      `INSERT INTO emails (internet_message_id, remetente, assunto, recebido_em, corpo_html, newsletter_id)
       VALUES ('<aviso@t>', 'Ana <ana@exemplo.pt>', 'Feriado', ?, '<p>A Abertura não sai.</p>', NULL)`,
    )
    .run(new Date().toISOString());
  avisos.registarAvisos([{ id: Number(e.lastInsertRowid), remetente: "Ana <ana@exemplo.pt>", assunto: "Feriado", recebidoEm: new Date().toISOString() }]);

  assert.match((await avisos.interpretarPendentes())!, /tratar à mão/);
  const [a] = avisos.listarAvisos();
  assert.equal(a.estado, "sem-ia");
  assert.equal(a.texto, "A Abertura não sai.");
  assert.equal(avisos.reinterpretarAviso(a.id, "teste").ok, false, "sem chave não se pede leitura");

  // Como se a IA tivesse proposto duas pausas: aplicar uma, rejeitar a outra.
  const propostas = avisos.validarPropostas(
    [
      { newsletter_id: "negocios-abertura", de: dia, ate: dia, motivo: "Feriado", citacao: "A Abertura não sai." },
      { newsletter_id: "negocios-opiniao", de: dia, ate: dia, motivo: "Feriado", citacao: "A Abertura não sai." },
    ],
    a.texto,
    hoje,
  );
  db().prepare(`UPDATE avisos SET estado = 'proposto', propostas = ? WHERE id = ?`).run(JSON.stringify(propostas), a.id);
  assert.equal(pausaNoDia("negocios-abertura", dia), null, "nada se aplica sozinho");

  assert.equal(avisos.aplicarProposta(a.id, 0, "teste").ok, true);
  assert.equal(avisos.aplicarProposta(a.id, 0, "teste").ok, false, "não se aplica duas vezes");
  assert.ok(pausaNoDia("negocios-abertura", dia));
  assert.equal(avisos.listarAvisos()[0].estado, "proposto");
  assert.equal(avisos.rejeitarProposta(a.id, 1, "teste").ok, true);
  assert.equal(pausaNoDia("negocios-opiniao", dia), null);
  const depois = avisos.listarAvisos().find((x) => x.id === a.id)!;
  assert.equal(depois.estado, "tratado");
  assert.deepEqual(depois.propostas.map((p) => p.estado), ["aplicada", "rejeitada"]);
});
