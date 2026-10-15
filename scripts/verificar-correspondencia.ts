/**
 * Corre o matcher verdadeiro sobre todos os emails guardados, só em leitura.
 *   npm run verificar [caminho/para/monitor.db]
 *
 * Mostra, por newsletter, quantos emails lhe cabem agora; os emails que
 * continuam sem dono; e os que serviriam a MAIS do que uma regra (tem de ser
 * zero — esses ficam por atribuir, ou caem na regra mais específica).
 */
import Database from "better-sqlite3";
import { NEWSLETTERS, estaConfigurada } from "../config/newsletters.ts";
import { corresponder, naoEEdicao } from "../src/lib/correspondencia.ts";

const caminho = process.argv[2] ?? process.env.DATABASE_PATH ?? "data/monitor.db";
const db = new Database(caminho, { readonly: true, fileMustExist: true });
const emails = db
  .prepare("SELECT remetente, assunto, recebido_em, corpo_html FROM emails ORDER BY recebido_em")
  .all() as { remetente: string; assunto: string; recebido_em: string; corpo_html: string }[];
db.close();

const contagem = new Map<string, number>();
const semDono: string[] = [];
const naoEdicoes: string[] = [];
const ambiguos: string[] = [];

for (const e of emails) {
  const linha = `${e.recebido_em.slice(0, 16)}  ${e.remetente}  |  ${e.assunto}`;
  // Uma regra de cada vez: quantas serviriam sozinhas?
  const servem = NEWSLETTERS.filter((n) => corresponder(e.remetente, e.assunto, e.corpo_html, [n]));
  if (servem.length > 1) ambiguos.push(`${linha}\n      → ${servem.map((n) => n.id).join(", ")}`);

  const n = corresponder(e.remetente, e.assunto, e.corpo_html);
  if (n) contagem.set(n.id, (contagem.get(n.id) ?? 0) + 1);
  else if (naoEEdicao(e.assunto)) naoEdicoes.push(linha);
  else semDono.push(linha);
}

console.log(`${emails.length} emails em ${caminho}\n`);
console.log("Newsletter".padEnd(38) + "Regra".padEnd(104) + "Emails");
for (const n of NEWSLETTERS) {
  if (!n.ativa && !contagem.has(n.id) && !estaConfigurada(n)) continue;
  const partes = [n.remetentes.join(",")];
  if (n.marcaCorpo) partes.push(`corpo "${n.marcaCorpo}"`);
  if (n.padraoRemetente) partes.push(`nome "${n.padraoRemetente}"`);
  if (n.padraoAssunto) partes.push(`assunto "${n.padraoAssunto}"`);
  const regra = estaConfigurada(n) ? partes.join(" · ") : "(sem regra)";
  const marca = n.ativa ? "" : " [inativa]";
  console.log(`${(n.id + marca).padEnd(38)}${regra.padEnd(104)}${contagem.get(n.id) ?? 0}`);
}

console.log(`\nSem dono (${semDono.length}):`);
for (const l of semDono) console.log("  " + l);
console.log(`\nMarketing / boas-vindas com assunto conhecido (${naoEdicoes.length}):`);
for (const l of naoEdicoes) console.log("  " + l);
console.log(`\nServem a mais do que uma regra (${ambiguos.length}):`);
for (const l of ambiguos) console.log("  " + l);
if (ambiguos.length) process.exitCode = 1;
