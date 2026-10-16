/**
 * Corrige o passado quando o calendário no Excel estava errado.
 *
 *   npm run recalendarizar -- negocios-lex 2026-09-01 2026-10-15
 *   npm run recalendarizar -- todas 2026-09-01 2026-10-15
 *
 * Por defeito, o calendário de cada dia congela quando o dia passa: corrigir o
 * Excel hoje não mexe no histórico. Este comando é a exceção deliberada —
 * aplica o calendário ATUAL (config/newsletters.ts, depois do `npm run
 * importar`) aos dias indicados, reavalia-os e deixa rasto em `alteracoes`.
 * Com o monitor a correr no servidor, corre-se lá (docs/SERVIDOR.md).
 */
import { db } from "../src/lib/db.ts";
import { newsletterPorId } from "../config/newsletters.ts";
import { descongelar } from "../src/lib/calendario.ts";
import { reavaliar } from "../src/lib/registos.ts";
import { ehData } from "../src/lib/periodo.ts";

const [alvo, de, ate] = process.argv.slice(2);
if (!alvo || !ehData(de) || !ehData(ate) || de > ate) {
  console.error("Uso: npm run recalendarizar -- <newsletter|todas> <de AAAA-MM-DD> <ate AAAA-MM-DD>");
  process.exit(1);
}
const id = alvo === "todas" ? null : alvo;
if (id && !newsletterPorId(id)) {
  console.error(`Newsletter desconhecida: ${id}`);
  process.exit(1);
}

const antes = db()
  .prepare(
    `SELECT newsletter_id, data_prevista, codigo_estado FROM registos
      WHERE data_prevista BETWEEN ? AND ? AND (? IS NULL OR newsletter_id = ?)`,
  )
  .all(de, ate, id, id) as { newsletter_id: string; data_prevista: string; codigo_estado: number }[];

const bd = db();
let mudaram = 0;
bd.transaction(() => {
  descongelar(id, de, ate);
  for (const r of antes) {
    const novo = reavaliar(r.newsletter_id, r.data_prevista);
    if (novo && novo.codigo_estado !== r.codigo_estado) {
      mudaram++;
      console.log(`  ${r.newsletter_id} ${r.data_prevista}: ${r.codigo_estado} → ${novo.codigo_estado}`);
    }
  }
  bd.prepare(`INSERT INTO alteracoes (em, quem, acao, detalhe) VALUES (?, ?, ?, ?)`).run(
    new Date().toISOString(),
    "linha de comandos",
    "Calendário reaplicado ao passado",
    `${id ?? "todas as newsletters"}, de ${de} a ${ate}: ${antes.length} registos, ${mudaram} mudaram de código`,
  );
})();
console.log(`${antes.length} registos reavaliados com o calendário atual; ${mudaram} mudaram de código.`);
