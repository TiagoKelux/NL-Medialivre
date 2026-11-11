import { db } from "./db.ts";
import { importarControlo } from "./importar-controlo.ts";
export { eRemetenteDoControlo, remetentesDoControlo } from "./avisos-remetentes.ts";

/**
 * O Excel de controlo do cliente que chega por email (Power Automate, todos os
 * dias às 19h). Importa-se como se fosse carregado em /controlo.
 *
 * Só de endereços em `CONTROLO_REMETENTES` (separados por vírgulas, endereço
 * exato, sem maiúsculas). Vazio = desligado. Qualquer pessoa pode escrever
 * para a caixa monitorizada, e as marcas do cliente mexem nos estados dos dias
 * sem email: um anexo de fora nunca pode fazer isso.
 *
 * Um anexo que não seja um Excel válido (o Power Automate mal configurado
 * manda o texto "Conteúdo do ficheiro" em vez do ficheiro) não importa nada:
 * fica registado como falha, e o /controlo mostra-a.
 */

function endereco(remetente: string): string {
  const m = remetente.match(/<([^>]+)>/);
  return (m ? m[1] : remetente).trim().toLowerCase();
}

export interface ExcelPorEmail {
  /** Quando foi tratado (ISO). */
  em: string;
  recebidoEm: string;
  remetente: string;
  assunto: string;
  ficheiro: string;
  bytes: number;
  ok: boolean;
  mensagem: string;
}

const CHAVE = "controlo_por_email";

export function ultimoExcelPorEmail(): ExcelPorEmail | null {
  const l = db().prepare(`SELECT valor FROM estado WHERE chave = ?`).get(CHAVE) as { valor: string } | undefined;
  if (!l) return null;
  try {
    return JSON.parse(l.valor) as ExcelPorEmail;
  } catch {
    return null;
  }
}

function registar(r: ExcelPorEmail): void {
  db()
    .prepare(
      `INSERT INTO estado (chave, valor) VALUES (?, ?)
         ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor`,
    )
    .run(CHAVE, JSON.stringify(r));
}

/**
 * Importa os anexos .xlsx de um email do cliente (já confirmado como remetente
 * autorizado). Um email sem anexo .xlsx também fica registado: o cliente
 * mandou o relatório e o ficheiro não veio.
 */
export function importarExcelDoEmail(
  email: { remetente: string; assunto: string; recebidoEm: string; anexos: { nome: string; conteudo: Buffer }[] },
  agora: Date = new Date(),
): ExcelPorEmail {
  const base = {
    em: agora.toISOString(),
    recebidoEm: email.recebidoEm,
    remetente: email.remetente,
    assunto: email.assunto,
  };
  if (email.anexos.length === 0) {
    const r = { ...base, ficheiro: "", bytes: 0, ok: false, mensagem: "O email não trazia nenhum Excel em anexo." };
    registar(r);
    return r;
  }
  let r: ExcelPorEmail | null = null;
  for (const a of email.anexos) {
    const imp = importarControlo(a.conteudo, a.nome, `email: ${endereco(email.remetente)}`);
    const mensagem = imp.ok
      ? imp.mensagem
      : a.conteudo.length < 1024
        ? `O anexo não é um Excel (${a.conteudo.length} bytes). No Power Automate, o anexo tem de ser o conteúdo dinâmico «Conteúdo do ficheiro» do passo que obtém o ficheiro, e não texto escrito.`
        : imp.mensagem;
    r = { ...base, ficheiro: a.nome, bytes: a.conteudo.length, ok: imp.ok, mensagem };
    if (imp.ok) break;
  }
  registar(r!);
  return r!;
}
