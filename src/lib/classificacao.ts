import type { CodigoEstado, Newsletter } from "./tipos.ts";
import type { SinaisConteudo } from "./perfil.ts";
import { dataLocal as dataDe, diaMes, diaSemanaISO, horaLocal, minutosEntre, paraInstante, somarMinutos } from "./tempo.ts";
import { feriado } from "./feriados.ts";
import { hashConteudo, semelhancaArtigos } from "./conteudo.ts";

/**
 * O motor de estados (§4 e §7 da spec).
 *
 * Precedência, do mais grave para o menos: 6 → 5 → 3 → 4 → 2 → 1.
 * O 6 avalia-se primeiro e faz curto-circuito.
 *
 * Esta função é pura: recebe os factos do dia e devolve o código. Não lê nem
 * escreve na base de dados, o que a torna testável isoladamente.
 */

/** Hash de um corpo vazio — não serve para comparar edições. */
const HASH_VAZIO = hashConteudo("");

/**
 * Semelhança de artigos (Jaccard) a partir da qual o detalhe avisa que a
 * edição é provavelmente repetida. Calibrado sobre os dados reais de 29/09 a
 * 15/10 (`scripts/calibrar-artigos.ts`): as edições requentadas conhecidas
 * deram 0,86 (maxima-geral 02/10) e 0,71 (flash-mundo 04/10); a edição
 * legítima mais parecida com a anterior deu 0,67 (negocios-tecnologia).
 * Entre este limiar e LIMIAR_DUPLICADA o código NÃO muda: é só um aviso.
 */
export const LIMIAR_ARTIGOS = 0.7;

/**
 * Semelhança (Jaccard) a partir da qual a edição é "Saiu Duplicada" (código
 * 3): a maioria dos artigos é a da edição anterior. É o critério do controlo
 * manual do cliente (Excel "Newsletters Horários", 29/09 a 08/11/2026): marcou
 * 3 nas três edições com 0,75 ou mais (maxima-geral 02/10 0,86, 29/10 e 06/11
 * 0,75) e 1 em todas as outras — a mais parecida foi negocios-ip 19/10, 0,73.
 * A margem é curta: rever com cada novo controlo importado
 * (`npm run calibrar-perfis`, página /controlo).
 */
export const LIMIAR_DUPLICADA = 0.75;

/**
 * Mínimo de artigos para que "os mesmos artigos" prove repetição (código 4).
 * Com um ou dois links, coincidir pode ser acaso — um destaque fixo.
 */
export const MIN_ARTIGOS = 3;

const NOMES_DIAS = [
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
];

export interface Ocorrencia {
  recebidoEm: Date;
  hash: string;
  /** Artigos para onde a edição aponta (`extrairArtigos`). */
  artigos?: string[];
  /**
   * O envio do editor, lido do token "ver no browser" do Echobox
   * (`marcas.ts`): o mesmo id = o mesmo envio, entregue mais de uma vez.
   */
  envio?: string | null;
  /** O endereço para onde o editor mandou este envio (do mesmo token). */
  destino?: string | null;
}

export interface EdicaoAnterior {
  data: string;
  hash: string;
  artigos?: string[];
}

export interface Contexto {
  newsletter: Newsletter;
  dataPrevista: string;
  horaLimite: Date;
  /** Envios distintos do dia, já deduplicados por internet_message_id. */
  ocorrencias: Ocorrencia[];
  /** A edição anterior efetivamente recebida desta newsletter. */
  edicaoAnterior: EdicaoAnterior | null;
  /** O dia já fechou? Só muda a redação do detalhe, não o código. */
  fechado: boolean;
  /**
   * Sinais do 1.º envio contra o histórico da newsletter (perfil.ts): igual a
   * uma edição antiga, artigos desatualizados, avisos. Opcional.
   */
  conteudo?: SinaisConteudo;
  /**
   * Pausa anunciada para este dia (pausas.ts): sem email é 6, como num
   * feriado; com email conta como qualquer outro dia. Opcional.
   */
  pausa?: { motivo: string } | null;
}

export interface Resultado {
  codigo: CodigoEstado;
  horaRecebida: Date | null;
  atrasoMinutos: number | null;
  nrOcorrencias: number;
  detalhe: string;
  /**
   * Chegou, mas não havia edição anterior comparável: um 1 nestas condições
   * não prova "conteúdo atualizado". Não muda o código.
   */
  semComparacao?: boolean;
  /**
   * Hash diferente, mas a maioria dos artigos (Jaccard ≥ LIMIAR_ARTIGOS, < 1)
   * é a da edição anterior. Só aviso no detalhe: não muda o código.
   */
  provavelmenteRepetida?: boolean;
}

