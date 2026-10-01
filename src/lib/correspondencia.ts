import { NEWSLETTERS, estaConfigurada } from "../../config/newsletters.ts";
import type { Newsletter } from "./tipos.ts";

/**
 * Correspondência email → newsletter (§6 da spec).
 *
 * A spec pedia "remetente na lista **e** assunto contém o padrão". Os emails
 * reais obrigaram a alargar: a FLASH! Bom dia chega de `info@news.flash.pt`,
 * endereço partilhado com as outras newsletters da marca, e o assunto é a
 * manchete do dia — muda sempre. O que a identifica é o *nome* do remetente,
 * "FLASH! Bom dia".
 *
 * Regra atual: o endereço tem de bater, e todos os padrões preenchidos têm de
 * bater. Basta um padrão — nome ou assunto — para a newsletter ser
 * identificável; exigir os dois deixava de fora metade dos casos reais.
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

/**
 * A confirmação de subscrição e as promoções saem do mesmo remetente mas não
 * são edições ("Opinião do dia", "CM Bom dia" e "FLASH! Mundo" mandam-nas com
 * regularidade). Exportado para o painel não as listar como "por classificar".
 */
export function naoEEdicao(assunto: string): boolean {
  const a = assunto.trim();
  return (
    /^bem-vind[oa]/i.test(a) ||
    /^(queremos garantir que continua connosco|queremos a informação do seu lado|acompanhe as notícias mais recentes)/i.test(a)
  );
}

/** Quão específica é a regra: mais texto exigido, menos hipóteses de engano. */
function especificidade(n: Newsletter): number {
  return n.padraoRemetente.trim().length + n.padraoAssunto.trim().length;
}

export function corresponder(
  remetente: string,
  assunto: string,
  newsletters: Newsletter[] = NEWSLETTERS,
): Newsletter | null {
  if (naoEEdicao(assunto)) return null;

  const nome = extrairNome(remetente);
  const candidatas = newsletters.filter(
    (n) =>
      estaConfigurada(n) &&
      enderecoBate(remetente, n.remetentes) &&
      (!n.padraoRemetente || contem(nome, n.padraoRemetente)) &&
      (!n.padraoAssunto || contem(assunto, n.padraoAssunto)),
  );
  if (candidatas.length <= 1) return candidatas[0] ?? null;

  // Mais do que uma regra serve ("Fecho" e "Dow Jones - Fecho"): ganha a mais
  // específica. Empate é ambiguidade de configuração — atribuir à primeira da
  // lista daria crédito à newsletter errada e um falso "Não Saiu" à outra.
  // Fica por atribuir, e o painel mostra-o em "por classificar".
  const ordenadas = [...candidatas].sort((a, b) => especificidade(b) - especificidade(a));
  if (especificidade(ordenadas[0]) === especificidade(ordenadas[1])) return null;
  return ordenadas[0];
}
