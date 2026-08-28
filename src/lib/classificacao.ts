import type { CodigoEstado, Newsletter } from "./tipos.ts";
import { diaMes, diaSemanaISO, horaLocal, minutosEntre } from "./tempo.ts";
import { hashConteudo } from "./conteudo.ts";

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
}

export interface EdicaoAnterior {
  data: string;
  hash: string;
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
}

export interface Resultado {
  codigo: CodigoEstado;
  horaRecebida: Date | null;
  atrasoMinutos: number | null;
  nrOcorrencias: number;
  detalhe: string;
}

/** Hoje é dia de envio para esta newsletter? */
export function ehDiaEsperado(n: Newsletter, data: string): boolean {
  const dow = diaSemanaISO(data);
  switch (n.periodicidade) {
    case "diaria":
      return true;
    case "dias_uteis":
      return dow >= 1 && dow <= 5;
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
      return "esperada de 2.ª a 6.ª";
    case "dia_semana": {
      const dias = (n.diasSemana ?? []).map((d) => NOMES_DIAS[d - 1]).join(" e ");
      return dias ? `esperada só à ${dias.toLowerCase()}` : "sem dias configurados";
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

  if (!ehDiaEsperado(n, ctx.dataPrevista)) {
    const dia = NOMES_DIAS[diaSemanaISO(ctx.dataPrevista) - 1];
    return {
      codigo: 6,
      horaRecebida: null,
      atrasoMinutos: null,
      nrOcorrencias,
      detalhe: `${dia} não é dia de envio (${descreverPeriodicidade(n)}).`,
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
  const primeira = ordenadas[0];
  const horaRecebida = primeira.recebidoEm;
  const atrasoMinutos = Math.max(0, minutosEntre(ctx.horaLimite, horaRecebida));

  const fraseJanela =
    atrasoMinutos > 0
      ? `Recebida às ${horaLocal(horaRecebida)}, limite ${limite} → ${atrasoMinutos} min de atraso.`
      : `Recebida às ${horaLocal(horaRecebida)}, limite ${limite} → dentro da janela.`;

  // Um corpo vazio dá sempre o mesmo hash; comparar com ele produziria código 4
  // falso em todas as edições sem corpo legível.
  const comparavel =
    ctx.edicaoAnterior !== null &&
    primeira.hash !== "" &&
    primeira.hash !== HASH_VAZIO &&
    ctx.edicaoAnterior.hash !== HASH_VAZIO;

  const repetido = comparavel && ctx.edicaoAnterior!.hash === primeira.hash;

  const fraseConteudo = !comparavel
    ? "Sem edição anterior comparável."
    : repetido
      ? `Hash igual ao da edição de ${diaMes(ctx.edicaoAnterior!.data)} → conteúdo repetido.`
      : `Hash diferente da edição de ${diaMes(ctx.edicaoAnterior!.data)} → conteúdo novo.`;

  const base = { horaRecebida, atrasoMinutos, nrOcorrencias };

  // ── 3: dois envios distintos na mesma janela ────────────────────────────
  if (nrOcorrencias >= 2) {
    const horas = ordenadas.map((o) => horaLocal(o.recebidoEm)).join(", ");
    return {
      ...base,
      codigo: 3,
      detalhe: `${nrOcorrencias} envios distintos no mesmo dia (${horas}) → Duplicada. ${fraseJanela}`,
    };
  }

  // ── 4: conteúdo igual ao da edição anterior ─────────────────────────────
  if (repetido) {
    return { ...base, codigo: 4, detalhe: `${fraseJanela} ${fraseConteudo}` };
  }

  // ── 2: fora da janela ───────────────────────────────────────────────────
  if (atrasoMinutos > 0) {
    return { ...base, codigo: 2, detalhe: `${fraseJanela} ${fraseConteudo}` };
  }

  // ── 1: dentro da janela, conteúdo novo, um só envio ─────────────────────
  return { ...base, codigo: 1, detalhe: `${fraseJanela} ${fraseConteudo}` };
}
