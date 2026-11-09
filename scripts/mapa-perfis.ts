/**
 * Gera docs/PERFIS-NEWSLETTERS.md — o mapa de características de cada
 * newsletter, tal como o monitor a vê — a partir dos dados.
 *   npm run mapa-perfis [caminho/monitor.db] [--saida ficheiro.md]
 *
 * Trabalha sobre uma CÓPIA da base (ver perfis-dados.ts) e usa o código de
 * produção (src/lib/perfil.ts). Nenhum número do documento é escrito à mão:
 * para o atualizar, correr isto outra vez sobre uma cópia da produção.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { NEWSLETTERS } from "../config/newsletters.ts";
import { publicadoEm } from "../src/lib/datas-artigos.ts";
import {
  AVISO_SEM_PERFIL_DIAS,
  COBERTURA_MINIMA,
  DIAS_DE_HISTORICO,
  FATOR_IDADE,
  LIMITE_MIN_DIAS,
  MIN_DATADOS,
  MIN_EDICOES_PERFIL,
  type Perfil,
} from "../src/lib/perfil.ts";
import { diaMes, horaLocal } from "../src/lib/tempo.ts";
import type { Newsletter } from "../src/lib/tipos.ts";
import {
  abrirCopia,
  avaliarTudo,
  caminhoDaBase,
  calendario,
  coberturaDatas,
  dataTopo,
  desvio,
  diasVistos,
  foraDoCalendario,
  horaMais,
  horas,
  pct,
  provaDe,
  quantil,
  sites,
  type Avaliacao,
  type EdicaoAvaliada,
} from "./perfis-dados.ts";

/**
 * Limiares que perfil.ts usa sem os exportar. TÊM de ser iguais aos de
 * `sinaisConteudo` e `perfilDe`; se lá mudarem, mudar aqui.
 */
const ESPELHO = {
  /** Artigos mínimos para "os mesmos artigos" e para o aviso de reaproveitamento. */
  minArtigos: 3,
  /** Aviso: mais recente acima de max(1 dia, FATOR_MAX × máximo do perfil). */
  fatorMax: 1.5,
  /** Aviso de reaproveitamento: pelo menos isto e acima do p90 + margem. */
  reusoMinimo: 0.8,
  reusoMargem: 0.2,
  /** "Escreve sempre a data no topo": certa em pelo menos esta fração. */
  habitoTopo: 0.9,
};

const args = process.argv.slice(2);
const iSaida = args.indexOf("--saida");
const saida = resolve(iSaida >= 0 ? args[iSaida + 1] : "docs/PERFIS-NEWSLETTERS.md");
const posicionais = iSaida >= 0 ? args.filter((_, i) => i !== iSaida && i !== iSaida + 1) : args;
const caminho = caminhoDaBase(posicionais[0]);

// A cópia fica aberta até ao fim (as datas dos artigos lêem-se dela) e é
// apagada à saída, corra bem ou mal.
process.on("exit", await abrirCopia(caminho));
const tudo: Avaliacao[] = avaliarTudo();
/** Por site: artigos datados e quantos só trazem o dia (00:00 em Lisboa). */
const precisao = new Map<string, { datados: number; soDia: number }>();
for (const u of new Set(tudo.flatMap((a) => a.edicoes.flatMap((e) => e.vista.artigos)))) {
  const p = publicadoEm(u);
  if (p === undefined) continue;
  const s = siteDe(u);
  const c = precisao.get(s) ?? { datados: 0, soDia: 0 };
  c.datados++;
  // Só o dia: a página escreve "2026-10-27", que se lê como 00:00 UTC (ou 00:00 em Lisboa).
  if (new Date(p).toISOString().endsWith("T00:00:00.000Z") || horaLocal(new Date(p)) === "00:00") c.soDia++;
  precisao.set(s, c);
}

