import { db } from "./db.ts";
import { estaConfigurada } from "../../config/newsletters.ts";
import { ehDiaEsperado } from "./classificacao.ts";
import { newsletterDoRegisto } from "./calendario.ts";
import { eNaoEdicaoDoEditor, extrairEndereco, extrairNome, naoEEdicao, normalizarAssunto } from "./correspondencia.ts";
import { lerCampanhas, marcasDoEmail, type Campanhas, type Marcas } from "./marcas.ts";
import { dataEdicao, intervaloDeBusca } from "./edicao.ts";
import { dataLocal, diaMes, horaLocal, paraInstante, paraIso, somarDias } from "./tempo.ts";
import type { Newsletter } from "./tipos.ts";
import { eRemetenteDeAvisos } from "./avisos-remetentes.ts";

/**
 * Prova de ausência: quando é que "não chegou nada" quer mesmo dizer "Não
 * Saiu" (código 5 fechado).
 *
 * Uma leitura da caixa bem-sucedida sem email da newsletter NÃO chega. A
 * partir de 06/10 os editores deixaram de mandar as diárias a esta caixa por
 * inatividade (antes vieram os emails "Queremos garantir que continua
 * connosco"; o volume diário caiu de 20–38 para 1–9; as semanais continuam a
 * chegar). Nada chegar pode ser a newsletter não ter saído, ou a caixa ter
 * deixado de a receber — e só o primeiro é "Não Saiu".
 *
 * Esta função só trata da configuração e do que está na caixa. A prova de
 * leitura (caixa lida depois do limite, sem intervalos) é o `fecharVencidos`
 * que a exige, no momento de fechar.
 */

/**
 * Emails de reconquista: o editor avisa que vai deixar de enviar.
 *
 * A regra principal é estrutural (`eNaoEdicaoDoEditor`): campanha de CRM,
 * do endereço das edições, sem marca de edição — apanha redações novas
 * ("O melhor que publicámos ultimamente", "Volte a ler…", "No Record, o jogo
 * nunca para"…). Este padrão de assunto fica como rede extra, para uma
 * campanha que mude de molde.
 */
const RECONQUISTA =
  /queremos garantir que continua connosco|not[aá]mos que h[aá] algum tempo|sentimos a sua falta/i;

/**
 * As boas-vindas têm a mesma estrutura de CRM, mas dizem o contrário: a caixa
 * acabou de se inscrever. Não contam como reconquista.
 */
const BOAS_VINDAS = /^\s*bem-vind[oa]/i;

/** O email guardado é uma campanha de reconquista do editor? */
export function eReconquista(remetente: string, assunto: string, marcas: Marcas | null): boolean {
  if (RECONQUISTA.test(assunto)) return true;
  if (BOAS_VINDAS.test(assunto) || !marcas) return false;
  return eNaoEdicaoDoEditor(marcas, remetente);
}

/** Edições seguidas sem nada a partir das quais o silêncio deixa de ser prova. */
function maximoSeguidas(n: Newsletter): number {
  return n.periodicidade === "diaria" || n.periodicidade === "dias_uteis" ? 3 : 2;
}

/** Janela para trás em que um email de reconquista invalida a prova. */
const DIAS_RECONQUISTA = 30;

/** Janela, depois do limite, em que se procura o canário. */
const HORAS_CANARIO = 24;

function dominio(endereco: string): string {
  const e = endereco.trim().toLowerCase();
  return e.startsWith("@") ? e.slice(1) : e.slice(e.indexOf("@") + 1);
}

/** O email vem do mesmo endereço, ou do mesmo domínio, de um remetente configurado. */
function mesmoRemetente(n: Newsletter, remetente: string): boolean {
  const endereco = extrairEndereco(remetente);
  const dom = dominio(endereco);
  return n.remetentes.some((r) => {
    const alvo = r.trim().toLowerCase();
    return alvo !== "" && (alvo === endereco || dominio(alvo) === dom);
  });
}

