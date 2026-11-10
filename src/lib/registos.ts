import { db } from "./db.ts";
import { NEWSLETTERS, newsletterPorId } from "../../config/newsletters.ts";
import { classificar, type EdicaoAnterior, type Ocorrencia } from "./classificacao.ts";
import { datasNoEmail, fraseData } from "./datas.ts";
import { dataEdicao, diasSeguintesSemEdicao, intervaloDeBusca } from "./edicao.ts";
import { marcasDoEmail } from "./marcas.ts";
import { calendarioDe, newsletterNoDia } from "./calendario.ts";
import { naoEEdicao } from "./correspondencia.ts";
import { motivosSemProva } from "./prova.ts";
import { estadoLeitura } from "./leitura.ts";
import { extrairArtigos, processarCorpo } from "./conteudo.ts";
import { edicaoDoEmail, historico, sinaisConteudo } from "./perfil.ts";
import { dataLocal, diaMes, horaLocal, paraInstante, paraIso, somarDias, somarMinutos, ultimosDias } from "./tempo.ts";
import { DESIGNACOES, type CodigoEstado, type Newsletter, type Periodicidade, type Registo, type Ressalva } from "./tipos.ts";
import { codigoDaMarca, marcaDoCliente } from "./controlo-cliente.ts";
import { pausaNoDia } from "./pausas.ts";
import { eRemetenteDeAvisos } from "./avisos-remetentes.ts";

/** "09/11 às 10:35", hora de Lisboa. */
function diaMesDe(isoUtc: string): string {
  const d = new Date(isoUtc);
  return `${diaMes(dataLocal(d))} às ${horaLocal(d)}`;
}

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
      (newsletter_id, data_prevista, hora_limite, codigo_estado, nr_ocorrencias, detalhe, fechado, calendario)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?)
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
        pausa: pausaNoDia(n.id, data),
      });
      // Código 6 nasce fechado: não há nada à espera de acontecer.
      const fechado = r.codigo === 6 ? 1 : 0;
      const res = inserir.run(
        n.id, data, paraIso(horaLimite), r.codigo, r.detalhe, fechado, JSON.stringify(calendarioDe(n)),
      );
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
  id: number;
  marcas: string | null;
  recebido_em: string;
  hash_conteudo: string;
  assunto: string;
  corpo_html: string;
}

/**
 * Os emails de uma newsletter que pertencem à edição de um dia, por ordem de
 * chegada. A pertença é a janela da edição (`dataEdicao`), não o dia do
 * calendário.
 *
 * Se nada chegou na janela, um email recebido nos dias seguintes que não têm
 * edição própria (uma semanal que sai três dias depois, uma "dias úteis" que
 * sai ao sábado) é esta edição a sair tarde — retroativamente, o "Não Saiu"
 * passa a "Saiu Atrasada". Numa diária o dia seguinte já tem edição própria:
 * o que lá chega é dessa.
 */
function emailsDaEdicao(n: Newsletter, data: string): EmailGuardado[] {
  const seguintes = diasSeguintesSemEdicao(n, data);
  const ate = seguintes.at(-1) ?? data;
  const { inicio, fim } = intervaloDeBusca(data, ate);
  const linhas = db()
    .prepare(
      `SELECT id, marcas, recebido_em, hash_conteudo, assunto, corpo_html FROM emails
        WHERE newsletter_id = ? AND recebido_em >= ? AND recebido_em < ?
        ORDER BY recebido_em ASC`,
    )
    .all(n.id, paraIso(inicio), paraIso(fim)) as EmailGuardado[];
  const proprios = linhas.filter((l) => dataEdicao(n, new Date(l.recebido_em)) === data);
  if (proprios.length > 0 || seguintes.length === 0) return proprios;
  const dias = new Set(seguintes);
  const tardios = linhas.filter((l) => dias.has(dataEdicao(n, new Date(l.recebido_em))));
  // Só o primeiro envio: o que vier a seguir, noutro dia, não é um duplicado
  // desta edição.
  return tardios.slice(0, 1);
}

/**
 * O conteúdo de um email para comparar edições: o hash e os artigos,
 * recalculados do HTML guardado. O `hash_conteudo` gravado na recolha foi
 * feito com a normalização dessa altura; se a normalização mudar, comparar
 * um hash novo com um antigo dava sempre "conteúdo novo" — um 1 sem prova.
 * Recalculando os dois lados com o mesmo código, isso não acontece.
 */
