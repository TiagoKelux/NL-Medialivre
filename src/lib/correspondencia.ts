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

export function corresponder(
  remetente: string,
  assunto: string,
  newsletters: Newsletter[] = NEWSLETTERS,
): Newsletter | null {
  const nome = extrairNome(remetente);

  for (const n of newsletters) {
    if (!estaConfigurada(n)) continue;
    if (!enderecoBate(remetente, n.remetentes)) continue;
    if (n.padraoRemetente && !contem(nome, n.padraoRemetente)) continue;
    if (n.padraoAssunto && !contem(assunto, n.padraoAssunto)) continue;
    return n;
  }
  return null;
}
