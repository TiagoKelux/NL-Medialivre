/**
 * Tudo o que envolve datas passa por aqui.
 *
 * O sistema raciocina em dias e horas locais de Lisboa ("a newsletter das 06h00
 * de dia 28"), mas grava instantes em UTC. Estas funções são a fronteira entre
 * os dois. Converter na mão com `new Date(...)` parte na mudança da hora.
 */

export const FUSO = process.env.TZ || "Europe/Lisbon";

const FORMATADOR = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface Partes {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

function partesLocais(instante: Date): Partes {
  const p = FORMATADOR.formatToParts(instante);
  const ler = (tipo: string) => Number(p.find((x) => x.type === tipo)!.value);
  const hora = ler("hour");
  return {
    ano: ler("year"),
    mes: ler("month"),
    dia: ler("day"),
    // Alguns motores devolvem 24 para a meia-noite com hour12:false.
    hora: hora === 24 ? 0 : hora,
    minuto: ler("minute"),
    segundo: ler("second"),
  };
}

/** Quantos ms é que a hora local está à frente do UTC neste instante. */
function desvioMs(instante: Date): number {
  const p = partesLocais(instante);
  const comoSeFosseUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  const semMilissegundos = Math.floor(instante.getTime() / 1000) * 1000;
  return comoSeFosseUtc - semMilissegundos;
}

/**
 * "2026-08-28" + "15:00" em Lisboa → o instante UTC correspondente.
 *
 * Duas passagens: a primeira estima o desvio, a segunda corrige-o para os dois
 * dias por ano em que o desvio muda a meio.
 */
export function paraInstante(data: string, hora: string): Date {
  const [ano, mes, dia] = data.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  const alvoLocal = Date.UTC(ano, mes - 1, dia, hh, mm, 0);

  let instante = alvoLocal - desvioMs(new Date(alvoLocal));
  instante = alvoLocal - desvioMs(new Date(instante));
  return new Date(instante);
}

/** O dia local ("2026-08-28") a que um instante pertence. */
export function dataLocal(instante: Date = new Date()): string {
  const p = partesLocais(instante);
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

/** "15:41" — a hora local de um instante. */
export function horaLocal(instante: Date): string {
  const p = partesLocais(instante);
  return `${String(p.hora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
}

/** Dia da semana ISO de um dia local: 1 = segunda … 7 = domingo. */
export function diaSemanaISO(data: string): number {
  const [ano, mes, dia] = data.split("-").map(Number);
  const jsDow = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay(); // 0 = domingo
  return jsDow === 0 ? 7 : jsDow;
}

/** Soma (ou subtrai) dias de calendário a um dia local. */
export function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Os últimos `n` dias locais, do mais antigo para o mais recente. */
export function ultimosDias(n: number, ate: string = dataLocal()): string[] {
  return Array.from({ length: n }, (_, i) => somarDias(ate, i - (n - 1)));
}

export function somarMinutos(instante: Date, minutos: number): Date {
  return new Date(instante.getTime() + minutos * 60_000);
}

/** Minutos inteiros entre dois instantes (b − a). */
export function minutosEntre(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

/** Formato de gravação: ISO 8601 em UTC. */
export function paraIso(instante: Date): string {
  return instante.toISOString();
}

/** "28/08" — para os cabeçalhos da matriz. */
export function diaMes(data: string): string {
  const [, mes, dia] = data.split("-");
  return `${dia}/${mes}`;
}

/** A segunda-feira da semana a que um dia local pertence. */
export function segundaDaSemana(data: string): string {
  return somarDias(data, -(diaSemanaISO(data) - 1));
}

/** Todos os dias de `de` até `ate`, inclusive. */
export function intervaloDias(de: string, ate: string): string[] {
  const dias: string[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

/**
 * Os dias das últimas `nrSemanas` semanas, a começar sempre a uma segunda e a
 * acabar em `ate`. É o que garante que a matriz se lê semana a semana, com as
 * colunas sempre alinhadas ao mesmo dia da semana.
 */
export function ultimasSemanas(nrSemanas: number, ate: string = dataLocal()): string[] {
  const primeiraSegunda = somarDias(segundaDaSemana(ate), -7 * (nrSemanas - 1));
  return intervaloDias(primeiraSegunda, ate);
}

const NOMES_MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** "2026-08-28" → "2026-08-01". */
export function primeiroDiaDoMes(data: string): string {
  return `${data.slice(0, 7)}-01`;
}

/** Soma meses de calendário, devolvendo sempre o dia 1. */
export function somarMeses(data: string, meses: number): string {
  const [ano, mes] = data.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1 + meses, 1)).toISOString().slice(0, 10);
}

/** "2026-08-28" → "Agosto". */
export function nomeMes(data: string): string {
  return NOMES_MESES[Number(data.slice(5, 7)) - 1];
}

/** O domingo que fecha a semana de um dia local. */
export function domingoDaSemana(data: string): string {
  return somarDias(segundaDaSemana(data), 6);
}

/** "2026-08-15" → "2026-08-31". */
export function ultimoDiaDoMes(data: string): string {
  const [ano, mes] = data.split("-").map(Number);
  return new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
}

/** "2026-08-28" → "28/08/2026". */
export function dataPorExtenso(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}
