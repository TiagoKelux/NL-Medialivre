import { db } from "./db.ts";
import { NEWSLETTERS, newsletterPorId } from "../../config/newsletters.ts";
import { classificar, type EdicaoAnterior, type Ocorrencia } from "./classificacao.ts";
import { dataLocal, paraInstante, paraIso, somarDias, somarMinutos, ultimosDias } from "./tempo.ts";
import type { CodigoEstado, Newsletter, Periodicidade, Registo } from "./tipos.ts";

/**
 * Tudo o que cria e atualiza linhas em `registos`.
 *
 * Nota sobre `fechado`: marca que a janela de tolerância já passou — serve para
 * a página distinguir as linhas ainda em aberto (§8). Não impede reclassificação:
 * um email que chega 30 minutos depois do limite tem de passar o registo de 5
 * para 2 com o atraso certo (critério 3), e isso acontece depois de a janela
 * fechar. Fechar tranca o relógio, não a verdade.
 */

/** hora_limite = horaPrevista + toleranciaMinutos, no dia em causa. */
export function horaLimiteDe(n: Newsletter, data: string): Date {
  return somarMinutos(paraInstante(data, n.horaPrevista), n.toleranciaMinutos);
}

/**
 * §7.1 — Job das 00h05: gerar as linhas do dia.
 *
 * O estado parte de "Não Saiu" e só melhora com prova de que chegou. É o inverso
 * do Excel, onde a ausência de preenchimento não distingue "não saiu" de
 * "ninguém verificou".
 */
export function gerarDia(data: string = dataLocal()): number {
  const bd = db();
  const inserir = bd.prepare(`
    INSERT OR IGNORE INTO registos
      (newsletter_id, data_prevista, hora_limite, codigo_estado, nr_ocorrencias, detalhe, fechado)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `);

  let criados = 0;
  const transacao = bd.transaction(() => {
    for (const n of NEWSLETTERS) {
      const horaLimite = horaLimiteDe(n, data);
      const r = classificar({
        newsletter: n,
        dataPrevista: data,
        horaLimite,
        ocorrencias: [],
        edicaoAnterior: null,
        fechado: false,
      });
      // Código 6 nasce fechado: não há nada à espera de acontecer.
      const fechado = r.codigo === 6 ? 1 : 0;
      const res = inserir.run(n.id, data, paraIso(horaLimite), r.codigo, r.detalhe, fechado);
      criados += res.changes;
    }
  });
  transacao();
  return criados;
}

/**
 * Gera os dias em falta num intervalo. Chamado no arranque para que uma paragem
 * do processo não deixe buracos na matriz (critério 1).
 */
export function garantirDias(nrDias: number = 30): number {
  let criados = 0;
  for (const data of ultimosDias(nrDias)) criados += gerarDia(data);
  return criados;
}

/** Os envios distintos de uma newsletter num dia local. */
function ocorrenciasDoDia(newsletterId: string, data: string): Ocorrencia[] {
  const inicio = paraIso(paraInstante(data, "00:00"));
  const fim = paraIso(paraInstante(somarDias(data, 1), "00:00"));
  const linhas = db()
    .prepare(
      `SELECT recebido_em, hash_conteudo FROM emails
        WHERE newsletter_id = ? AND recebido_em >= ? AND recebido_em < ?
        ORDER BY recebido_em ASC`,
    )
    .all(newsletterId, inicio, fim) as { recebido_em: string; hash_conteudo: string }[];

  return linhas.map((l) => ({ recebidoEm: new Date(l.recebido_em), hash: l.hash_conteudo }));
}

/** A edição anterior efetivamente recebida, para comparação de conteúdo (§7.4). */
function edicaoAnteriorDe(newsletterId: string, data: string): EdicaoAnterior | null {
  const inicio = paraIso(paraInstante(data, "00:00"));
  const linha = db()
    .prepare(
      `SELECT recebido_em, hash_conteudo FROM emails
        WHERE newsletter_id = ? AND recebido_em < ?
        ORDER BY recebido_em DESC LIMIT 1`,
    )
    .get(newsletterId, inicio) as { recebido_em: string; hash_conteudo: string } | undefined;

  if (!linha) return null;
  return { data: dataLocal(new Date(linha.recebido_em)), hash: linha.hash_conteudo };
}

/**
 * §7.2 — Reavaliar o registo de uma newsletter num dia, a partir dos emails
 * que estão gravados. Idempotente: correr duas vezes dá o mesmo resultado.
 */
export function reavaliar(newsletterId: string, data: string): Registo | null {
  const n = newsletterPorId(newsletterId);
  if (!n) return null;

  const bd = db();
  const lerRegisto = bd.prepare(
    `SELECT * FROM registos WHERE newsletter_id = ? AND data_prevista = ?`,
  );

  let existente = lerRegisto.get(newsletterId, data) as Registo | undefined;
  if (!existente) {
    gerarDia(data);
    existente = lerRegisto.get(newsletterId, data) as Registo | undefined;
    if (!existente) return null;
  }

  const r = classificar({
    newsletter: n,
    dataPrevista: data,
    horaLimite: new Date(existente.hora_limite),
    ocorrencias: ocorrenciasDoDia(newsletterId, data),
    edicaoAnterior: edicaoAnteriorDe(newsletterId, data),
    fechado: existente.fechado === 1,
  });

  bd.prepare(
    `UPDATE registos
        SET hora_recebida = ?, atraso_minutos = ?, codigo_estado = ?,
            nr_ocorrencias = ?, detalhe = ?
      WHERE id = ?`,
  ).run(
    r.horaRecebida ? paraIso(r.horaRecebida) : null,
    r.atrasoMinutos,
    r.codigo,
    r.nrOcorrencias,
    r.detalhe,
    existente.id,
  );

  return bd.prepare(`SELECT * FROM registos WHERE id = ?`).get(existente.id) as Registo;
}

