import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ESQUEMA } from "./esquema.ts";

let ligacao: Database.Database | null = null;

/**
 * Ligação única ao SQLite. O esquema é aplicado à cabeça em cada arranque —
 * é tudo `IF NOT EXISTS`, portanto é seguro e dispensa migrações nesta versão.
 */
export function db(): Database.Database {
  if (ligacao) return ligacao;

  const caminho = resolve(process.env.DATABASE_PATH || "./data/monitor.db");
  mkdirSync(dirname(caminho), { recursive: true });

  const bd = new Database(caminho);
  bd.pragma("journal_mode = WAL");
  bd.pragma("foreign_keys = ON");
  bd.exec(ESQUEMA);

  // Coluna acrescentada depois da criação: o CREATE TABLE IF NOT EXISTS não
  // mexe numa tabela que já existe. Não altera o CHECK do código.
  const colunas = bd.prepare(`PRAGMA table_info(registos)`).all() as { name: string }[];
  if (!colunas.some((c) => c.name === "ressalva")) {
    bd.exec(
      `ALTER TABLE registos ADD COLUMN ressalva TEXT DEFAULT NULL
         CHECK (ressalva IN ('sem-prova', 'sem-comparacao'))`,
    );
  }

  ligacao = bd;
  return bd;
}

export function fecharDb(): void {
  ligacao?.close();
  ligacao = null;
}
