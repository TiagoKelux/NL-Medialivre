import { db } from "./db.ts";
import { NEWSLETTERS, newsletterPorId } from "../../config/newsletters.ts";
import { classificar, type EdicaoAnterior, type Ocorrencia } from "./classificacao.ts";
import { datasNoEmail, fraseData } from "./datas.ts";
import { dataEdicao, intervaloDeBusca } from "./edicao.ts";
import { naoEEdicao } from "./correspondencia.ts";
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
  // Antes do início da monitorização não houve caixa a ler: marcar esses dias
  // como "Não Saiu" seria inventar falhas.
  const inicio = process.env.MONITOR_INICIO;
  if (inicio && data < inicio) return 0;

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

interface EmailGuardado {
  recebido_em: string;
  hash_conteudo: string;
  assunto: string;
  corpo_html: string;
}

/**
 * Os emails de uma newsletter que pertencem à edição de um dia, por ordem de
 * chegada. A pertença é a janela da edição (`dataEdicao`), não o dia do
 * calendário.
 */
function emailsDaEdicao(n: Newsletter, data: string): EmailGuardado[] {
  const { inicio, fim } = intervaloDeBusca(data);
  const linhas = db()
    .prepare(
      `SELECT recebido_em, hash_conteudo, assunto, corpo_html FROM emails
        WHERE newsletter_id = ? AND recebido_em >= ? AND recebido_em < ?
        ORDER BY recebido_em ASC`,
    )
    .all(n.id, paraIso(inicio), paraIso(fim)) as EmailGuardado[];
  return linhas.filter((l) => dataEdicao(n, new Date(l.recebido_em)) === data);
}

/** A edição anterior efetivamente recebida, para comparação de conteúdo (§7.4). */
function edicaoAnteriorDe(n: Newsletter, data: string): EdicaoAnterior | null {
  // Procura-se para trás a partir do início da janela de busca; o filtro por
  // `dataEdicao` garante que não se apanha um envio da própria edição.
  const { fim } = intervaloDeBusca(data);
  const linhas = db()
    .prepare(
      `SELECT recebido_em, hash_conteudo FROM emails
        WHERE newsletter_id = ? AND recebido_em < ?
        ORDER BY recebido_em DESC LIMIT 20`,
    )
    .all(n.id, paraIso(fim)) as { recebido_em: string; hash_conteudo: string }[];

  for (const l of linhas) {
    const dia = dataEdicao(n, new Date(l.recebido_em));
    if (dia < data) return { data: dia, hash: l.hash_conteudo };
  }
  return null;
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

  // A hora limite vem sempre da configuração atual: se a hora prevista mudar,
  // um limite gravado à data da geração ficaria desatualizado.
  const horaLimite = horaLimiteDe(n, data);
  const emails = emailsDaEdicao(n, data);
  const r = classificar({
    newsletter: n,
    dataPrevista: data,
    horaLimite,
    ocorrencias: emails.map((e) => ({ recebidoEm: new Date(e.recebido_em), hash: e.hash_conteudo })),
    edicaoAnterior: edicaoAnteriorDe(n, data),
    fechado: existente.fechado === 1,
  });

  // Sinal auxiliar, não mexe no código: a data que o próprio email escreve.
  const primeiro = r.nrOcorrencias > 0 ? emails[0] : undefined;
  const detalhe = primeiro
    ? `${r.detalhe} ${fraseData(datasNoEmail(primeiro.assunto, primeiro.corpo_html, data), data, r.codigo === 4)}`
    : r.detalhe;

  bd.prepare(
    `UPDATE registos
        SET hora_limite = ?, hora_recebida = ?, atraso_minutos = ?, codigo_estado = ?,
            nr_ocorrencias = ?, detalhe = ?
      WHERE id = ?`,
  ).run(
    paraIso(horaLimite),
    r.horaRecebida ? paraIso(r.horaRecebida) : null,
    r.atrasoMinutos,
    r.codigo,
    r.nrOcorrencias,
    detalhe,
    existente.id,
  );

  return bd.prepare(`SELECT * FROM registos WHERE id = ?`).get(existente.id) as Registo;
}

/**
 * Depois da hora limite, quanto tempo esperar por uma leitura antes de dar um
 * registo como fechado. Cobre o atraso entre o Gmail receber um email e ele
 * aparecer na pesquisa IMAP.
 */
export const MARGEM_FECHO_MIN = 10;

/**
 * §7.3 — fechar os registos cuja hora limite já passou. Classificação
 * definitiva e `fechado = true`.
 *
 * Só fecha com prova: tem de ter havido uma leitura bem-sucedida da caixa
 * depois do limite (mais a margem), e essa leitura tem de ter coberto o dia
 * da edição. Sem isso o registo fica em aberto — o painel mostra-o como "Por
 * confirmar" — em vez de virar um "Não Saiu" que pode ser só a caixa por ler.
 */
