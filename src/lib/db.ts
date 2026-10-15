import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ESQUEMA } from "./esquema.ts";
import { aplicarNaConfig, versaoRegras, type RegraGuardada } from "./regras-fusao.ts";

let ligacao: Database.Database | null = null;

/** A versão das regras do painel já aplicada à configuração em memória. */
let versaoAplicada = -1;

/**
 * Funde as regras guardadas no painel (`regras_newsletter`) com o
 * config/newsletters.ts. Corre ao abrir a base e sempre que uma regra muda
 * (a verificação é uma comparação de inteiros), para que tudo o que lê a
 * configuração depois de chamar `db()` veja as regras.
 */
function sincronizarRegras(bd: Database.Database): void {
  const versao = versaoRegras();
  if (versao === versaoAplicada) return;
  versaoAplicada = versao;
  const linhas = bd
    .prepare(
      `SELECT id, newsletter_id AS newsletterId, remetente, marca_corpo AS marcaCorpo
         FROM regras_newsletter ORDER BY id`,
    )
    .all() as RegraGuardada[];
  aplicarNaConfig(linhas);
}

/**
 * Ligação única ao SQLite. O esquema é aplicado à cabeça em cada arranque —
 * é tudo `IF NOT EXISTS`, portanto é seguro e dispensa migrações nesta versão.
 */
export function db(): Database.Database {
  if (ligacao) {
    sincronizarRegras(ligacao);
    return ligacao;
  }

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
  versaoAplicada = -1;
  sincronizarRegras(bd);
  return bd;
}

export function fecharDb(): void {
  ligacao?.close();
  ligacao = null;
}