function conteudoDe(e: { hash_conteudo: string; corpo_html: string }): { hash: string; artigos: string[] } {
  if (!e.corpo_html) return { hash: e.hash_conteudo, artigos: [] };
  return { hash: processarCorpo(e.corpo_html).hash, artigos: extrairArtigos(e.corpo_html) };
}

/** A edição anterior efetivamente recebida, para comparação de conteúdo (§7.4). */
function edicaoAnteriorDe(n: Newsletter, data: string): EdicaoAnterior | null {
  // Procura-se para trás a partir do início da janela de busca; o filtro por
  // `dataEdicao` garante que não se apanha um envio da própria edição.
  const { fim } = intervaloDeBusca(data);
  const linhas = db()
    .prepare(
      `SELECT recebido_em, hash_conteudo, corpo_html FROM emails
        WHERE newsletter_id = ? AND recebido_em < ?
        ORDER BY recebido_em DESC LIMIT 20`,
    )
    .all(n.id, paraIso(fim)) as { recebido_em: string; hash_conteudo: string; corpo_html: string }[];

  for (const l of linhas) {
    const dia = dataEdicao(n, new Date(l.recebido_em));
    if (dia < data) return { data: dia, ...conteudoDe(l) };
  }
  return null;
}

/**
 * §7.2 — Reavaliar o registo de uma newsletter num dia, a partir dos emails
 * que estão gravados. Idempotente: correr duas vezes dá o mesmo resultado.
 */