/** Hoje é dia de envio para esta newsletter? */
export function ehDiaEsperado(n: Newsletter, data: string): boolean {
  const dow = diaSemanaISO(data);
  switch (n.periodicidade) {
    case "diaria":
      return true;
    case "dias_uteis":
      return dow >= 1 && dow <= 5 && feriado(data) === null;
    case "dia_semana":
      return (n.diasSemana ?? []).includes(dow);
    case "dia_mes":
      return (n.diasMes ?? []).includes(Number(data.slice(8, 10)));
    case "nao_agendada":
      // Sem dia previsivel nao ha janela: nunca se espera num dia concreto.
      return false;
  }
}

function descreverPeriodicidade(n: Newsletter): string {
  switch (n.periodicidade) {
    case "diaria":
      return "esperada todos os dias";
    case "dias_uteis":
      return "esperada de 2.ª a 6.ª, exceto feriados";
    case "dia_semana": {
      // "à quinta-feira", mas "ao sábado" e "ao domingo".
      const dias = (n.diasSemana ?? [])
        .map((d) => `${d >= 6 ? "ao" : "à"} ${NOMES_DIAS[d - 1].toLowerCase()}`)
        .join(" e ");
      return dias ? `esperada só ${dias}` : "sem dias configurados";
    }
    case "dia_mes": {
      const dias = (n.diasMes ?? []).join(" e ");
      return dias ? `esperada ao dia ${dias} de cada mês` : "sem dia do mês configurado";
    }
    case "nao_agendada":
      return "sai sem dia previsível, não há janela para comparar";
  }
}