/** Minúsculas, sem acentos, só letras e algarismos, com um espaço em cada ponta. */
function palavras(texto: string): string {
  return ` ${texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/** Todas as palavras da frase aparecem, como palavras inteiras, no texto. */
function temPalavras(texto: string, frase: string): boolean {
  const alvo = palavras(frase).trim();
  if (!alvo) return false;
  return alvo.split(" ").every((p) => texto.includes(` ${p} `));
}

/**
 * Um email que ficou por atribuir PODE ser uma edição desta newsletter?
 *
 * Serve só para impedir um "Não Saiu" sem prova — nunca atribui nada. Conta
 * como plausível:
 *   - vir exatamente de um remetente configurado (o mesmo endereço, ou o
 *     domínio quando a entrada é "@dominio"): não bateu só por causa do
 *     padrão de nome/assunto, ou de um empate entre regras;
 *   - ou ter no nome do remetente ou no assunto o `padraoRemetente`, ou a
 *     marca e o nome da newsletter juntos ("Record" + "Premium").
 *
 * Compromisso: o mesmo DOMÍNIO com outro endereço não chega. O marketing de
 * assinaturas ("Record Premium <info@assinaturas.jornalrecord.pt>") partilha o
 * domínio das edições gratuitas da marca, e contá-lo travaria "Não Saiu"
 * legítimos dessas newsletters sempre que chegasse publicidade. O preço: uma
 * edição que passe a sair de um endereço novo, com um nome que não diga marca
 * e nome, não trava o 5 por esta via — fica em "por classificar" no painel.
 * O contrário também acontece: num endereço partilhado por várias newsletters
 * (info@news.correiodamanha.pt), um email por atribuir trava o 5 de todas as
 * que o usam, nessa janela, até a regra ser afinada. As boas-vindas e
 * promoções conhecidas (`naoEEdicao`) nunca contam, nem o marketing do editor
 * reconhecido pela estrutura (`eNaoEdicaoDoEditor`), quando há `marcas`.
 *
 * Critério da campanha (`campanhaDecide`), antes de tudo o resto: cada
 * newsletter manda as suas edições de uma campanha própria do Echobox, e o
 * token de cada email diz qual é. Se a campanha decide, a heurística do
 * nome e do assunto já não é chamada.
 */
export function podeSerDe(
  n: Newsletter,
  remetente: string,
  assunto: string,
  marcas?: Marcas,
  campanhas: Campanhas = lerCampanhas(),
): boolean {
  if (naoEEdicao(assunto) || RECONQUISTA.test(assunto)) return false;
  // Marketing do editor reconhecido pela estrutura também não é edição (e,
  // se for reconquista, já trava o 5 pela regra 5, com o motivo certo).
  if (marcas && eNaoEdicaoDoEditor(marcas, remetente)) return false;
  const pelaCampanha = marcas ? campanhaDecide(n, marcas, campanhas) : null;
  if (pelaCampanha !== null) return pelaCampanha;
  const endereco = extrairEndereco(remetente);
  const exato = n.remetentes.some((r) => {
    const alvo = r.trim().toLowerCase();
    return alvo !== "" && (alvo.startsWith("@") ? endereco.endsWith(alvo) : endereco === alvo);
  });
  if (exato) return true;
  const texto = palavras(`${extrairNome(remetente)} ${assunto}`);
  if (n.padraoRemetente.trim() && temPalavras(texto, n.padraoRemetente)) return true;
  return temPalavras(texto, n.marca) && temPalavras(texto, n.nome);
}

/**
 * O que a campanha do Echobox diz sobre um email ser (ou não) uma edição
 * desta newsletter: true, false, ou null quando não decide.
 *
 * Medido em 29/09–15/10: 119 edições de 25 newsletters, todas com token;
 * cada newsletter com uma campanha só, nenhuma campanha partilhada. O
 * marketing (boas-vindas, reconquista, "Indica", Record Premium) vem sem
 * token ou de campanhas próprias. Daí:
 *   - campanha de uma edição desta newsletter → é dela (true);
 *   - tem cara de edição (bloco de publicidade ou `marcaCorpo`) → não decide
 *     (null): rede de segurança para templates e campanhas novas;
 *   - campanha de outra newsletter → não é (false);
 *   - esta newsletter tem campanha conhecida e o email vem de outra, ou sem
 *     token → não é edição dela (false): as edições dela trazem sempre a sua;
 *   - esta newsletter ainda não tem campanha conhecida → não decide (null).
 * Uma newsletter que mude de campanha continua a ser atribuída pela
 * `marcaCorpo`, e a campanha nova é aprendida dessa edição.
 */
export function campanhaDecide(n: Newsletter, marcas: Marcas, campanhas: Campanhas): boolean | null {
  const minhas = campanhas.daNewsletter.get(n.id);
  const c = marcas.eb?.campanha;
  if (c && campanhas.dona.get(c) === n.id) return true;
  // Rede de segurança: o que tem cara de edição (o bloco de publicidade de
  // uma newsletter, ou uma `marcaCorpo` configurada) nunca é posto de parte
  // só pela campanha — pode ser um template novo, ou uma campanha nova. A
  // campanha só descarta o que não se parece com edição nenhuma. Nos dados
  // de 29/09 a 15/10, nenhum email por atribuir tinha cara de edição.
  if (marcas.pub || marcas.m.length > 0) return null;
  if (c && campanhas.dona.has(c)) return false;
  return minhas && minhas.size > 0 ? false : null;
}

/**
 * Os emails que a equipa marcou no painel como "não é newsletter" (por
 * mensagem ou por assunto). Já não podem travar um "Não Saiu": é uma
 * decisão humana, registada em `alteracoes`, e desfaz-se no painel.
 */
function excluidos(ids: number[]): Set<number> {
  if (ids.length === 0) return new Set();
  const bd = db();
  const regras = bd.prepare(`SELECT tipo, valor FROM exclusoes`).all() as { tipo: string; valor: string }[];
  if (regras.length === 0) return new Set();
  const mensagens = new Set(regras.filter((r) => r.tipo === "mensagem").map((r) => r.valor));
  const assuntos = new Set(regras.filter((r) => r.tipo === "assunto").map((r) => r.valor));
  const ler = bd.prepare(`SELECT internet_message_id AS m, assunto AS a FROM emails WHERE id = ?`);
  const fora = new Set<number>();
  for (const id of ids) {
    const e = ler.get(id) as { m: string; a: string } | undefined;
    if (e && (mensagens.has(e.m) || assuntos.has(normalizarAssunto(e.a)))) fora.add(id);
  }
  return fora;
}

/** Um email guardado, sem o corpo: as marcas chegam para decidir. */
interface EmailLeve {
  id: number;
  remetente: string;
  assunto: string;
  recebido_em: string;
  marcas: string | null;
}

/** A hora limite de um dia (sem importar registos.ts, que importa este ficheiro). */
function horaLimiteSimples(n: Newsletter, data: string): Date {
  return new Date(paraInstante(data, n.horaPrevista).getTime() + n.toleranciaMinutos * 60_000);
}

/** Houve algum email desta newsletter na edição deste dia? */
function temEdicao(n: Newsletter, data: string): boolean {
  const { inicio, fim } = intervaloDeBusca(data);
  const linhas = db()
    .prepare(
      `SELECT recebido_em FROM emails
        WHERE newsletter_id = ? AND recebido_em >= ? AND recebido_em < ?`,
    )
    .all(n.id, paraIso(inicio), paraIso(fim)) as { recebido_em: string }[];
  return linhas.some((l) => dataEdicao(n, new Date(l.recebido_em)) === data);
}

/**
 * Porque é que a ausência de emails desta newsletter neste dia NÃO prova que
 * não saiu. Lista vazia = há prova (falta só a de leitura, ver acima).
 *
 * Um "Não Saiu" exige, para uma newsletter gratuita:
 *   1. remetentes configurados — sem eles o monitor nunca veria o email;
 *   2. um email da newsletter recebido ANTES deste dia — prova de que a caixa
 *      esteve inscrita. Um recebido só depois não prova que já o estava;
 *   3. nenhum email por atribuir, na janela da edição, que possa ser dela;
 *   4. um canário: outro email do mesmo remetente (endereço ou domínio)
 *      chegou depois do limite, até 24 h — a caixa estava a receber daquele
 *      editor quando esta devia ter chegado;
 *   5. nenhum email de reconquista do mesmo domínio nos 30 dias anteriores
 *      — o editor avisou que ia deixar de enviar. Reconhecido pela estrutura
 *      (`eReconquista`), não só pelo assunto;
 *   6. menos de 3 edições seguidas em falta (2 nas semanais e mensais),
 *      contando para trás E para a frente — silêncio prolongado é mais
 *      provavelmente a caixa cortada do que a newsletter parada, e não se
 *      distingue. Para a frente: o primeiro dia de um corte parece um "Não
 *      Saiu" isolado; quando faltam as seguintes, deixa de o ser (o ciclo
 *      revê os "Não Saiu" recentes, `reverNaoSaiu`).
 *
 * As pagas seguem as mesmas regras: desde 05/11/2026 a caixa é assinante
 * (acesso premium por um ano), deixaram de ser um grupo de controlo.
 */
export function motivosSemProva(n: Newsletter, data: string, horaLimite: Date): string[] {
  const motivos: string[] = [];
  const bd = db();

  if (!estaConfigurada(n)) {
    motivos.push(
      "a newsletter não tem remetente configurado, por isso o monitor nunca reconheceria um email dela",
    );
  }

  // 2. Inscrição.
  const primeiro = bd
    .prepare(`SELECT MIN(recebido_em) AS r FROM emails WHERE newsletter_id = ?`)
    .get(n.id) as { r: string | null };
  if (!primeiro.r) {
    motivos.push("nunca chegou à caixa nenhum email desta newsletter — não há prova de que a caixa esteja inscrita");
  } else if (dataEdicao(n, new Date(primeiro.r)) >= data) {
    motivos.push(
      `o primeiro email desta newsletter na caixa é de ${diaMes(dataEdicao(n, new Date(primeiro.r)))}; ` +
        "antes disso não há prova de que a caixa a recebia",
    );
  }

  // 3. Por atribuir que pode ser dela.
  const { inicio, fim } = intervaloDeBusca(data);
  const campanhas = lerCampanhas();
  const candidatos = (
    bd
      .prepare(
        `SELECT id, remetente, assunto, recebido_em, marcas FROM emails INDEXED BY idx_emails_identificacao
          WHERE newsletter_id IS NULL AND recebido_em >= ? AND recebido_em < ?
          ORDER BY recebido_em ASC`,
      )
      .all(paraIso(inicio), paraIso(fim)) as EmailLeve[]
  ).filter(
    (e) =>
      dataEdicao(n, new Date(e.recebido_em)) === data &&
      // Um aviso do cliente (avisos.ts) não é edição: pode citar a newsletter.
      !eRemetenteDeAvisos(e.remetente) &&
      podeSerDe(n, e.remetente, e.assunto, marcasDoEmail(e.id, e.marcas), campanhas),
  );
  const fora = excluidos(candidatos.map((e) => e.id));
  const soltos = candidatos.filter((e) => !fora.has(e.id));
  if (soltos.length > 0) {
    const e = soltos[0];
    motivos.push(
      `${soltos.length} email(s) por atribuir nesta janela podem ser dela ` +
        `(ex.: «${e.remetente}», «${e.assunto}», às ${horaLocal(new Date(e.recebido_em))})`,
    );
  }

  if (n.remetentes.length > 0) {
    // 4. Canário.
    const ate = new Date(horaLimite.getTime() + HORAS_CANARIO * 3_600_000);
    // O marketing do editor não conta: a campanha de reconquista chega
    // precisamente quando o editor corta as edições a esta caixa.
    const depois = bd
      .prepare(
        `SELECT id, remetente, assunto, recebido_em, marcas FROM emails INDEXED BY idx_emails_identificacao
          WHERE (newsletter_id IS NULL OR newsletter_id <> ?) AND recebido_em > ? AND recebido_em <= ?`,
      )
      .all(n.id, paraIso(horaLimite), paraIso(ate)) as EmailLeve[];
    const canario = depois.some(
      (e) =>
        mesmoRemetente(n, e.remetente) &&
        !naoEEdicao(e.assunto) &&
        !eReconquista(e.remetente, e.assunto, marcasDoEmail(e.id, e.marcas)),
    );
    if (!canario) {
      motivos.push(
        "nenhum outro email do mesmo remetente chegou nas 24 h depois do limite — sem prova de que a " +
          "caixa estava a receber deste editor",
      );
    }

    // 5. Reconquista: nos 30 dias anteriores e também na janela do canário
    // (até 24 h depois do limite) — a campanha que chega nessa tarde diz o
    // mesmo que a da semana anterior.
    const desde = new Date(horaLimite.getTime() - DIAS_RECONQUISTA * 86_400_000);
    const avisos = (
      bd
        .prepare(
          `SELECT id, remetente, assunto, recebido_em, marcas FROM emails INDEXED BY idx_emails_identificacao
            WHERE recebido_em >= ? AND recebido_em <= ? ORDER BY recebido_em DESC`,
        )
        .all(paraIso(desde), paraIso(ate)) as EmailLeve[]
    ).filter(
      (e) =>
        mesmoRemetente(n, e.remetente) &&
        eReconquista(e.remetente, e.assunto, marcasDoEmail(e.id, e.marcas)),
    );
    if (avisos.length > 0) {
      const e = avisos[0];
      motivos.push(
        `o editor mandou um email de reconquista a ${diaMes(dataLocal(new Date(e.recebido_em)))} ` +
          `(«${e.assunto}») — pode ter deixado de enviar para esta caixa`,
      );
    }
  }

  // 6. Edições seguidas em falta, contando com esta: para trás e, até ao
  // último dia cujo limite já passou, para a frente.
  const maximo = maximoSeguidas(n);
  let seguidas = 1;
  for (let d = somarDias(data, -1), i = 0; seguidas < maximo && i < 62; d = somarDias(d, -1), i++) {
    // O calendário desse dia, não o de hoje (calendario.ts).
    const nd = newsletterDoRegisto(n, d);
    if (!ehDiaEsperado(nd, d)) continue;
    if (temEdicao(nd, d)) break;
    seguidas++;
  }
  const agora = new Date();
  const existe = bd.prepare(`SELECT 1 FROM registos WHERE newsletter_id = ? AND data_prevista = ?`);
  for (let d = somarDias(data, 1), i = 0; seguidas < maximo && i < 62; d = somarDias(d, 1), i++) {
    // Só os dias que o monitor já gerou: um dia sem registo não foi observado.
    if (!existe.get(n.id, d)) break;
    const nd = newsletterDoRegisto(n, d);
    if (horaLimiteSimples(nd, d) > agora) break;
    if (!ehDiaEsperado(nd, d)) continue;
    if (temEdicao(nd, d)) break;
    seguidas++;
  }
  if (seguidas >= maximo) {
    motivos.push(
      `faz parte de ${seguidas} edições seguidas sem nada recebido — silêncio prolongado não distingue ` +
        `"não saiu" de "a caixa deixou de a receber"`,
    );
  }

  return motivos;
}
