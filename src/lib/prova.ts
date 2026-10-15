import { db } from "./db.ts";
import { estaConfigurada } from "../../config/newsletters.ts";
import { PAGAS } from "../../config/pagas.ts";
import { ehDiaEsperado } from "./classificacao.ts";
import { extrairEndereco, extrairNome, naoEEdicao } from "./correspondencia.ts";
import { dataEdicao, intervaloDeBusca } from "./edicao.ts";
import { dataLocal, diaMes, horaLocal, paraIso, somarDias } from "./tempo.ts";
import type { Newsletter } from "./tipos.ts";

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

/** Emails de reconquista: o editor avisa que vai deixar de enviar. */
const RECONQUISTA =
  /queremos garantir que continua connosco|not[aá]mos que h[aá] algum tempo|sentimos a sua falta/i;

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
 * promoções conhecidas (`naoEEdicao`) nunca contam.
 */
export function podeSerDe(n: Newsletter, remetente: string, assunto: string): boolean {
  if (naoEEdicao(assunto) || RECONQUISTA.test(assunto)) return false;
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
 *   5. nenhum email de reconquista ("Queremos garantir que continua
 *      connosco") do mesmo domínio nos 30 dias anteriores — o editor avisou
 *      que ia deixar de enviar;
 *   6. menos de 3 edições seguidas em falta (2 nas semanais e mensais) —
 *      silêncio prolongado é mais provavelmente a caixa cortada do que a
 *      newsletter parada, e não se distingue.
 *
 * As pagas (`config/pagas.ts`) ficam isentas de todas: a caixa não está
 * inscrita nelas de propósito, sabe-se que não chegam, e o 5 delas é o grupo
 * de controlo que mostra que o motor deteta ausências. A prova de leitura
 * continua a aplicar-se.
 */
export function motivosSemProva(n: Newsletter, data: string, horaLimite: Date): string[] {
  if (PAGAS.has(n.id)) return [];
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
  const soltos = (
    bd
      .prepare(
        `SELECT remetente, assunto, recebido_em FROM emails
          WHERE newsletter_id IS NULL AND recebido_em >= ? AND recebido_em < ?
          ORDER BY recebido_em ASC`,
      )
      .all(paraIso(inicio), paraIso(fim)) as { remetente: string; assunto: string; recebido_em: string }[]
  ).filter(
    (e) => dataEdicao(n, new Date(e.recebido_em)) === data && podeSerDe(n, e.remetente, e.assunto),
  );
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
    const depois = bd
      .prepare(
        `SELECT remetente FROM emails
          WHERE (newsletter_id IS NULL OR newsletter_id <> ?) AND recebido_em > ? AND recebido_em <= ?`,
      )
      .all(n.id, paraIso(horaLimite), paraIso(ate)) as { remetente: string }[];
    if (!depois.some((e) => mesmoRemetente(n, e.remetente))) {
      motivos.push(
        "nenhum outro email do mesmo remetente chegou nas 24 h depois do limite — sem prova de que a " +
          "caixa estava a receber deste editor",
      );
    }

    // 5. Reconquista.
    const desde = new Date(horaLimite.getTime() - DIAS_RECONQUISTA * 86_400_000);
    const avisos = (
      bd
        .prepare(
          `SELECT remetente, assunto, recebido_em FROM emails
            WHERE recebido_em >= ? AND recebido_em <= ? ORDER BY recebido_em DESC`,
        )
        .all(paraIso(desde), paraIso(horaLimite)) as { remetente: string; assunto: string; recebido_em: string }[]
    ).filter((e) => RECONQUISTA.test(e.assunto) && mesmoRemetente(n, e.remetente));
    if (avisos.length > 0) {
      const e = avisos[0];
      motivos.push(
        `o editor mandou um email de reconquista a ${diaMes(dataLocal(new Date(e.recebido_em)))} ` +
          `(«${e.assunto}») — pode ter deixado de enviar para esta caixa`,
      );
    }
  }

  // 6. Edições seguidas em falta, contando com esta.
  const maximo = maximoSeguidas(n);
  let seguidas = 1;
  for (let d = somarDias(data, -1), i = 0; seguidas < maximo && i < 62; d = somarDias(d, -1), i++) {
    if (!ehDiaEsperado(n, d)) continue;
    if (temEdicao(n, d)) break;
    seguidas++;
  }
  if (seguidas >= maximo) {
    motivos.push(
      `é a ${seguidas}.ª edição seguida sem nada recebido — silêncio prolongado não distingue ` +
        `"não saiu" de "a caixa deixou de a receber"`,
    );
  }

  return motivos;
}
