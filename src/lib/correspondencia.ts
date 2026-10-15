import { NEWSLETTERS, estaConfigurada } from "../../config/newsletters.ts";
import type { Newsletter } from "./tipos.ts";

/**
 * Correspondência email → newsletter (§6 da spec).
 *
 * A spec pedia "remetente na lista **e** assunto contém o padrão". Os emails
 * reais obrigaram a mudar: as newsletters de cada marca partilham o endereço
 * (`info@news.flash.pt`…), o assunto é a manchete do dia, e as editoras mandam
 * marketing (boas-vindas, "volte a ler-nos") do MESMO endereço e com o MESMO
 * nome de remetente de uma newsletter verdadeira ("FLASH! Mundo", "Máxima",
 * "Jornal de Negócios Opinião do dia"). Endereço e nome não chegam.
 *
 * O que prova que é uma edição é o corpo: toda a edição de CM, Record,
 * Negócios, FLASH! e Máxima traz o bloco de publicidade da própria newsletter,
 * `…/gampad/ad?iu=/4196/<MARCA>_MASTHEAD/NEWSLETTER_<NOME>_LEADERBOARD`, e
 * nenhum email de marketing o traz. Vidas e MUST não têm esse bloco; trazem o
 * logótipo próprio no cabeçalho. É isto o campo `marcaCorpo`: um texto que só
 * as edições daquela newsletter têm no HTML. Quando está preenchido, é
 * obrigatório — um email do remetente certo sem a marca fica por atribuir, em
 * vez de passar por edição (um "Saiu" falso).
 *
 * Regra: o endereço tem de bater, e todos os critérios preenchidos — marca no
 * corpo, nome do remetente, pedaço do assunto — têm de bater.
 *
 * O nome do remetente, quando usado, compara-se **por inteiro** (sem distinção
 * de maiúsculas nem de espaços repetidos), nunca por pedaço: com "contém",
 * "Máxima" apanhava a "Máxima Fim de Semana".
 *
 * Sem correspondência → o email guarda-se com `newsletter_id` a null e
 * ignora-se, como a spec manda.
 */

/** "FLASH! Bom dia <info@news.flash.pt>" → "info@news.flash.pt". */
export function extrairEndereco(valor: string): string {
  const entreSinais = valor.match(/<([^>]+)>/);
  return (entreSinais ? entreSinais[1] : valor).trim().toLowerCase();
}

/** "FLASH! Bom dia <info@news.flash.pt>" → "FLASH! Bom dia". */
export function extrairNome(valor: string): string {
  const antes = valor.split("<")[0].trim();
  return antes.replace(/^["']|["']$/g, "").trim();
}

function enderecoBate(remetente: string, lista: string[]): boolean {
  const endereco = extrairEndereco(remetente);
  return lista.some((entrada) => {
    const alvo = entrada.trim().toLowerCase();
    if (!alvo) return false;
    // Uma entrada que comece por "@" vale para todo o domínio.
    return alvo.startsWith("@") ? endereco.endsWith(alvo) : endereco === alvo;
  });
}

function contem(texto: string, padrao: string): boolean {
  return texto.toLowerCase().includes(padrao.trim().toLowerCase());
}

function normalizarNome(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * O HTML traz o mesmo endereço do anúncio umas vezes com "/" e outras com
 * "%2F" (dentro de URLs de clique). Põe-se tudo com "/" antes de procurar.
 */
function normalizarHtml(html: string): string {
  return html.replace(/%2F/gi, "/").toLowerCase();
}

/**
 * Assuntos de marketing conhecidos. Já não são eles que impedem o marketing de
 * passar por edição — isso é a `marcaCorpo`. Servem para o painel não listar
 * estes emails em "por classificar", e como segunda barreira para as
 * newsletters que não tenham marca no corpo.
 */
export const ASSUNTOS_NAO_EDICAO: RegExp[] = [
  /^bem-vind[oa]/i, // todas as marcas
  /^queremos garantir que continua connosco/i, // Negócios
  /^volte a ler o jornal de negócios/i, // Negócios
  /^queremos a informação do seu lado/i, // CM
  /^o melhor que publicámos ultimamente/i, // CM
  /^acompanhe as notícias mais recentes/i, // FLASH!
  /^não queremos que perca as histórias/i, // FLASH!
  /^notámos que há algum tempo que não lê/i, // Máxima
  /^no record, o jogo nunca para/i, // Record (nome "Record Premium")
  /^as grandes histórias do desporto continuam a acontecer/i, // Record
];

/** Exportado para o painel não listar estes emails como "por classificar". */
export function naoEEdicao(assunto: string): boolean {
  const a = assunto.trim();
  return ASSUNTOS_NAO_EDICAO.some((re) => re.test(a));
}

/** Quão específica é a regra: mais texto exigido, menos hipóteses de engano. */
function especificidade(n: Newsletter): number {
  return n.marcaCorpo.trim().length + n.padraoRemetente.trim().length + n.padraoAssunto.trim().length;
}

export function corresponder(
  remetente: string,
  assunto: string,
  html: string,
  newsletters: Newsletter[] = NEWSLETTERS,
): Newsletter | null {
  if (naoEEdicao(assunto)) return null;

  const nome = normalizarNome(extrairNome(remetente));
  const corpo = normalizarHtml(html);
  const bate = (n: Newsletter) =>
    enderecoBate(remetente, n.remetentes) &&
    (!n.marcaCorpo.trim() || corpo.includes(normalizarHtml(n.marcaCorpo.trim()))) &&
    (!n.padraoRemetente.trim() || nome === normalizarNome(n.padraoRemetente)) &&
    (!n.padraoAssunto || contem(assunto, n.padraoAssunto));
  // Regras guardadas no painel (regras-fusao.ts): endereço exato e marca no
  // corpo, cada uma em alternativa ao critério do ficheiro.
  const bateAlternativa = (n: Newsletter) =>
    (n.alternativas ?? []).some(
      (a) =>
        a.marcaCorpo.trim() !== "" &&
        enderecoBate(remetente, [a.remetente]) &&
        corpo.includes(normalizarHtml(a.marcaCorpo.trim())),
    );
  const candidatas = newsletters.filter(
    (n) => estaConfigurada(n) && (bate(n) || bateAlternativa(n)),
  );
  if (candidatas.length <= 1) return candidatas[0] ?? null;

  // Mais do que uma regra serve: ganha a mais específica. Empate é ambiguidade
  // de configuração — atribuir à primeira da lista daria crédito à newsletter
  // errada e um falso "Não Saiu" à outra. Fica por atribuir, e o painel
  // mostra-o em "por classificar".
  const ordenadas = [...candidatas].sort((a, b) => especificidade(b) - especificidade(a));
  if (especificidade(ordenadas[0]) === especificidade(ordenadas[1])) return null;
  return ordenadas[0];
}