/**
 * §7.3 — Job de 5 em 5 minutos: fechar os registos cuja hora_limite já passou.
 * Classificação definitiva e `fechado = true`.
 */
export function fecharVencidos(agora: Date = new Date()): number {
  const bd = db();
  const vencidos = bd
    .prepare(`SELECT * FROM registos WHERE fechado = 0 AND hora_limite <= ?`)
    .all(paraIso(agora)) as Registo[];

  for (const reg of vencidos) {
    bd.prepare(`UPDATE registos SET fechado = 1 WHERE id = ?`).run(reg.id);
    // Depois de fechar, para que o detalhe use a redação de dia fechado.
    reavaliar(reg.newsletter_id, reg.data_prevista);
  }
  return vencidos.length;
}

// ── Leituras para a página ─────────────────────────────────────────────────

/**
 * Que pares newsletter/dia tem um email guardado — ou seja, para quais e que
 * ha conteudo para mostrar. Uma so consulta para todo o intervalo.
 */
function diasComConteudo(de: string, ate: string): Set<string> {
  const inicio = paraIso(paraInstante(de, "00:00"));
  const fim = paraIso(paraInstante(somarDias(ate, 1), "00:00"));
  const linhas = db()
    .prepare(
      `SELECT newsletter_id, recebido_em FROM emails
        WHERE newsletter_id IS NOT NULL AND recebido_em >= ? AND recebido_em < ?`,
    )
    .all(inicio, fim) as { newsletter_id: string; recebido_em: string }[];

  const chaves = new Set<string>();
  for (const l of linhas) chaves.add(`${l.newsletter_id}|${dataLocal(new Date(l.recebido_em))}`);
  return chaves;
}

export interface LinhaGrelha extends Registo {
  marca: string;
  nome: string;
  hora_prevista: string;
  periodicidade: Periodicidade;
  dias_semana: number[] | null;
  tem_conteudo: boolean;
}

function enriquecer(reg: Registo, comConteudo: Set<string>): LinhaGrelha {
  const n = newsletterPorId(reg.newsletter_id);
  return {
    ...reg,
    marca: n?.marca ?? "?",
    nome: n?.nome ?? reg.newsletter_id,
    hora_prevista: n?.horaPrevista ?? "--:--",
    periodicidade: n?.periodicidade ?? "diaria",
    dias_semana: n?.diasSemana ?? null,
    tem_conteudo: comConteudo.has(`${reg.newsletter_id}|${reg.data_prevista}`),
  };
}

/** §8 topo — a grelha do dia, uma linha por newsletter. */
export function grelhaDoDia(data: string = dataLocal()): LinhaGrelha[] {
  const registos = db()
    .prepare(`SELECT * FROM registos WHERE data_prevista = ?`)
    .all(data) as Registo[];

  const comConteudo = diasComConteudo(data, data);
  const porId = new Map(registos.map((r) => [r.newsletter_id, r]));
  // A ordem é a do ficheiro de configuração, não a da base de dados.
  return NEWSLETTERS.map((n) => porId.get(n.id))
    .filter((r): r is Registo => r !== undefined)
    .map((r) => enriquecer(r, comConteudo));
}

export interface Celula {
  codigo: CodigoEstado;
  detalhe: string;
  fechado: boolean;
  temConteudo: boolean;
}

export interface Matriz {
  dias: string[];
  linhas: { newsletter: Newsletter; celulas: (Celula | null)[] }[];
}

/** §8 baixo — matriz dos últimos 30 dias, por pivot sobre `registos`. */
export function matriz(dias: string[]): Matriz {
  const registos = db()
    .prepare(`SELECT * FROM registos WHERE data_prevista >= ? AND data_prevista <= ?`)
    .all(dias[0], dias[dias.length - 1]) as Registo[];

  const indice = new Map<string, Registo>();
  for (const r of registos) indice.set(`${r.newsletter_id}|${r.data_prevista}`, r);

  const comConteudo = diasComConteudo(dias[0], dias[dias.length - 1]);

  return {
    dias,
    linhas: NEWSLETTERS.map((n) => ({
      newsletter: n,
      celulas: dias.map((d) => {
        const r = indice.get(`${n.id}|${d}`);
        if (!r) return null;
        return {
          codigo: r.codigo_estado,
          detalhe: r.detalhe,
          fechado: r.fechado === 1,
          temConteudo: comConteudo.has(`${n.id}|${d}`),
        };
      }),
    })),
  };
}

export interface EmailDoDia {
  assunto: string;
  remetente: string;
  recebido_em: string;
  corpo_html: string;
}

/** O email de uma newsletter num dia local. O primeiro, se houver mais do que um. */
export function emailDoDia(newsletterId: string, data: string): EmailDoDia | null {
  const inicio = paraIso(paraInstante(data, "00:00"));
  const fim = paraIso(paraInstante(somarDias(data, 1), "00:00"));
  const linha = db()
    .prepare(
      `SELECT assunto, remetente, recebido_em, corpo_html FROM emails
        WHERE newsletter_id = ? AND recebido_em >= ? AND recebido_em < ?
        ORDER BY recebido_em ASC LIMIT 1`,
    )
    .get(newsletterId, inicio, fim) as EmailDoDia | undefined;
  return linha ?? null;
}

/** O registo de uma newsletter num dia, para o cabeçalho do ficheiro. */
export function registoDe(newsletterId: string, data: string): Registo | null {
  const r = db()
    .prepare(`SELECT * FROM registos WHERE newsletter_id = ? AND data_prevista = ?`)
    .get(newsletterId, data) as Registo | undefined;
  return r ?? null;
}
