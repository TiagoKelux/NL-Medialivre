/**
 * Calibração do limiar de artigos repetidos, sobre dados reais.
 *   node scripts/calibrar-artigos.ts [caminho/monitor.db]
 *
 * Abre a base de dados SÓ PARA LEITURA. Para cada newsletter, compara cada
 * edição (o primeiro envio do dia, como o motor de estados) com a edição
 * anterior efetivamente recebida (o último envio do dia anterior com
 * emails), e imprime a semelhança dos artigos e a distribuição do Jaccard.
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { NEWSLETTERS } from "../config/newsletters.ts";
import { extrairArtigos, processarCorpo, semelhancaArtigos } from "../src/lib/conteudo.ts";
import { LIMIAR_ARTIGOS, MIN_ARTIGOS } from "../src/lib/classificacao.ts";
import { dataEdicao } from "../src/lib/edicao.ts";
import { horaLocal } from "../src/lib/tempo.ts";

const caminho = resolve(process.argv[2] || process.env.DATABASE_PATH || "./data/monitor.db");
const bd = new Database(caminho, { readonly: true, fileMustExist: true });

interface Linha {
  id: number;
  recebido_em: string;
  assunto: string;
  corpo_html: string;
}

const pares: { nl: string; data: string; anterior: string; j: number | null; iguais: number; total: number; hash: boolean }[] = [];

for (const n of NEWSLETTERS) {
  const linhas = bd
    .prepare(`SELECT id, recebido_em, assunto, corpo_html FROM emails WHERE newsletter_id = ? ORDER BY recebido_em`)
    .all(n.id) as Linha[];
  if (linhas.length === 0) continue;

  const porDia = new Map<string, Linha[]>();
  for (const l of linhas) {
    const d = dataEdicao(n, new Date(l.recebido_em));
    porDia.set(d, [...(porDia.get(d) ?? []), l]);
  }
  const dias = [...porDia.keys()].sort();
  for (let i = 1; i < dias.length; i++) {
    const atual = porDia.get(dias[i])![0];
    const lista = porDia.get(dias[i - 1])!;
    const anterior = lista[lista.length - 1];
    const s = semelhancaArtigos(extrairArtigos(atual.corpo_html), extrairArtigos(anterior.corpo_html));
    const hash = processarCorpo(atual.corpo_html).hash === processarCorpo(anterior.corpo_html).hash;
    pares.push({
      nl: n.id,
      data: dias[i],
      anterior: dias[i - 1],
      j: s?.jaccard ?? null,
      iguais: s?.iguais ?? 0,
      total: s?.total ?? 0,
      hash,
    });
    console.log(
      `${n.id.padEnd(22)} ${dias[i]} ${horaLocal(new Date(atual.recebido_em))} vs ${dias[i - 1]}  ` +
        `${s ? `J=${s.jaccard.toFixed(2)} (${s.iguais}/${s.total})` : "sem artigos       "}` +
        `${hash ? "  hash igual → 4" : s && s.jaccard === 1 && s.total >= MIN_ARTIGOS ? "  mesmos artigos → 4" : s && s.jaccard >= LIMIAR_ARTIGOS ? "  ⚠ provavelmente repetida" : ""}` +
        `  ${atual.assunto.slice(0, 60)}`,
    );
  }
}

console.log(`\nDistribuição do Jaccard (${pares.length} pares, limiar atual ${LIMIAR_ARTIGOS}):`);
const faixas: [string, (j: number | null) => boolean][] = [
  ["sem artigos", (j) => j === null],
  ["0.00", (j) => j === 0],
  ["]0.00, 0.20[", (j) => j !== null && j > 0 && j < 0.2],
  ["[0.20, 0.40[", (j) => j !== null && j >= 0.2 && j < 0.4],
  ["[0.40, 0.60[", (j) => j !== null && j >= 0.4 && j < 0.6],
  ["[0.60, 0.70[", (j) => j !== null && j >= 0.6 && j < 0.7],
  ["[0.70, 0.80[", (j) => j !== null && j >= 0.7 && j < 0.8],
  ["[0.80, 1.00[", (j) => j !== null && j >= 0.8 && j < 1],
  ["1.00", (j) => j === 1],
];
for (const [nome, f] of faixas) {
  const casos = pares.filter((p) => f(p.j));
  const exemplos = casos.filter((p) => p.j !== null && p.j >= 0.6).map((p) => `${p.nl} ${p.data}`);
  console.log(`  ${nome.padEnd(13)} ${String(casos.length).padStart(3)}${exemplos.length ? `  ${exemplos.join(", ")}` : ""}`);
}
bd.close();
