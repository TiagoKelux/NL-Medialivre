import { db } from "./db.ts";

/**
 * Saúde da leitura da caixa. Sem isto, uma palavra-passe revogada ou a
 * internet em baixo só se viam no log do pm2, e no painel os registos iam
 * fechando como "Não Saiu" — indistinguível de uma newsletter que não saiu.
 */

export interface EstadoLeitura {
  /** ISO da última leitura que correu bem. */
  ok: string | null;
  /** ISO do início da janela que essa leitura cobriu. */
  desde: string | null;
  /** Última falha, se for mais recente do que a última leitura boa. */
  falha: { em: string; erro: string } | null;
}

export function registarLeitura(erro: Error | null, desde?: Date): void {
  const bd = db();
  const agora = new Date().toISOString();
  const gravar = bd.prepare(
    `INSERT INTO estado (chave, valor) VALUES (?, ?)
       ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor`,
  );
  if (erro) {
    gravar.run("leitura_falha", JSON.stringify({ em: agora, erro: erro.message }));
  } else {
    gravar.run("leitura_ok", agora);
    if (desde) gravar.run("leitura_desde", desde.toISOString());
    bd.prepare(`DELETE FROM estado WHERE chave = 'leitura_falha'`).run();
  }
}

export function estadoLeitura(): EstadoLeitura {
  const bd = db();
  const ler = (chave: string) =>
    (bd.prepare(`SELECT valor FROM estado WHERE chave = ?`).get(chave) as
      | { valor: string }
      | undefined)?.valor ?? null;

  const bruto = ler("leitura_falha");
  return {
    ok: ler("leitura_ok"),
    desde: ler("leitura_desde"),
    falha: bruto ? JSON.parse(bruto) : null,
  };
}
