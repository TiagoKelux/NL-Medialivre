import { NEWSLETTERS, estaConfigurada } from "../../config/newsletters.ts";
import type { Newsletter } from "./tipos.ts";

/**
 * Correspondência email → newsletter (§6 da spec):
 * remetente na lista **e** assunto contém o padrão.
 *
 * Sem correspondência → o email guarda-se com `newsletter_id` a null e
 * ignora-se. Com três newsletters configuradas, a maioria da caixa cai aqui
 * e é o esperado.
 */

function normalizarEndereco(valor: string): string {
  // Aceita tanto "Nome <a@b.pt>" como "a@b.pt".
  const entreSinais = valor.match(/<([^>]+)>/);
  return (entreSinais ? entreSinais[1] : valor).trim().toLowerCase();
}

function remetenteBate(remetente: string, lista: string[]): boolean {
  const endereco = normalizarEndereco(remetente);
  return lista.some((entrada) => {
    const alvo = entrada.trim().toLowerCase();
    if (!alvo) return false;
    // Uma entrada que comece por "@" vale para todo o domínio.
    return alvo.startsWith("@") ? endereco.endsWith(alvo) : endereco === alvo;
  });
}

function assuntoBate(assunto: string, padrao: string): boolean {
  return assunto.toLowerCase().includes(padrao.trim().toLowerCase());
}

export function corresponder(
  remetente: string,
  assunto: string,
  newsletters: Newsletter[] = NEWSLETTERS,
): Newsletter | null {
  for (const n of newsletters) {
    // Enquanto remetentes/padraoAssunto estiverem por preencher, recolhe-se
    // mas não se classifica.
    if (!estaConfigurada(n)) continue;
    if (remetenteBate(remetente, n.remetentes) && assuntoBate(assunto, n.padraoAssunto)) {
      return n;
    }
  }
  return null;
}