export function classificar(ctx: Contexto): Resultado {
  const { newsletter: n, ocorrencias } = ctx;
  const nrOcorrencias = ocorrencias.length;

  // ── 6: avalia-se primeiro e faz curto-circuito ──────────────────────────
  if (!n.ativa) {
    return {
      codigo: 6,
      horaRecebida: null,
      atrasoMinutos: null,
      nrOcorrencias,
      detalhe: "Newsletter desativada na configuração.",
    };
  }

  // Uma pausa anunciada pelo cliente: sem email não se espera nada (nunca
  // "Não Saiu"); se chegou na mesma, saiu — conta como qualquer outro dia.
  if (ctx.pausa && nrOcorrencias === 0) {
    return {
      codigo: 6,
      horaRecebida: null,
      atrasoMinutos: null,
      nrOcorrencias,
      detalhe: `Pausa anunciada (${ctx.pausa.motivo}): não prevista neste dia.`,
    };
  }

  // Num feriado, uma "dias úteis" não é esperada; mas se chegou, saiu — conta
  // como qualquer outro dia (umas saem nos feriados e outras não).
  const nomeFeriado = n.periodicidade === "dias_uteis" ? feriado(ctx.dataPrevista) : null;
  if (nomeFeriado && nrOcorrencias === 0) {
    return {
      codigo: 6,
      horaRecebida: null,
      atrasoMinutos: null,
      nrOcorrencias,
      detalhe: `Feriado nacional (${nomeFeriado}): não prevista (${descreverPeriodicidade(n)}).`,
    };
  }

  if (!nomeFeriado && !ehDiaEsperado(n, ctx.dataPrevista)) {
    const dia = NOMES_DIAS[diaSemanaISO(ctx.dataPrevista) - 1];
    // O código não muda, mas um envio fora do calendário não pode passar em
    // silêncio: pode ser que o calendário configurado esteja errado.
    const fora =
      nrOcorrencias > 0
        ? ` Atenção: chegou um envio às ${ocorrencias
            .map((o) => horaLocal(o.recebidoEm))
            .join(", ")} — fora do calendário configurado.`
        : "";
    return {
      codigo: 6,
      horaRecebida: null,
      atrasoMinutos: null,
      nrOcorrencias,
      detalhe: `${dia} não é dia de envio (${descreverPeriodicidade(n)}).${fora}`,
    };
  }

  const limite = horaLocal(ctx.horaLimite);

  // ── 5: não chegou nada ──────────────────────────────────────────────────
  if (nrOcorrencias === 0) {
    return {
      codigo: 5,
      horaRecebida: null,
      atrasoMinutos: null,
      nrOcorrencias: 0,
      detalhe: ctx.fechado
        ? `Nada recebido até ao limite das ${limite} → Não Saiu.`
        : `Ainda nada recebido. Limite às ${limite}.`,
    };
  }

  const ordenadas = [...ocorrencias].sort(
    (a, b) => a.recebidoEm.getTime() - b.recebidoEm.getTime(),
  );
  const { envios, destinos } = agruparEnvios(ordenadas);
  const nrEnvios = envios.length;
  const primeira = envios[0];
  const horaRecebida = primeira.recebidoEm;
  const atrasoMinutos = Math.max(0, minutosEntre(ctx.horaLimite, horaRecebida));
  const notaCaixa =
    destinos.length > 1
      ? ` Atenção: a caixa recebe esta newsletter em ${destinos.length} endereços (${destinos.join(", ")}) — ` +
        `está inscrita mais de uma vez; só conta o que chegou a ${destinos[0]}.`
      : nrOcorrencias > nrEnvios
        ? ` O mesmo envio do editor chegou ${nrOcorrencias} vezes — conta como um.`
        : "";

  // Chegou depois do limite, por mais tarde que seja: saiu tarde (código 2).
  // Um email que chegou nunca é "Não Saiu".
  const fraseJanela =
    atrasoMinutos > 0
      ? `Recebida às ${horaLocal(horaRecebida)}${diaSeOutro(ctx.dataPrevista, horaRecebida)}, limite ${limite} → ` +
        `saiu tarde (${duracao(atrasoMinutos)} de atraso).`
      : `Recebida às ${horaLocal(horaRecebida)}, limite ${limite} → dentro da janela.`;

  // Um corpo vazio dá sempre o mesmo hash; comparar com ele produziria código 4
  // falso em todas as edições sem corpo legível.
  const anterior = ctx.edicaoAnterior;
  const comparavelHash =
    anterior !== null &&
    primeira.hash !== "" &&
    primeira.hash !== HASH_VAZIO &&
    anterior.hash !== HASH_VAZIO;
  const hashIgual = comparavelHash && anterior!.hash === primeira.hash;

  // Os artigos: o hash só apanha cópias exatas; a edição de ontem com mais um
  // bloco tem hash diferente. Exatamente os mesmos artigos (com um mínimo de
  // MIN_ARTIGOS) prova repetição; a maioria iguais só fica como aviso.
  // O assunto nunca conta como prova: repete-se em edições legítimas.
  const sem = anterior ? semelhancaArtigos(primeira.artigos ?? [], anterior.artigos ?? []) : null;
  const artigosIguais = sem !== null && sem.jaccard === 1 && sem.total >= MIN_ARTIGOS;
  const provavelmenteRepetida =
    !hashIgual && !artigosIguais && sem !== null && sem.jaccard >= LIMIAR_ARTIGOS;
  // A maioria dos artigos da anterior: Duplicada, como no controlo do cliente.
  const duplicadaArtigos =
    provavelmenteRepetida && sem!.total >= MIN_ARTIGOS && sem!.jaccard >= LIMIAR_DUPLICADA;

  // Contra todo o histórico (perfil.ts): uma edição antiga reenviada, ou
  // artigos muito mais velhos do que o normal desta newsletter.
  const sinais = ctx.conteudo;
  const igualAntiga = !hashIgual && !artigosIguais && sinais?.igualA ? sinais.igualA : null;
  const desatualizada = !hashIgual && !artigosIguais && !igualAntiga ? (sinais?.desatualizada ?? null) : null;

  const comparavel = comparavelHash || artigosIguais || igualAntiga !== null || !!sinais?.frescoProvado;
  const repetido = hashIgual || artigosIguais || igualAntiga !== null || desatualizada !== null;
  const diaAnterior = anterior ? diaMes(anterior.data) : "";

  const extra = [sinais?.idade, ...(sinais?.avisos ?? [])].filter(Boolean).join(" ");
  const fraseConteudo = (igualAntiga
    ? igualAntiga.como === "hash"
      ? `Conteúdo igual ao da edição de ${diaMes(igualAntiga.data)} → edição antiga reenviada.`
      : `Os mesmos artigos da edição de ${diaMes(igualAntiga.data)} → edição antiga reenviada.`
    : desatualizada
      ? desatualizada
      : !comparavelHash && !artigosIguais
        ? "Sem edição anterior comparável."
    : hashIgual
      ? `Hash igual ao da edição de ${diaAnterior} → conteúdo repetido.`
      : artigosIguais
        ? `Os mesmos ${sem!.total} artigos da edição de ${diaAnterior} → conteúdo repetido.`
        : duplicadaArtigos
          ? `Hash diferente da edição de ${diaAnterior}, mas ${sem!.iguais} de ${sem!.total} artigos ` +
            `iguais aos dessa edição → conteúdo duplicado.`
        : provavelmenteRepetida
          ? `Hash diferente da edição de ${diaAnterior}, mas ⚠ provavelmente repetida: ` +
            `${sem!.iguais} de ${sem!.total} artigos iguais à edição anterior.`
          : `Hash diferente da edição de ${diaAnterior} → conteúdo novo.`) + (extra ? ` ${extra}` : "");

  const base = {
    horaRecebida,
    atrasoMinutos,
    nrOcorrencias: nrEnvios,
    semComparacao: !comparavel,
    ...(provavelmenteRepetida ? { provavelmenteRepetida: true } : {}),
  };

  // ── 3: dois envios distintos na mesma janela ────────────────────────────
  // Distintos = ids de envio do editor diferentes (provado pelo token), ou,
  // sem token, Message-IDs diferentes.
  if (nrEnvios >= 2) {
    const horas = envios.map((o) => horaLocal(o.recebidoEm)).join(", ");
    const prova = envios.every((o) => o.envio)
      ? `${nrEnvios} envios distintos do editor (ids de envio diferentes)`
      : `${nrEnvios} envios distintos`;
    // O 3 tem precedência, mas um primeiro envio requentado não pode passar
    // em silêncio (maxima-geral 02/10: a edição de ontem e, 30 min depois, a
    // correção do próprio editor).
    const conteudoPrimeiro =
      repetido || provavelmenteRepetida ? ` 1.º envio: ${fraseConteudo}` : "";
    return {
      ...base,
      codigo: 3,
      detalhe: `${prova} no mesmo dia (${horas}) → Duplicada. ${fraseJanela}${conteudoPrimeiro}${notaCaixa}`,
    };
  }

  // ── 4: conteúdo igual ao da edição anterior ─────────────────────────────
  if (repetido) {
    return { ...base, codigo: 4, detalhe: `${fraseJanela} ${fraseConteudo}${notaCaixa}` };
  }

  // ── 3: a maioria dos artigos é a da edição anterior ─────────────────────
  if (duplicadaArtigos) {
    return { ...base, codigo: 3, detalhe: `${fraseJanela} ${fraseConteudo}${notaCaixa}` };
  }

  // ── 2: fora da janela ───────────────────────────────────────────────────
  if (atrasoMinutos > 0) {
    return { ...base, codigo: 2, detalhe: `${fraseJanela} ${fraseConteudo}${notaCaixa}` };
  }

  // ── 1: dentro da janela, conteúdo novo, um só envio ─────────────────────
  return { ...base, codigo: 1, detalhe: `${fraseJanela} ${fraseConteudo}${notaCaixa}` };
}

