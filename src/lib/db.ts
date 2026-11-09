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

  if (!colunas.some((c) => c.name === "calendario")) {
    bd.exec(`ALTER TABLE registos ADD COLUMN calendario TEXT DEFAULT NULL`);
  }

  // Marcas extraídas do corpo à entrada (marcas.ts). Em bases antigas a
  // coluna nasce vazia e é preenchida pelo `garantirMarcas`, uma vez.
  const colunasEmails = bd.prepare(`PRAGMA table_info(emails)`).all() as { name: string }[];
  if (!colunasEmails.some((c) => c.name === "marcas")) {
    bd.exec(`ALTER TABLE emails ADD COLUMN marcas TEXT DEFAULT NULL`);
  }
  // Resultado da abertura (abertura.ts). Os emails que já lá estavam foram
  // pedidos uma vez à chegada e não se sabe se responderam: ficam a -2
  // ("anterior ao registo") e não se voltam a pedir — nunca abrir duas vezes.
  if (!colunasEmails.some((c) => c.name === "aberto_em")) {
    bd.transaction(() => {
      bd.exec(`ALTER TABLE emails ADD COLUMN aberto_em TEXT DEFAULT NULL`);
      bd.exec(`ALTER TABLE emails ADD COLUMN abertura_falhas INTEGER NOT NULL DEFAULT 0`);
      bd.exec(`ALTER TABLE emails ADD COLUMN abertura_tentada_em TEXT DEFAULT NULL`);
      bd.exec(`UPDATE emails SET abertura_falhas = -2`);
    })();
  }
  // Só os por abrir, com o que a escolha precisa: o ciclo de 5 em 5 minutos
  // encontra-os sem atravessar os corpos (ver o índice abaixo).
  bd.exec(
    `CREATE INDEX IF NOT EXISTS idx_emails_por_abrir
       ON emails (recebido_em, abertura_falhas, abertura_tentada_em)
       WHERE aberto_em IS NULL AND abertura_falhas >= 0`,
  );
  // Índice de cobertura da reclassificação. O corpo (~70 KB) transborda para
  // páginas de overflow e as colunas gravadas DEPOIS dele (newsletter_id,
  // marcas) só se leem percorrendo-as todas — ler só essas colunas custava
  // quase o mesmo que ler o corpo. Com este índice, a leitura de 5 em 5
  // minutos não toca na tabela. Começa pela data para servir também as
  // procuras por janela da prova de ausência (prova.ts).
  bd.exec(
    `CREATE INDEX IF NOT EXISTS idx_emails_identificacao
       ON emails (recebido_em, remetente, assunto, newsletter_id, marcas)`,
  );

  // Data de publicação de cada artigo para onde as edições apontam
  // (datas-artigos.ts): a prova de "conteúdo desatualizado" que não depende
  // do aspeto da newsletter. Um URL por linha, pedido uma vez.
  bd.exec(
    `CREATE TABLE IF NOT EXISTS artigos (
       url          TEXT PRIMARY KEY,
       publicado_em TEXT DEFAULT NULL,
       estado       INTEGER NOT NULL DEFAULT 0,
       tentativas   INTEGER NOT NULL DEFAULT 0,
       pedido_em    TEXT DEFAULT NULL
     )`,
  );

  ligacao = bd;
  versaoAplicada = -1;
  sincronizarRegras(bd);
  return bd;
}

export function fecharDb(): void {
  ligacao?.close();
  ligacao = null;
}
