import { db } from "./db.ts";
import { ehDiaEsperado } from "./classificacao.ts";
import { dataLocal } from "./tempo.ts";
import type { Newsletter } from "./tipos.ts";

// ── Calendário de cada dia ─────────────────────────────────────────────────

/**
 * O calendário de uma newsletter tal como estava num dia: periodicidade,
 * dias, hora, tolerância e se estava ativa. Fica gravado no registo
 * (`registos.calendario`) e congela quando o dia passa: mudar o Excel hoje
 * muda hoje e os dias seguintes, nunca o que já se passou — acrescentar a
 * quarta-feira a uma semanal não pode transformar as quartas passadas em
 * "Não Saiu". As regras de identificação e de classificação (o código)
 * continuam a aplicar-se a todo o histórico; só o calendário fica fixo.
 */
type Calendario = Pick<
  Newsletter,
  "periodicidade" | "diasSemana" | "diasMes" | "horaPrevista" | "toleranciaMinutos" | "ativa"
>;

export function calendarioDe(n: Newsletter): Calendario {
  return {
    periodicidade: n.periodicidade,
    diasSemana: n.diasSemana,
    diasMes: n.diasMes,
    horaPrevista: n.horaPrevista,
    toleranciaMinutos: n.toleranciaMinutos,
    ativa: n.ativa,
  };
}

export function lerCalendario(json: string | null | undefined): Calendario | null {
  if (!json) return null;
  try {
    const c = JSON.parse(json) as Calendario;
    return typeof c.periodicidade === "string" && typeof c.horaPrevista === "string" ? c : null;
  } catch {
    return null;
  }
}

/**
 * A newsletter com o calendário que vale para este dia: o gravado, se o dia
 * já passou; o da configuração atual, se é hoje ou ainda não tem nenhum.
 */
export function newsletterNoDia(n: Newsletter, data: string, gravado: string | null | undefined): Newsletter {
  const c = data < dataLocal() ? lerCalendario(gravado) : null;
  return c ? { ...n, ...c } : n;
}

/**
 * A newsletter com o calendário gravado no registo desse dia, se existir.
 * Para quem olha para dias passados sem ter o registo à mão (a contagem de
 * edições seguidas da prova, a caixa cortada).
 */
export function newsletterDoRegisto(n: Newsletter, data: string): Newsletter {
  const r = db()
    .prepare(`SELECT calendario FROM registos WHERE newsletter_id = ? AND data_prevista = ?`)
    .get(n.id, data) as { calendario: string | null } | undefined;
  return newsletterNoDia(n, data, r?.calendario);
}

/** Era dia de envio, segundo o calendário que valia nesse dia? */
export function esperadoNoDia(n: Newsletter, data: string): boolean {
  return ehDiaEsperado(newsletterDoRegisto(n, data), data);
}

/**
 * Corrigir o passado de propósito: o Excel estava errado e o calendário
 * congelado também. Apaga o calendário gravado desses dias, que passam a usar
 * o atual (e a gravá-lo) na reavaliação seguinte. Nunca corre sozinho — só
 * pelo `npm run recalendarizar`, que deixa rasto em `alteracoes`.
 */
export function descongelar(newsletterId: string | null, de: string, ate: string): number {
  const res = newsletterId
    ? db()
        .prepare(`UPDATE registos SET calendario = NULL WHERE newsletter_id = ? AND data_prevista BETWEEN ? AND ?`)
        .run(newsletterId, de, ate)
    : db().prepare(`UPDATE registos SET calendario = NULL WHERE data_prevista BETWEEN ? AND ?`).run(de, ate);
  return res.changes;
}
