/** Códigos de estado. Enum fechado: só entram valores de 1 a 6 (§4 da spec). */
export const CODIGOS = [1, 2, 3, 4, 5, 6] as const;
export type CodigoEstado = (typeof CODIGOS)[number];

export function ehCodigoValido(valor: unknown): valor is CodigoEstado {
  return typeof valor === "number" && CODIGOS.includes(valor as CodigoEstado);
}

export const DESIGNACOES: Record<CodigoEstado, string> = {
  1: "Saiu e Tem Conteúdo Atualizado",
  2: "Saiu Atrasada",
  3: "Saiu Duplicada",
  4: "Saiu com Conteúdo Desatualizado",
  5: "Não Saiu",
  6: "Desativada / Não agendada",
};

/** Cores da §8. Sempre acompanhadas do número, nunca só a cor. */
export const CORES: Record<CodigoEstado, string> = {
  1: "verde",
  2: "amarelo",
  3: "laranja",
  4: "laranja",
  5: "vermelho",
  6: "cinzento",
};

/**
 * As cadencias que o Excel usa.
 *
 * `dia_mes` cobre "ao dia 1 de cada mes". `nao_agendada` cobre as "Mensal"
 * sem dia nem hora definidos e a "Sem periodicidade" — saem sem dia
 * previsivel, portanto nao ha janela nenhuma contra a qual as comparar.
 */
export type Periodicidade =
  | "diaria"
  | "dias_uteis"
  | "dia_semana"
  | "dia_mes"
  | "nao_agendada";

export interface Newsletter {
  id: string;
  marca: string;
  nome: string;
  periodicidade: Periodicidade;
  /** Dias ISO da semana (1 = segunda … 7 = domingo). Só para `dia_semana`. */
  diasSemana: number[] | null;
  /** Dias do mês (1 a 31). Só para `dia_mes`. */
  diasMes: number[] | null;
  /** "HH:MM" na hora local de Europe/Lisbon. */
  horaPrevista: string;
  toleranciaMinutos: number;
  /** Enderecos aceites. Uma entrada que comece por @ vale para o dominio. */
  remetentes: string[];
  /**
   * NOME do remetente, por inteiro ("FLASH! Bom dia"); compara-se sem
   * distincao de maiusculas, nunca por pedaco. Necessario quando varias
   * newsletters partilham o mesmo endereco e o assunto e a manchete do dia,
   * portanto muda sempre. Opcional.
   */
  padraoRemetente: string;
  /** Pedaco fixo do assunto. Opcional. */
  padraoAssunto: string;
  /**
   * Texto que so as edicoes desta newsletter trazem no HTML: o bloco de
   * publicidade "/4196/<MARCA>_MASTHEAD/NEWSLETTER_<NOME>_LEADERBOARD", ou o
   * logotipo proprio quando nao ha bloco. Quando preenchido e obrigatorio: e o
   * que separa a edicao do marketing que sai do mesmo remetente.
   */
  marcaCorpo: string;
  ativa: boolean;
  /**
   * Outras formas de reconhecer a newsletter, guardadas no painel ("Por
   * classificar"), nunca no ficheiro: cada uma é um endereço exato e uma marca
   * no corpo, e basta uma bater. Preenchido em memória por `regras-fusao.ts`.
   */
  alternativas?: RegraAlternativa[];
}

/** Um endereço e a marca no corpo que, juntos, identificam uma newsletter. */
export interface RegraAlternativa {
  remetente: string;
  marcaCorpo: string;
}

export interface Email {
  id: number;
  internet_message_id: string;
  remetente: string;
  assunto: string;
  recebido_em: string;
  corpo_html: string;
  corpo_normalizado: string;
  hash_conteudo: string;
  newsletter_id: string | null;
}

export interface Registo {
  id: number;
  newsletter_id: string;
  data_prevista: string;
  hora_limite: string;
  hora_recebida: string | null;
  atraso_minutos: number | null;
  codigo_estado: CodigoEstado;
  nr_ocorrencias: number;
  detalhe: string;
  fechado: 0 | 1;
  /**
   * Ressalva ao código, sem o mudar (o CHECK só aceita 1 a 6):
   * - "sem-prova": 5 com a hora limite passada mas sem prova de ausência
   *   (`motivosSemProva`) — mostra-se "Não recebida – sem prova";
   * - "sem-comparacao": 1 sem edição anterior comparável — chegou, mas o
   *   "conteúdo atualizado" não está provado.
   */
  ressalva: Ressalva | null;
}

export type Ressalva = "sem-prova" | "sem-comparacao";