function siteDe(u: string): string {
  return u.split("/")[0].replace(/^www\./, "");
}
const soDia = (s: string) => {
  const c = precisao.get(s);
  return !!c && c.soDia / c.datados >= 0.9;
};

const comEdicoes = tudo.filter((a) => a.edicoes.length > 0);
const todas = comEdicoes.flatMap((a) => a.edicoes);
const datas = todas.map((e) => e.data).sort();
const fimBase = datas.at(-1)!;
const artigosDistintos = new Set(todas.flatMap((e) => e.vista.artigos));
const datados = [...artigosDistintos].filter((u) => publicadoEm(u) !== undefined).length;
const nProvas = todas.filter((e) => provaDe(e)).length;
const nAvisos = todas.reduce((s, e) => s + e.sinais.avisos.length, 0);
const nMedidas = todas.filter((e) => e.perfil.idade && e.maisRecente !== null).length;

const nome = (n: Newsletter) => `${n.marca} — ${n.nome}`;
const comPerfil = (p: Perfil) => p.edicoes >= MIN_EDICOES_PERFIL;
const dataPt = (d: string) => d.split("-").reverse().join("/");
const percent = (x: number) => `${Math.round(x * 100)}%`;

/** Os limiares concretos desta newsletter, a partir do perfil atual. */
function limiares(p: Perfil) {
  return {
    prova: p.idade ? Math.max(LIMITE_MIN_DIAS, FATOR_IDADE * p.idade.p90) : null,
    aviso: p.idade ? Math.max(1, ESPELHO.fatorMax * p.idade.max) : null,
    reuso: p.reusoP90 !== null ? Math.max(ESPELHO.reusoMinimo, p.reusoP90 + ESPELHO.reusoMargem) : null,
    artigos: p.artigos ? { abaixo: Math.floor(p.artigos.min / 2), acima: Math.ceil(p.artigos.max * 1.5) } : null,
  };
}

function envio(a: Avaliacao): { mediana: string; p90: string } {
  const d = a.edicoes.map((e) => e.desvioMin);
  const m = quantil(d, 0.5);
  const p = quantil(d, 0.9);
  return {
    mediana: `${horaMais(a.n.horaPrevista, m)} (${desvio(m)})`,
    p90: `${horaMais(a.n.horaPrevista, p)} (${desvio(p)})`,
  };
}

function idadeTxt(p: Perfil): string {
  return p.idade ? `${horas(p.idade.p50)} (p90 ${horas(p.idade.p90)}, máx. ${horas(p.idade.max)})` : "—";
}

function topoTxt(a: Avaliacao): string {
  const t = dataTopo(a.edicoes);
  const total = a.edicoes.length;
  if (a.perfilAtual.dataNoTopo) return `sim, sempre (certa em ${t.certa} de ${total})`;
  if (t.certa + t.errada === 0) return "não";
  return `não é hábito (certa em ${t.certa} de ${total}${t.errada ? `, outra data em ${t.errada}` : ""})`;
}

function precisaoTxt(eds: EdicaoAvaliada[]): string {
  const s = new Set(eds.flatMap((e) => e.vista.artigos.map(siteDe)));
  const dia = [...s].filter(soDia);
  if (!dia.length) return "data e hora";
  return dia.length === s.size ? "só o dia (sem hora)" : `só o dia em ${dia.join(", ")}`;
}

/** O que a newsletter tem de perfil, numa palavra. */
function estado(a: Avaliacao): string {
  const p = a.perfilAtual;
  if (!comPerfil(p)) return `insuficiente (${p.edicoes} de ${MIN_EDICOES_PERFIL})`;
  if (!p.idade) return "parcial (sem idade)";
  return "completo";
}

const L: string[] = [];
const out = (...xs: string[]) => L.push(...xs);

