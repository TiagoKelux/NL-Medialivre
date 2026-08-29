/**
 * Mete um ficheiro .eml no sistema, como se tivesse vindo do Graph.
 *
 *   npm run email -- "C:/caminho/newsletter.eml"
 *
 * Serve para testar sem acesso à caixa, e para reprocessar casos difíceis.
 * Passa pelo mesmo caminho que a recolha automática: mesma correspondência,
 * mesma deduplicação por Message-ID, mesma reclassificação.
 */
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db.ts";
import { lerEml } from "../src/lib/eml.ts";
import { corresponder, extrairEndereco, extrairNome } from "../src/lib/correspondencia.ts";
import { processarCorpo } from "../src/lib/conteudo.ts";
import { reavaliar } from "../src/lib/registos.ts";
import { dataLocal, horaLocal, paraIso } from "../src/lib/tempo.ts";

const caminho = process.argv[2];
if (!caminho) {
  console.error('Uso: npm run email -- "caminho/para/ficheiro.eml"');
  process.exit(1);
}

const email = lerEml(readFileSync(caminho, "latin1"));
const dia = dataLocal(email.data);

console.log("Lido do ficheiro:");
console.log(`  Remetente : ${email.remetente}`);
console.log(`    endereço: ${extrairEndereco(email.remetente)}`);
console.log(`    nome    : ${extrairNome(email.remetente)}`);
console.log(`  Assunto   : ${email.assunto}`);
console.log(`  Recebido  : ${dia} às ${horaLocal(email.data)} (hora de Lisboa)`);
console.log(`  Corpo     : ${email.corpoHtml.length} caracteres de HTML`);

const n = corresponder(email.remetente, email.assunto);
if (!n) {
  console.log("\nNenhuma newsletter configurada reconhece este email.");
  console.log("Preenche `remetentes` e `padraoRemetente`/`padraoAssunto` em config/newsletters.ts.");
}

const { normalizado, hash } = processarCorpo(email.corpoHtml);

const res = db()
  .prepare(
    `INSERT OR IGNORE INTO emails
       (internet_message_id, remetente, assunto, recebido_em,
        corpo_html, corpo_normalizado, hash_conteudo, newsletter_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  .run(
    email.internetMessageId,
    email.remetente,
    email.assunto,
    paraIso(email.data),
    email.corpoHtml,
    normalizado,
    hash,
    n?.id ?? null,
  );

console.log(res.changes === 0 ? "\nJá estava gravado (mesmo Message-ID)." : "\nGravado.");

if (n) {
  const r = reavaliar(n.id, dia);
  console.log(`Atribuído a: ${n.marca} · ${n.nome} (${n.id})`);
  console.log(`Registo de ${dia}: código ${r?.codigo_estado}`);
  console.log(`  ${r?.detalhe}`);
}
