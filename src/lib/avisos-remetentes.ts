/**
 * Quem pode mandar avisos ao monitor por email (avisos.ts): os endereços em
 * `AVISOS_REMETENTES`, separados por vírgulas. Vazio = ninguém, e a
 * funcionalidade fica desligada.
 *
 * Qualquer pessoa pode escrever para a caixa monitorizada; um email de fora
 * nunca pode pôr uma newsletter em pausa. Compara-se o endereço exato (sem
 * maiúsculas), não o domínio.
 *
 * Função pura sobre o ambiente: serve também à prova de ausência e às listas
 * "por atribuir", que não devem tratar um aviso como edição de newsletter.
 */

export function remetentesAutorizados(valor = process.env.AVISOS_REMETENTES ?? ""): string[] {
  return valor
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s));
}

/** O endereço de "Nome <a@b.pt>" ou "a@b.pt", em minúsculas. */
function endereco(remetente: string): string {
  const m = remetente.match(/<([^>]+)>/);
  return (m ? m[1] : remetente).trim().toLowerCase();
}

export function eRemetenteDeAvisos(remetente: string, autorizados = remetentesAutorizados()): boolean {
  if (autorizados.length === 0) return false;
  return autorizados.includes(endereco(remetente));
}

/**
 * Quem pode mandar o Excel de controlo por email (controlo-email.ts): os
 * endereços em `CONTROLO_REMETENTES`, com as mesmas regras. Vazio = ninguém.
 */
export function remetentesDoControlo(valor = process.env.CONTROLO_REMETENTES ?? ""): string[] {
  return remetentesAutorizados(valor);
}

export function eRemetenteDoControlo(remetente: string, autorizados = remetentesDoControlo()): boolean {
  if (autorizados.length === 0) return false;
  return autorizados.includes(endereco(remetente));
}

/**
 * Email do cliente para o monitor (aviso ou Excel de controlo): nunca é edição
 * de newsletter nem entra nas listas "por atribuir".
 */
export function eRemetenteDoCliente(remetente: string): boolean {
  return eRemetenteDeAvisos(remetente) || eRemetenteDoControlo(remetente);
}
