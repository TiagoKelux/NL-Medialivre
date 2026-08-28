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

export type Periodicidade = "diaria" | "dias_uteis" | "dia_semana";

export interface Newsletter {
  id: string;
  marca: string;
  nome: string;
  periodicidade: Periodicidade;
  /** Dias ISO da semana (1 = segunda … 7 = domingo). Só para `dia_semana`. */
  diasSemana: number[] | null;
  /** "HH:MM" na hora local de Europe/Lisbon. */
  horaPrevista: string;
  toleranciaMinutos: number;
  remetentes: string[];
  padraoAssunto: string;
  ativa: boolean;
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
}