out(
  "# Perfis das newsletters — mapa de características",
  "",
  `> Gerado por \`npm run mapa-perfis\` a partir dos dados: ${todas.length} edições de ` +
    `${dataPt(datas[0])} a ${dataPt(fimBase)}, ${artigosDistintos.size} artigos distintos, ` +
    `${datados} com data de publicação (${percent(datados / artigosDistintos.size)}). ` +
    "Não editar à mão: correr outra vez sobre uma cópia da produção.",
  "",
  "## Em linguagem simples",
  "",
  "Cada edição que chega é comparada com **o histórico da própria newsletter** — as",
  `edições anteriores dos últimos ${DIAS_DE_HISTORICO} dias, como o monitor as viu. Cada newsletter tem o seu`,
  "normal (umas apontam para artigos de há uma hora, outras para artigos de ontem;",
  "umas reaproveitam metade dos artigos, outras nenhum), por isso os limites não são",
  "iguais para todas: são aprendidos com o que cada uma costuma fazer.",
  "",
  "### O que se verifica",
  "",
  "| Pergunta | Como se responde | Resultado |",
  "|---|---|---|",
  "| Chegou? | Um email da newsletter na caixa, na janela da edição | Sem email: **5 Não Saiu** só com prova; senão **∅** |",
  "| Chegou a horas? | Hora de chegada contra a hora prevista + 30 min | Depois disso: **2 Saiu Atrasada** |",
  "| Chegou duplicada? | Dois envios distintos do editor no mesmo dia | **3 Saiu Duplicada** |",
  "| É igual a uma edição antiga? | O mesmo conteúdo (texto normalizado) ou exatamente os mesmos artigos " +
    `(pelo menos ${ESPELHO.minArtigos}) que **qualquer** edição anterior, não só a de ontem | **4** (prova) |`,
  "| Os artigos são velhos? | A data de publicação do artigo **mais recente** da edição, contra o normal " +
    "desta newsletter | Muito mais velho do que o normal e nada publicado desde a edição anterior: **4** (prova). " +
    "Só mais velho: aviso |",
  "| A data no topo está certa? | Só nas newsletters que escrevem sempre a data do dia no topo | Data errada: **4** (prova) |",
  "| Reaproveita mais do que o costume? Tem artigos a mais ou a menos? | Contra o costume desta newsletter | Só aviso |",
  "",
  "### Prova ou só aviso",
  "",
  "- **Prova** muda o estado para **4 Saiu com Conteúdo Desatualizado**: edição igual a uma",
  "  antiga; artigo mais recente muito mais velho do que o normal **e** já publicado antes",
  "  de a edição anterior sair (uma edição legítima traz sempre alguma coisa nova; uma",
  "  reenviada não traz nada); data errada no topo numa newsletter que a escreve sempre.",
  "- **Aviso** (⚠ no detalhe da edição) não muda o estado, fica à vossa avaliação: artigo",
  "  mais recente mais velho do que em qualquer edição anterior; artigos já usados acima do",
  "  costume; número de artigos fora do costume.",
  "",
  "### Porque não depende do aspeto",
  "",
  "O modelo, as cores e os blocos das newsletters mudam sem aviso. Nada disto olha para",
  "eles: só para **os artigos para onde a edição aponta** (os endereços), **a data de",
  "publicação que a página de cada artigo declara** e o texto normalizado. Um modelo novo",
  "com os mesmos artigos de ontem continua a ser apanhado; um modelo novo com artigos de",
  "hoje continua a ser uma edição normal.",
  "",
  "### Limites conhecidos",
  "",
  "- **Edição que só repete a de ontem, quando a de ontem nunca chegou à caixa:** não há",
  "  com que a comparar. Se os artigos forem de ontem, ficam dentro do normal de quem aponta",
  "  para artigos de ontem — só dá aviso, ou nada.",
  `- **Menos de ${MIN_EDICOES_PERFIL} edições de histórico:** ainda não há perfil; a idade dos artigos só dá aviso ` +
    `(acima de ${AVISO_SEM_PERFIL_DIAS} dias). A comparação com edições antigas funciona desde a 2.ª edição.`,
  `- **Artigos sem data de publicação:** uma edição só se mede pela idade com pelo menos ${MIN_DATADOS} ` +
    `artigos datados e ${percent(COBERTURA_MINIMA)} dos artigos com data. Abaixo disso, só contam as outras verificações.`,
);
const sitesSoDia = [...precisao].filter(([s]) => soDia(s)).map(([s]) => s).sort();
if (sitesSoDia.length) {
  out(
    `- **Datas só com o dia:** ${sitesSoDia.join(", ")} declaram só o dia de publicação (00:00), sem hora.`,
    "  Aí a idade tem a precisão de um dia: uma newsletter que aponta para os artigos de",
    "  ontem aparece com mais de um dia. E a regra \"nada publicado desde a edição anterior\" não ajuda",
    "  nestas: o dia de ontem às 00:00 é sempre anterior à edição de ontem. A prova vem só",
    "  do limite de idade (e da comparação com edições antigas).",
  );
}
out(
  "- **Newsletters que deixam de chegar** (a lista cortou a caixa): o perfil fica parado na",
  "  última edição recebida e volta a servir quando a caixa for reinscrita.",
  "",
  "## Os indicadores e os limites",
  "",
  "| Indicador | Medido como | Prova (código 4) | Aviso |",
  "|---|---|---|---|",
  `| Igual a edição antiga | Texto normalizado igual, ou o mesmo conjunto de artigos (≥ ${ESPELHO.minArtigos}) | Sempre | — |`,
  "| Idade do artigo mais recente | Chegada da edição − publicação do artigo mais recente | " +
    `Acima de máx(${LIMITE_MIN_DIAS} dia, ${FATOR_IDADE} × p90 da newsletter) **e** publicado antes da edição anterior | ` +
    `Acima desse limite mas com algo novo; ou acima de máx(1 dia, ${String(ESPELHO.fatorMax).replace(".", ",")} × máximo da newsletter); ` +
    `sem perfil, acima de ${AVISO_SEM_PERFIL_DIAS} dias |`,
  `| Data no topo | A primeira data nos primeiros caracteres do texto | Errada, se a newsletter a escreve certa em ≥ ${percent(ESPELHO.habitoTopo)} de ≥ ${MIN_EDICOES_PERFIL} edições | — |`,
  "| Reaproveitamento | Fração dos artigos já usados em edições anteriores | — | " +
    `≥ ${percent(ESPELHO.reusoMinimo)} e acima do p90 da newsletter + ${Math.round(ESPELHO.reusoMargem * 100)} pontos |`,
  "| Número de artigos | Endereços de artigos distintos na edição | — | Menos de metade do mínimo, ou mais de 1,5 × o máximo |",
  "",
  `Os perfis (p50, p90, máximo) contam só as edições anteriores, e só com ${MIN_EDICOES_PERFIL} ou mais. ` +
    "O artigo mais recente usa-se porque é estável em cada newsletter; a idade **mediana** não serve " +
    "(há newsletters que apontam, ao lado das notícias do dia, para artigos de contexto com semanas).",
  "",
  `**Verificação sobre este histórico** (\`npm run calibrar-perfis\`): cada edição julgada só com as anteriores — ` +
    `${todas.length} edições, ${nMedidas} medidas pela idade contra um perfil, **${nProvas} provas** e ${nAvisos} aviso${nAvisos === 1 ? "" : "s"}.`,
  "",
  "## Resumo",
  "",
  "| Newsletter | Calendário | Edições | Prevista | Real (mediana) | Artigos | Mais recente (p50) | Com data | Reuso p90 | Data no topo | Perfil |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
);
const ordenadas = [...comEdicoes].sort((a, b) => nome(a.n).localeCompare(nome(b.n), "pt"));
for (const a of ordenadas) {
  const p = a.perfilAtual;
  const cob = coberturaDatas(a.edicoes);
  out(
    `| ${nome(a.n)} | ${calendario(a.n)} | ${a.edicoes.length} | ${a.n.horaPrevista} | ${envio(a).mediana} | ` +
      `${p.artigos ? p.artigos.mediana : "—"} | ${p.idade ? horas(p.idade.p50) : "—"} | ` +
      `${cob.total ? percent(cob.com / cob.total) : "—"} | ${p.reusoP90 !== null ? pct(p.reusoP90) : "—"} | ` +
      `${p.dataNoTopo ? "sim" : "não"} | ${estado(a)} |`,
  );
}