export function reavaliar(
  newsletterId: string,
  data: string,
  opcoes: { leituraOk?: Date } = {},
): Registo | null {
  const configurada = newsletterPorId(newsletterId);
  if (!configurada) return null;

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
  const n = newsletterNoDia(configurada, data, existente.calendario);

  // A hora limite vem sempre da configuração atual: se a hora prevista mudar,
  // um limite gravado à data da geração ficaria desatualizado.
  const horaLimite = horaLimiteDe(n, data);
  const agora = new Date();
  // O "fechado" de um 6 não diz nada sobre a caixa: o 6 nasce fechado. Se o
  // registo deixar de ser 6 (newsletter reativada, calendário mudado), volta
  // a abrir e só fecha com leitura e prova (`fecharVencidos`). E nada fica
  // fechado antes do limite (hora prevista mudada para mais tarde).
  let fechado: 0 | 1 = existente.codigo_estado === 6 ? 0 : existente.fechado;
  if (horaLimite > agora) fechado = 0;
  const emails = emailsDaEdicao(n, data);
  const r = classificar({
    newsletter: n,
    dataPrevista: data,
    horaLimite,
    ocorrencias: emails.map((e) => {
      const eb = marcasDoEmail(e.id, e.marcas).eb;
      return { recebidoEm: new Date(e.recebido_em), ...conteudoDe(e), envio: eb?.envio, destino: eb?.destino };
    }),
    edicaoAnterior: edicaoAnteriorDe(n, data),
    fechado: fechado === 1,
    pausa: pausaNoDia(n.id, data),
    conteudo:
      emails.length > 0
        ? sinaisConteudo(edicaoDoEmail(n, emails[0].id, emails[0].recebido_em), historico(n, data))
        : undefined,
  });
  if (r.codigo === 6) fechado = 1;

  // Sinal auxiliar, não mexe no código: a data que o próprio email escreve.
  const primeiro = r.nrOcorrencias > 0 ? emails[0] : undefined;
  let detalhe = primeiro
    ? `${r.detalhe} ${fraseData(datasNoEmail(primeiro.assunto, primeiro.corpo_html, data), data, r.codigo === 4)}`
    : r.detalhe;

  // Um 1 sem edição anterior comparável chegou, mas "conteúdo atualizado" não
  // está provado: o painel mostra "Saiu (sem termo de comparação)".
  let ressalva: Ressalva | null = r.codigo === 1 && r.semComparacao ? "sem-comparacao" : null;

  // "Não Saiu" só com prova de ausência (`motivosSemProva`). Sem ela o
  // registo fica — ou volta a ficar — em aberto com a ressalva "sem-prova": o
  // painel e o Excel mostram "Não recebida – sem prova" (ou "Não assinada no
  // email", se não houver remetente) e o detalhe diz porquê. O código continua
  // 5 na base de dados (o CHECK só aceita 1 a 6); é `fechado = 0` que impede
  // que seja lido como "Não Saiu". Nunca se escreve "→ Não Saiu" sem prova.
  // Regra do cliente: passou a hora limite (prevista + 30 min) sem nada → "Não
  // Saiu" (com prova). Se o email chegar depois, o registo passa a "Saiu
  // Atrasada" na reavaliação seguinte — fechar tranca o relógio, não a verdade.
  if (r.codigo === 5 && horaLimite <= agora) {
    const limite = horaLocal(horaLimite);
    // "Não recebida" só depois de a caixa ter sido lida depois do limite:
    // antes disso (arranque depois de uma paragem, leitura a falhar) o email
    // pode estar na caixa por ler — é "Por confirmar".
    // Só o `fecharVencidos` fecha um 5, e só com uma leitura depois do limite:
    // um registo já fechado já tem essa prova.
    const lido = opcoes.leituraOk
      ? opcoes.leituraOk.getTime() >= horaLimite.getTime() + MARGEM_FECHO_MIN * 60_000
      : fechado === 1 || leituraCobre(data, horaLimite);
    const motivos = lido ? motivosSemProva(n, data, horaLimite) : [];
    if (!lido) {
      fechado = 0;
      detalhe =
        `Nada recebido até ao limite das ${limite}. Por confirmar: ` +
        `falta uma leitura bem-sucedida da caixa, feita depois disso, que cubra este dia sem intervalos.`;
    } else if (motivos.length > 0) {
      fechado = 0;
      ressalva = "sem-prova";
      detalhe =
        `Nada recebido até ao limite das ${limite}, mas não se pode ` +
        `afirmar "Não Saiu": ${motivos.join("; ")}.`;
    } else if (fechado === 0) {
      detalhe =
        `Nada recebido até ao limite das ${limite}. Por confirmar: ` +
        `falta uma leitura bem-sucedida da caixa, feita depois disso, que cubra este dia sem intervalos.`;
    } else {
      detalhe = `Nada recebido até ao limite das ${limite} → Não Saiu. Se chegar mais tarde, passa a "Saiu Atrasada".`;
    }
  }

  // Nada na nossa caixa: o controlo manual do cliente (controlo-cliente.ts),
  // se tiver este dia, é a segunda caixa. Com email, vale o que medimos.
  let codigo: CodigoEstado = r.codigo;
  let fonte: "cliente" | null = null;
  const cliente = r.nrOcorrencias === 0 && horaLimite <= agora ? marcaDoCliente(n.id, data) : null;
  if (cliente) {
    const importado = `${diaMesDe(cliente.importado_em)}`;
    const c = codigoDaMarca(cliente.valor);
    if (c !== 5 && c !== 6) {
      codigo = c;
      fonte = "cliente";
      fechado = 1;
      ressalva = null;
      detalhe =
        `Não chegou à caixa do monitor, mas o controlo manual do cliente (importado a ${importado}) marca ` +
        `${cliente.valor} «${cliente.valor === 7 ? "Saiu Errada" : DESIGNACOES[c]}» → conta como saída. ` +
        `Hora e conteúdo não medidos pelo monitor.`;
    } else if (c === 5 && r.codigo === 5) {
      fonte = "cliente";
      fechado = 1;
      ressalva = null;
      detalhe =
        `Nada recebido até ao limite das ${horaLocal(horaLimite)}, nem na caixa do monitor nem na do cliente ` +
        `(controlo importado a ${importado}) → Não Saiu.`;
    } else if (c === 6 && r.codigo !== 6) {
      codigo = 6;
      fonte = "cliente";
      fechado = 1;
      ressalva = null;
      detalhe = `Sem email. O controlo manual do cliente (importado a ${importado}) marca «${DESIGNACOES[6]}» neste dia.`;
    }
  }

  bd.prepare(
    `UPDATE registos
        SET hora_limite = ?, hora_recebida = ?, atraso_minutos = ?, codigo_estado = ?,
            nr_ocorrencias = ?, detalhe = ?, fechado = ?, ressalva = ?, calendario = ?, fonte = ?
      WHERE id = ?`,
  ).run(
    paraIso(horaLimite),
    r.horaRecebida ? paraIso(r.horaRecebida) : null,
    r.atrasoMinutos,
    codigo,
    r.nrOcorrencias,
    detalhe,
    fechado,
    ressalva,
    JSON.stringify(calendarioDe(n)),
    fonte,
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
 * As leituras gravadas (`estado`) cobrem esta edição: houve uma leitura boa
 * depois do limite (mais a margem) e a cobertura contínua começa antes da
 * janela. É a mesma prova que o `fecharVencidos` exige, para as reavaliações
 * feitas fora dele (arranque, email novo).
 */
function leituraCobre(data: string, horaLimite: Date): boolean {
  const { ok, coberta } = estadoLeitura();
  if (!ok || !coberta) return false;
  return (
    new Date(ok).getTime() >= horaLimite.getTime() + MARGEM_FECHO_MIN * 60_000 &&
    intervaloDeBusca(data).inicio >= new Date(coberta)
  );
}

/**
 * §7.3 — fechar os registos cuja hora limite já passou. Classificação
 * definitiva e `fechado = true`.
 *
 * Só fecha com prova: tem de ter havido uma leitura bem-sucedida da caixa
 * depois do limite (mais a margem), e essa leitura tem de ter coberto o dia
 * da edição. Sem isso o registo fica em aberto — o painel mostra-o como "Por
 * confirmar" — em vez de virar um "Não Saiu" que pode ser só a caixa por ler.
 *
 * `desde` é o início da cobertura contínua da caixa (`coberturaDesde`), não
 * só da última leitura: o que importa é que nenhum intervalo da janela da
 * edição tenha ficado por ler.
 *
 * Um 5 sem prova de ausência (`motivosSemProva`) também não fecha: fica em
 * aberto, com o detalhe atualizado, e volta a ser tentado no ciclo seguinte.
 * Devolve quantos ficaram fechados.
 */
export function fecharVencidos(leitura: { ok: Date; desde: Date }): number {
  const bd = db();
  const ate = somarMinutos(leitura.ok, -MARGEM_FECHO_MIN);
  const vencidos = (
    bd
      .prepare(`SELECT * FROM registos WHERE fechado = 0 AND hora_limite <= ?`)
      .all(paraIso(ate)) as Registo[]
  ).filter((reg) => intervaloDeBusca(reg.data_prevista).inicio >= leitura.desde);

  let fechados = 0;
  for (const reg of vencidos) {
    bd.prepare(`UPDATE registos SET fechado = 1 WHERE id = ?`).run(reg.id);
    // Depois de fechar, para que o detalhe use a redação de dia fechado. Se o
    // 5 não tiver prova de ausência, o `reavaliar` volta a abri-lo.
    const r = reavaliar(reg.newsletter_id, reg.data_prevista, { leituraOk: leitura.ok });
    if (r?.fechado === 1) fechados++;
  }
  return fechados;
}

/**
 * Volta a verificar os "Não Saiu" dos últimos dias. A prova de ausência pode
 * cair depois de fechada: faltam também as edições seguintes (a caixa foi
 * cortada, não foi a newsletter que não saiu), ou chegou entretanto um email
 * por atribuir que pode ser dela. Os que perdem a prova voltam a "sem prova";
 * os que ganham um email passam a "Saiu Atrasada". Barato: só os 5 fechados.
 */
export function reverNaoSaiu(nrDias = 14): number {
  const desde = ultimosDias(nrDias)[0];
  const linhas = db()
    .prepare(
      `SELECT newsletter_id, data_prevista FROM registos
        WHERE fechado = 1 AND codigo_estado = 5 AND data_prevista >= ?`,
    )
    .all(desde) as { newsletter_id: string; data_prevista: string }[];
  let mudaram = 0;
  for (const l of linhas) {
    const r = reavaliar(l.newsletter_id, l.data_prevista);
    if (r && (r.fechado === 0 || r.codigo_estado !== 5)) mudaram++;
  }
  return mudaram;
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
  ressalva: Ressalva | null;
  /** Minutos depois da hora limite (0 = dentro da janela); null sem email. */
  atrasoMinutos: number | null;
  /** Hora local (HH:MM) a que chegou o 1.º envio; null sem email. */
  horaRecebida: string | null;
  /** "cliente": o estado vem do controlo manual do cliente, não da nossa caixa. */
  fonte: "cliente" | null;
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
          ressalva: r.ressalva ?? null,
          atrasoMinutos: r.atraso_minutos ?? null,
          horaRecebida: r.hora_recebida ? horaLocal(new Date(r.hora_recebida)) : null,
          fonte: r.fonte === "cliente" ? "cliente" : null,
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
  return linhas.filter((l) => !naoEEdicao(l.assunto) && !eRemetenteDeAvisos(l.remetente));
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
