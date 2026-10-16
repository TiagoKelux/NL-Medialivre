import { NEWSLETTERS, estaConfigurada } from "../../config/newsletters.ts";
import { extrairMarcas, normalizarHtml, versaoMarcas, type Marcas } from "./marcas.ts";
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

/** Assunto como se compara nas exclusões: sem espaços a mais, sem maiúsculas. */
export function normalizarAssunto(assunto: string): string {
  return assunto.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
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

/**
 * O corpo, para a identificação: ou o HTML, ou as marcas já extraídas dele
 * (`emails.marcas`, ver marcas.ts) — o resultado é o mesmo, sem reler o HTML.
 */
export type Corpo = string | Marcas;

/** Uma função que diz se o corpo traz uma `marcaCorpo` (já normalizada). */
function procurador(corpo: Corpo, newsletters: Newsletter[]): (marca: string) => boolean {
  if (typeof corpo === "string") {
    const html = normalizarHtml(corpo);
    return (marca) => html.includes(marca);
  }
  // Marcas de outra configuração dariam um resultado diferente do HTML: é um
  // erro de programação, não um caso a tolerar.
  if (corpo.v !== versaoMarcas(newsletters)) {
    throw new Error("marcas extraídas com outra configuração — usar marcasDoEmail()/garantirMarcas()");
  }
  const encontradas = new Set(corpo.m);
  return (marca) => encontradas.has(marca);
}

export function corresponder(
  remetente: string,
  assunto: string,
  corpo: Corpo,
  newsletters: Newsletter[] = NEWSLETTERS,
): Newsletter | null {
  if (naoEEdicao(assunto)) return null;

  const nome = normalizarNome(extrairNome(remetente));
  const traz = procurador(corpo, newsletters);
  const bate = (n: Newsletter) =>
    enderecoBate(remetente, n.remetentes) &&
    (!n.marcaCorpo.trim() || traz(normalizarHtml(n.marcaCorpo.trim()))) &&
    (!n.padraoRemetente.trim() || nome === normalizarNome(n.padraoRemetente)) &&
    (!n.padraoAssunto || contem(assunto, n.padraoAssunto));
  // Regras guardadas no painel (regras-fusao.ts): endereço exato e marca no
  // corpo, cada uma em alternativa ao critério do ficheiro.
  const bateAlternativa = (n: Newsletter) =>
    (n.alternativas ?? []).some(
      (a) =>
        a.marcaCorpo.trim() !== "" &&
        enderecoBate(remetente, [a.remetente]) &&
        traz(normalizarHtml(a.marcaCorpo.trim())),
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
  // Duas marcas no corpo que identificam newsletters DIFERENTES são duas
  // provas contraditórias, não uma mais específica do que a outra: o
  // comprimento do nome da marca não decide nada. Por atribuir.
  const marcasQueBatem = (n: Newsletter): Set<string> => {
    const s = new Set<string>();
    if (n.marcaCorpo.trim() && bate(n)) s.add(normalizarHtml(n.marcaCorpo.trim()));
    for (const a of n.alternativas ?? []) {
      const m = a.marcaCorpo.trim();
      if (m && enderecoBate(remetente, [a.remetente]) && traz(normalizarHtml(m))) s.add(normalizarHtml(m));
    }
    return s;
  };
  const doVencedor = marcasQueBatem(ordenadas[0]);
  const contraditoria = ordenadas.slice(1).some((o) => {
    const outras = marcasQueBatem(o);
    return doVencedor.size > 0 && outras.size > 0 && ![...doVencedor].some((m) => outras.has(m));
  });
  if (contraditoria) return null;
  return ordenadas[0];
}

// ── Marketing do editor, pela estrutura ────────────────────────────────────

/**
 * Acima disto de texto visível já não é um email de CRM. As campanhas reais
 * (boas-vindas e reconquista) têm 430–1 250 caracteres; a edição mais curta
 * da caixa, ~1 300, e nenhuma edição usa o editor de campanhas.
 */
export const TEXTO_MAXIMO_CRM = 2000;

/**
 * O email vem de um endereço de edições, mas é marketing do editor (boas-
 * vindas, "volte a ler-nos", "o melhor que publicámos"…) — decidido pela
 * ESTRUTURA do corpo, sem depender da redação do assunto, que muda a cada
 * campanha.
 *
 * Características medidas nos emails reais (snapshot de 29/09 a 15/10):
 *   - remetente: um endereço configurado de uma newsletter (info@news.<marca>);
 *     fora disso a função não se pronuncia (devolve false);
 *   - sem marca de edição: nem o bloco de publicidade
 *     `/4196/<MARCA>_MASTHEAD/NEWSLETTER_<NOME>_LEADERBOARD`, nem a
 *     `marcaCorpo` de nenhuma newsletter desse endereço (o logótipo da Vidas);
 *   - feito no editor de campanhas: imagens em assets.unlayer.com (logótipos,
 *     ícones das redes). Nenhuma edição da caixa as tem; todas as campanhas
 *     de CRM têm 3 ou mais;
 *   - curto: menos de `TEXTO_MAXIMO_CRM` caracteres de texto visível.
 *
 * As promoções de comércio afiliado ("FLASH! Indica") não são apanhadas: não
 * usam o editor de campanhas e não dizem nada sobre a inscrição da caixa.
 *
 * Aceita o HTML ou as marcas já extraídas (`emails.marcas`).
 */
export function eNaoEdicaoDoEditor(
  corpo: Corpo,
  remetente: string,
  newsletters: Newsletter[] = NEWSLETTERS,
): boolean {
  const doEndereco = newsletters.filter((n) => n.remetentes.length > 0 && enderecoBate(remetente, n.remetentes));
  if (doEndereco.length === 0) return false;
  const m = typeof corpo === "string" ? extrairMarcas(corpo, newsletters) : corpo;
  if (m.pub) return false;
  const traz = procurador(m, newsletters);
  if (doEndereco.some((n) => n.marcaCorpo.trim() && traz(normalizarHtml(n.marcaCorpo.trim())))) return false;
  return m.crm > 0 && m.txt < TEXTO_MAXIMO_CRM;
}