/**
 * Os envios distintos que um mesmo leitor recebeu. Junta o que é o mesmo
 * envio do editor (mesmo id de envio no token — uma reentrega) e conta num
 * endereço só, o do primeiro email com token: a caixa inscrita com dois
 * endereços (o Gmail ignora os pontos — nl.medialivre e nlmedialivre são a
 * mesma caixa) recebe dois emails, mas cada leitor recebeu um. Sem token,
 * cada Message-ID é um envio.
 */
function agruparEnvios(ordenadas: Ocorrencia[]): { envios: Ocorrencia[]; destinos: string[] } {
  const principal = ordenadas.find((o) => o.destino)?.destino?.toLowerCase() ?? null;
  const outros = new Set<string>();
  const vistos = new Set<string>();
  const envios: Ocorrencia[] = [];
  for (const o of ordenadas) {
    const destino = o.destino?.toLowerCase() ?? null;
    if (destino && principal && destino !== principal) {
      outros.add(destino);
      continue;
    }
    if (o.envio) {
      if (vistos.has(o.envio)) continue;
      vistos.add(o.envio);
    }
    envios.push(o);
  }
  return { envios, destinos: outros.size > 0 ? [principal!, ...outros] : [] };
}

/** "45 min", "3 h 10 min", "2 d 4 h". */
export function duracao(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  if (h < 24) return minutos % 60 ? `${h} h ${minutos % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** " de 11/10" quando o instante já é de outro dia local; senão "". */
function diaSeOutro(data: string, instante: Date): string {
  const dia = dataDe(instante);
  return dia === data ? "" : ` de ${diaMes(dia)}`;
}