out("", "## Ficha de cada newsletter", "");
for (const a of ordenadas) {
  const { n, edicoes } = a;
  const p = a.perfilAtual;
  const lim = limiares(p);
  const cob = coberturaDatas(edicoes);
  const reusos = edicoes.map((e) => e.reuso).filter((x): x is number => x !== null);
  const fora = foraDoCalendario(a);
  const ultima = edicoes.at(-1)!.data;
  const env = envio(a);
  const duplos = edicoes.filter((e) => e.emails > 1).length;
  out(
    `### ${nome(n)}`,
    "",
    `\`${n.id}\`${n.ativa ? "" : " · **inativa**"} · perfil ${estado(a)}`,
    "",
    "| Característica | Observado |",
    "|---|---|",
    `| Edições recebidas | ${edicoes.length}, de ${dataPt(edicoes[0].data)} a ${dataPt(ultima)}` +
      `${ultima < fimBase && edicoes.length > 1 && daysBetween(ultima, fimBase) > 7 ? ` — **não chega desde ${diaMes(ultima)}**` : ""} |`,
    `| Calendário configurado | ${calendario(n)} |`,
    `| Dias em que chegou | ${diasVistos(edicoes)}${fora.length ? ` — **${fora.length} fora do calendário** (${fora.map(diaMes).join(", ")})` : ""} |`,
    `| Hora prevista | ${n.horaPrevista} |`,
    `| Hora real | mediana ${env.mediana}, p90 ${env.p90} |`,
    ...(duplos ? [`| Edições com mais de um email | ${duplos} |`] : []),
    `| Artigos por edição | ${artigosTxt(edicoes)} |`,
    `| Artigo mais recente, idade | ${idadeTxt(p)} |`,
    `| Artigos com data de publicação | ${cob.total ? `${percent(cob.com / cob.total)} (${cob.com} de ${cob.total}); precisão: ${precisaoTxt(edicoes)}` : "—"} |`,
    `| Artigos já usados antes | ${reusos.length ? `mediana ${pct(quantil(reusos, 0.5))}, p90 ${pct(quantil(reusos, 0.9))}, máx. ${pct(Math.max(...reusos))}` : "—"} |`,
    `| Escreve a data no topo | ${topoTxt(a)} |`,
    `| Aponta para | ${sites(edicoes)} |`,
    "",
    "Como se julga a próxima edição:",
    "",
    `- Igual a uma das ${p.edicoes} edições anteriores (texto, ou os mesmos artigos) → **prova**.`,
  );
  if (lim.prova !== null && lim.aviso !== null) {
    out(
      `- Artigo mais recente com mais de **${horas(lim.prova)}** e nada publicado desde a edição anterior → **prova**; ` +
        `com algo novo → aviso.`,
    );
    // Em perfil.ts este aviso só se testa abaixo do limite da prova.
    if (lim.aviso < lim.prova) out(`- Artigo mais recente com mais de ${horas(lim.aviso)} (e até ${horas(lim.prova)}) → aviso.`);
  } else {
    out(
      `- Idade dos artigos: ainda sem perfil (${p.idade === null && comPerfil(p) ? "poucas edições com artigos datados suficientes" : "histórico curto"}) — ` +
        `só aviso, acima de ${AVISO_SEM_PERFIL_DIAS} dias.`,
    );
  }
  if (p.dataNoTopo) out("- Data no topo diferente do dia da edição → **prova**.");
  if (lim.reuso !== null && p.reusoP90 !== null) {
    out(
      lim.reuso > 1
        ? `- Reaproveitamento: nunca dá aviso (o costume já chega a ${pct(p.reusoP90)}).`
        : p.reusoP90 + ESPELHO.reusoMargem < ESPELHO.reusoMinimo
          ? `- ${percent(ESPELHO.reusoMinimo)} ou mais dos artigos já usados antes → aviso.`
          : `- Mais de ${percent(lim.reuso)} dos artigos já usados antes → aviso.`,
    );
  }
  if (lim.artigos) {
    out(
      lim.artigos.abaixo > 0
        ? `- Menos de ${lim.artigos.abaixo} ou mais de ${lim.artigos.acima} artigos → aviso.`
        : `- Mais de ${lim.artigos.acima} artigos → aviso.`,
    );
  }
  const provas = edicoes.filter((e) => provaDe(e));
  const avisos = edicoes.filter((e) => e.sinais.avisos.length);
  out(
    "",
    provas.length || avisos.length
      ? `No histórico: ${[
          ...provas.map((e) => `${diaMes(e.data)} prova (${provaDe(e)})`),
          ...avisos.map((e) => `${diaMes(e.data)} ${e.sinais.avisos.map((x) => x.replace(/^⚠\s*/, "")).join(" ")}`),
        ].join("; ")}`
      : "No histórico: nenhuma edição daria prova nem aviso.",
    "",
  );
}

