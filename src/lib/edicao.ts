import type { Newsletter } from "./tipos.ts";
import { dataLocal, paraInstante, somarDias } from "./tempo.ts";

/**
 * A que edição (dia) pertence um email.
 *
 * Contar pelo dia do calendário falha nas pontas: a Edição Noite das 21h que
 * chegue às 00h30 caía no dia seguinte — "Não Saiu" num dia e "Duplicada" no
 * outro, os dois falsos. A edição de um dia D é tudo o que chega entre 6 h
 * antes e 18 h depois da hora prevista em D: cada instante pertence a uma
 * edição só, e uma newsletter que saia uma vez por dia nunca tem duas
 * edições na mesma janela.
 *
 * Dentro da janela, o que conta é o prazo (`PRAZO_ATRASO_MIN`): até 6 h
 * depois da hora prevista é "Atrasada"; mais tarde é "Não Saiu (fora de
 * prazo)" — chegou, mas já não saiu no dia dela. As 6 h antes cobrem com
 * folga os adiantamentos reais (29/09 a 15/10: o maior foi 1 h 27 min, a Boa
 * Tarde do CM).
 */
export const ANTECEDENCIA_MIN = 6 * 60;

/** Até quantos minutos depois da hora prevista uma edição ainda é "Atrasada". */
export const PRAZO_ATRASO_MIN = 6 * 60;

function minutosDe(hora: string): number {
  const [hh, mm] = hora.split(":").map(Number);
  return hh * 60 + mm;
}

/** O dia da edição a que pertence um email desta newsletter recebido neste instante. */
export function dataEdicao(n: Newsletter, recebido: Date): string {
  // Desloca-se o instante para que a janela [prevista − 6 h, prevista + 18 h[
  // coincida com o dia local inteiro. Na noite da mudança da hora o erro é de
  // uma hora, numa janela de 24 — irrelevante.
  const desvio = ANTECEDENCIA_MIN - minutosDe(n.horaPrevista);
  return dataLocal(new Date(recebido.getTime() + desvio * 60_000));
}

/**
 * Intervalo de instantes onde procurar os emails de uma edição: folgado de um
 * dia para cada lado, e afinado depois com `dataEdicao`.
 */
export function intervaloDeBusca(de: string, ate: string = de): { inicio: Date; fim: Date } {
  return {
    inicio: paraInstante(somarDias(de, -1), "00:00"),
    fim: paraInstante(somarDias(ate, 2), "00:00"),
  };
}
