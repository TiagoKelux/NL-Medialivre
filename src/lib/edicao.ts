import type { Newsletter } from "./tipos.ts";
import { dataLocal, paraInstante, somarDias } from "./tempo.ts";

/**
 * A que edição (dia) pertence um email.
 *
 * Contar pelo dia do calendário falha nas pontas: a Edição Noite das 21h que
 * chegue às 00h30 caía no dia seguinte — "Não Saiu" num dia e "Duplicada" no
 * outro, os dois falsos. A edição de um dia D passa a ser tudo o que chega
 * entre 12 h antes e 12 h depois da hora prevista em D. Uma newsletter que
 * saia uma vez por dia nunca tem duas edições na mesma janela.
 */
const MEIA_JANELA_MIN = 12 * 60;

function minutosDe(hora: string): number {
  const [hh, mm] = hora.split(":").map(Number);
  return hh * 60 + mm;
}

/** O dia da edição a que pertence um email desta newsletter recebido neste instante. */
export function dataEdicao(n: Newsletter, recebido: Date): string {
  // Desloca-se o instante para que a janela [prevista − 12 h, prevista + 12 h[
  // coincida com o dia local inteiro. Na noite da mudança da hora o erro é de
  // uma hora, numa janela de 24 — irrelevante.
  const desvio = MEIA_JANELA_MIN - minutosDe(n.horaPrevista);
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
