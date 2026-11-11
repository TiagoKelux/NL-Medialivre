/**
 * Testes do Excel de controlo por email (Power Automate): o anexo é lido do
 * email, importado só de remetentes autorizados, e um anexo partido (o texto
 * "Conteúdo do ficheiro" em vez do Excel) fica registado como falha sem
 * importar nada.
 *   npm test
 *
 * Base de dados temporária própria: nunca toca em data/monitor.db.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pasta = mkdtempSync(join(tmpdir(), "nwl-controlo-email-"));
process.env.DATABASE_PATH = join(pasta, "teste.db");
delete process.env.MONITOR_INICIO;
delete process.env.HEALTHCHECK_URL;
delete process.env.AVISOS_REMETENTES;
process.env.CONTROLO_REMETENTES = "AnaRua@Exemplo.pt";

const { construirXlsx } = await import("../src/lib/excel.ts");
const { lerEml } = await import("../src/lib/eml.ts");
const { recolher } = await import("../src/lib/recolha.ts");
const { ultimoExcelPorEmail } = await import("../src/lib/controlo-email.ts");
const { ultimasImportacoes } = await import("../src/lib/controlo-cliente.ts");
const { eRemetenteDoCliente } = await import("../src/lib/avisos-remetentes.ts");
const { db, fecharDb } = await import("../src/lib/db.ts");

test.after(() => {
  fecharDb();
  rmSync(pasta, { recursive: true, force: true });
});

type V = string | number | null;

/** Folha "TODOS OS DIAS" mínima (28/10 a 03/11/2026), como no controlo.test.ts. */
function excel(): Buffer {
  const vazio = (n: number): V[] => Array.from({ length: n }, () => null);
  const r1 = vazio(13).concat([null, null, null, null, "NOVEMBRO", null, null]);
  r1[13] = "OUTUBRO";
  const linhas: V[][] = [
    r1,
    vazio(20),
    vazio(13).concat([28, 29, 30, 31, 1, 2, 3]),
    vazio(13).concat(["4ª", "5ª", "6ª", "S", "D", "2ª", "3ª"]),
    [null, "CM", "Exclusivos", ...vazio(10), 1, 1, 1, 1, 1, 1, null],
  ];
  return construirXlsx([{ nome: "TODOS OS DIAS", linhas }]);
}

/** Email multipart/mixed como o do Outlook, com o anexo em base64. */
function eml(anexo: Buffer, id: string): string {
  const b64 = anexo.toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    "From: Ana Rua <AnaRua@exemplo.pt>",
    "Subject: =?iso-8859-1?Q?Relat=F3rio_Di=E1rio_Newsletters?=",
    `Message-ID: <${id}>`,
    "Date: Wed, 11 Nov 2026 19:00:00 +0000",
    'Content-Type: multipart/mixed; boundary="_004_X_"',
    "",
    "--_004_X_",
    'Content-Type: multipart/alternative; boundary="_000_X_"',
    "",
    "--_000_X_",
    'Content-Type: text/html; charset="iso-8859-1"',
    "",
    "<p>Segue em anexo.</p>",
    "--_000_X_--",
    "",
    "--_004_X_",
    "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;",
    '\tname="=?iso-8859-1?Q?Newsletters_Hor=E1rios.xlsx?="',
    "Content-Disposition: attachment;",
    '\tfilename="=?iso-8859-1?Q?Newsletters_Hor=E1rios.xlsx?="; size=21;',
    "Content-Transfer-Encoding: base64",
    "",
    b64,
    "",
    "--_004_X_--",
    "",
  ].join("\r\n");
}

test("o leitor de .eml tira o anexo .xlsx, com o nome descodificado", () => {
  const conteudo = excel();
  const l = lerEml(eml(conteudo, "a@t").toString());
  assert.equal(l.anexos.length, 1);
  assert.equal(l.anexos[0].nome, "Newsletters Horários.xlsx");
  assert.ok(l.anexos[0].conteudo.equals(conteudo));
  assert.match(l.corpoHtml, /Segue em anexo/);
});

function mensagem(id: string, remetente: string, anexo: Buffer) {
  const l = lerEml(eml(anexo, id));
  return {
    internetMessageId: id,
    receivedDateTime: new Date().toISOString(),
    from: { emailAddress: { address: remetente } },
    subject: l.assunto,
    body: { contentType: "html", content: l.corpoHtml },
    anexos: l.anexos,
  };
}

const semRede = async () => ({ ok: true });

test("anexo partido (texto em vez do Excel): não importa nada e fica a falha", async () => {
  const partido = Buffer.from("Conteúdo do ficheiro", "utf8");
  await recolher(24, async () => [mensagem("partido@t", "Ana Rua <AnaRua@exemplo.pt>", partido)], semRede);
  assert.equal(ultimasImportacoes().length, 0);
  const r = ultimoExcelPorEmail()!;
  assert.equal(r.ok, false);
  assert.equal(r.bytes, partido.length);
  assert.match(r.mensagem, /não é um Excel/);
  // Não é edição de nenhuma newsletter nem fica "por atribuir".
  const e = db().prepare(`SELECT newsletter_id FROM emails WHERE internet_message_id = 'partido@t'`).get() as {
    newsletter_id: string | null;
  };
  assert.equal(e.newsletter_id, null);
  assert.equal(eRemetenteDoCliente("Ana Rua <AnaRua@exemplo.pt>"), true);
});

test("Excel válido do remetente autorizado: importado como no /controlo", async () => {
  await recolher(24, async () => [mensagem("bom@t", "Ana Rua <anarua@exemplo.pt>", excel())], semRede);
  const imp = ultimasImportacoes();
  assert.equal(imp.length, 1);
  assert.equal(imp[0].ficheiro, "Newsletters Horários.xlsx");
  assert.equal(imp[0].quem, "email: anarua@exemplo.pt");
  assert.ok(imp[0].marcas > 0);
  const r = ultimoExcelPorEmail()!;
  assert.equal(r.ok, true, r.mensagem);
});

test("o mesmo Excel de outro endereço não importa", async () => {
  await recolher(24, async () => [mensagem("fora@t", "Ana Rua <anarua@outro.pt>", excel())], semRede);
  assert.equal(ultimasImportacoes().length, 1, "continua só a importação anterior");
  assert.equal(ultimoExcelPorEmail()!.remetente, "Ana Rua <anarua@exemplo.pt>");
});
