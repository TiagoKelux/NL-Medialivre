/**
 * Calibração do perfil de cada newsletter (src/lib/perfil.ts), sobre dados reais.
 *   npm run calibrar-perfis [caminho/monitor.db]
 *
 * Trabalha sobre uma CÓPIA da base (ver perfis-dados.ts). Para cada edição de
 * cada newsletter, o perfil é aprendido só com as edições ANTERIORES e a
 * edição é julgada pelo código de produção (`historico`, `perfilDe`,
 * `sinaisConteudo`) — exatamente como o monitor a julgaria nesse dia.
 *
 * Imprime, por newsletter, o perfil aprendido e cada edição que daria prova
 * de conteúdo desatualizado (código 4) ou um aviso. Sai com código 1 se
 * alguma prova disparar: depois de mexer nos limiares em perfil.ts, correr
 * isto sobre uma cópia da produção — as edições legítimas não podem dar prova.
 * (Uma edição antiga realmente reenviada também daria 1: ver qual é.)
 */
import {
  abrirCopia,
  avaliarTudo,
  caminhoDaBase,
  coberturaDatas,
  dataTopo,
  desvio,
  horaMais,
  horas,
  pct,
  provaDe,
  quantil,
} from "./perfis-dados.ts";

const caminho = caminhoDaBase(process.argv[2]);
const fechar = await abrirCopia(caminho);

let total = 0;
let medidasContraPerfil = 0;
let frescas = 0;
const provas: string[] = [];
const avisos: string[] = [];
const semHistorico: string[] = [];

try {
  const tudo = avaliarTudo();
  console.log(`Base: ${caminho} (cópia)\n`);
  for (const { n, edicoes, perfilAtual: p } of tudo) {
    if (!edicoes.length) {
      if (n.ativa) semHistorico.push(n.id);
      continue;
    }
    total += edicoes.length;
    const desvios = edicoes.map((e) => e.desvioMin);
    const cob = coberturaDatas(edicoes);
    const topo = dataTopo(edicoes);
    const reusos = edicoes.map((e) => e.reuso).filter((x): x is number => x !== null);
    console.log(`■ ${n.id} — ${n.marca} ${n.nome} (${edicoes.length} edições, ${edicoes[0].data} a ${edicoes.at(-1)!.data})`);
    console.log(
      `  envio: prevista ${n.horaPrevista}, mediana ${horaMais(n.horaPrevista, quantil(desvios, 0.5))} ` +
        `(${desvio(quantil(desvios, 0.5))}), p90 ${horaMais(n.horaPrevista, quantil(desvios, 0.9))} ` +
        `(${desvio(quantil(desvios, 0.9))})`,
    );
    console.log(
      `  artigos: ${p.artigos ? `mediana ${p.artigos.mediana}, ${p.artigos.min} a ${p.artigos.max}` : "sem perfil"}` +
        ` · com data: ${cob.total ? `${pct(cob.com / cob.total)} de ${cob.total}` : "—"}`,
    );
    console.log(
      `  mais recente: ${p.idade ? `p50 ${horas(p.idade.p50)}, p90 ${horas(p.idade.p90)}, máx ${horas(p.idade.max)} (${p.idade.edicoes} ed.)` : "sem perfil"}` +
        ` · reuso p90: ${p.reusoP90 !== null ? pct(p.reusoP90) : reusos.length ? `sem perfil (máx ${pct(Math.max(...reusos))})` : "—"}` +
        ` · data no topo: ${p.dataNoTopo ? "sempre" : "não"} (certa ${topo.certa}, errada ${topo.errada}, sem ${topo.sem})`,
    );
    for (const e of edicoes) {
      if (e.perfil.idade && e.maisRecente !== null) {
        medidasContraPerfil++;
        if (e.sinais.frescoProvado) frescas++;
      }
      const prova = provaDe(e);
      if (prova) {
        const l = `${n.id} ${e.data}: PROVA — ${prova}`;
        provas.push(l);
        console.log(`  ✖ ${e.data} PROVA (${e.anteriores} anteriores): ${prova}`);
      }
      for (const a of e.sinais.avisos) {
        avisos.push(`${n.id} ${e.data}: ${a}`);
        console.log(`  ⚠ ${e.data} aviso (${e.anteriores} anteriores): ${a.replace(/^⚠\s*/, "")}`);
      }
    }
    console.log("");
  }
} finally {
  fechar();
}

console.log("── Resumo ──");
console.log(`${total} edições avaliadas; ${medidasContraPerfil} medidas pela idade contra um perfil (${frescas} dentro do normal).`);
console.log(`${provas.length} provas de conteúdo desatualizado, ${avisos.length} avisos.`);
if (semHistorico.length) console.log(`Ativas sem nenhuma edição na base (${semHistorico.length}): ${semHistorico.join(", ")}`);
for (const l of provas) console.log("  ✖ " + l);
if (provas.length) process.exitCode = 1;
