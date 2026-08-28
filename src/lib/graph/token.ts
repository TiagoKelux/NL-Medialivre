import { db } from "../db.ts";

/**
 * O armazém do refresh token (§5, tabela `graph_token`).
 *
 * Vive separado do `auth.ts` de propósito: saber *se* há token é uma leitura à
 * base de dados e não deve obrigar a carregar o MSAL, que é pesado e só é
 * preciso quando se vai mesmo falar com o Graph.
 */

export interface TokenGuardado {
  refresh_token: string;
  expira_em: string;
}

export function lerToken(): TokenGuardado | null {
  const linha = db()
    .prepare(`SELECT refresh_token, expira_em FROM graph_token WHERE id = 1`)
    .get() as TokenGuardado | undefined;
  return linha ?? null;
}

export function guardarToken(refreshToken: string, expiraEm: string): void {
  db()
    .prepare(
      `INSERT INTO graph_token (id, refresh_token, expira_em) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET refresh_token = excluded.refresh_token,
                                     expira_em = excluded.expira_em`,
    )
    .run(refreshToken, expiraEm);
}

export function temToken(): boolean {
  return lerToken() !== null;
}