// ── Sem histórico ──────────────────────────────────────────────────────────
const nunca = tudo.filter((a) => a.edicoes.length === 0 && a.n.ativa);
const curtas = ordenadas.filter((a) => !comPerfil(a.perfilAtual));
const inativas = tudo.filter((a) => a.edicoes.length === 0 && !a.n.ativa).length;
out(
  "## Sem histórico ou com histórico insuficiente",
  "",
  `Nestas, a idade dos artigos só dá aviso (sem perfil) até haver ${MIN_EDICOES_PERFIL} edições; ` +
    "a comparação com edições antigas e as outras verificações funcionam desde a 2.ª edição.",
  "",
  `### Ativas que nunca chegaram à caixa (${nunca.length})`,
  "",
  ...(nunca.length
    ? ["| Newsletter | Calendário | Hora prevista |", "|---|---|---|", ...nunca
        .sort((a, b) => nome(a.n).localeCompare(nome(b.n), "pt"))
        .map((a) => `| ${nome(a.n)} (\`${a.n.id}\`) | ${calendario(a.n)} | ${a.n.horaPrevista} |`)]
    : ["Nenhuma."]),
  "",
  `### Com menos de ${MIN_EDICOES_PERFIL} edições (${curtas.length})`,
  "",
  ...(curtas.length
    ? curtas.map((a) => `- ${nome(a.n)} (\`${a.n.id}\`): ${a.edicoes.length} ${a.edicoes.length === 1 ? "edição" : "edições"}, ${a.edicoes.map((e) => diaMes(e.data)).join(", ")}`)
    : ["Nenhuma."]),
  "",
  `Há ainda ${inativas} newsletters inativas (desligadas no Excel) sem nenhuma edição na base.`,
  "",
);

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
function artigosTxt(eds: EdicaoAvaliada[]): string {
  const xs = eds.map((e) => e.vista.artigos.length).filter((x) => x > 0);
  if (!xs.length) return "—";
  return `mediana ${quantil(xs, 0.5)}, ${Math.min(...xs)} a ${Math.max(...xs)}`;
}

writeFileSync(saida, L.join("\n"));
console.log(`${saida}: ${comEdicoes.length} newsletters com edições, ${nunca.length} ativas sem nenhuma, ${todas.length} edições.`);