export function fecharVencidos(leitura: { ok: Date; desde: Date }): number {
  const bd = db();
  const ate = somarMinutos(leitura.ok, -MARGEM_FECHO_MIN);
  const vencidos = (
    bd
      .prepare(`SELECT * FROM registos WHERE fechado = 0 AND hora_limite <= ?`)
      .all(paraIso(ate)) as Registo[]
  ).filter((reg) => intervaloDeBusca(reg.data_prevista).inicio >= leitura.desde);

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
  const janela = intervaloDeBusca(de, ate);
  const inicio = paraIso(janela.inicio);
  const fim = paraIso(janela.fim);
  const linhas = db()
    .prepare(
      `SELECT newsletter_id, recebido_em FROM emails
        WHERE newsletter_id IS NOT NULL AND recebido_em >= ? AND recebido_em < ?`,
    )
    .all(inicio, fim) as { newsletter_id: string; recebido_em: string }[];

  const chaves = new Set<string>();
  for (const l of linhas) {
    const n = newsletterPorId(l.newsletter_id);
    if (n) chaves.add(`${l.newsletter_id}|${dataEdicao(n, new Date(l.recebido_em))}`);
  }
  return chaves;
}

export interface LinhaGrelha extends Registo {
  marca: string;
  nome: string;
  hora_prevista: string;
  periodicidade: Periodicidade;
  dias_semana: number[] | null;
  tem_conteudo: boolean;
  /** Em aberto com a hora limite já passada: à espera de uma leitura que o confirme. */
  limite_passou: boolean;
}

/** Registo por fechar cuja hora limite já passou — ainda sem prova num sentido ou noutro. */
function limitePassou(reg: Registo, agora: Date): boolean {
  return reg.fechado === 0 && new Date(reg.hora_limite) <= agora;
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
    limite_passou: limitePassou(reg, new Date()),
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
  limitePassou: boolean;
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
  const agora = new Date();

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
          limitePassou: limitePassou(r, agora),
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
  const n = newsletterPorId(newsletterId);
  if (!n) return null;
  const { inicio, fim } = intervaloDeBusca(data);
  const linhas = db()
    .prepare(
      `SELECT assunto, remetente, recebido_em, corpo_html FROM emails
        WHERE newsletter_id = ? AND recebido_em >= ? AND recebido_em < ?
        ORDER BY recebido_em ASC`,
    )
    .all(newsletterId, paraIso(inicio), paraIso(fim)) as EmailDoDia[];
  return linhas.find((l) => dataEdicao(n, new Date(l.recebido_em)) === data) ?? null;
}

/** O registo de uma newsletter num dia, para o cabeçalho do ficheiro. */
export function registoDe(newsletterId: string, data: string): Registo | null {
  const r = db()
    .prepare(`SELECT * FROM registos WHERE newsletter_id = ? AND data_prevista = ?`)
    .get(newsletterId, data) as Registo | undefined;
  return r ?? null;
}

export interface EmailPorClassificar {
  remetente: string;
  assunto: string;
  recebido_em: string;
}

/**
 * Emails dos últimos dias que não ficaram atribuídos a nenhuma newsletter e
 * não são boas-vindas nem promoções conhecidas. É a rede de segurança da
 * identificação: um remetente que mudou de nome, uma newsletter por
 * configurar ou uma regra ambígua aparecem aqui em vez de passarem em silêncio.
 */
export function porClassificar(dias = 7): EmailPorClassificar[] {
  const desde = new Date(Date.now() - dias * 86_400_000);
  const linhas = db()
    .prepare(
      `SELECT remetente, assunto, recebido_em FROM emails
        WHERE newsletter_id IS NULL AND recebido_em >= ?
        ORDER BY recebido_em DESC`,
    )
    .all(paraIso(desde)) as EmailPorClassificar[];
  return linhas.filter((l) => !naoEEdicao(l.assunto));
}

/**
 * Recalcula todos os registos dos últimos dias com a configuração e as regras
 * atuais. Corre no arranque: depois de mudar uma hora prevista, um padrão de
 * remetente ou a própria lógica, o histórico fica coerente em vez de misturar
 * classificações feitas com regras diferentes. É idempotente.
 */
export function reavaliarRecentes(nrDias: number): number {
  const desde = ultimosDias(nrDias)[0];
  const linhas = db()
    .prepare(`SELECT newsletter_id, data_prevista FROM registos WHERE data_prevista >= ?`)
    .all(desde) as { newsletter_id: string; data_prevista: string }[];
  let n = 0;
  for (const l of linhas) if (reavaliar(l.newsletter_id, l.data_prevista)) n++;
  return n;
}
