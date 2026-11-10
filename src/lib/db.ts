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

  // O controlo manual do cliente (controlo-cliente.ts): a marca do Excel
  // por newsletter e dia, e cada importação. `registos.fonte` = "cliente"
  // quando o estado vem dessa marca e não da nossa caixa.
  bd.exec(
    `CREATE TABLE IF NOT EXISTS controlo_cliente (
       newsletter_id TEXT NOT NULL,
       data          TEXT NOT NULL,
       valor         INTEGER NOT NULL,
       folha         TEXT,
       linha         INTEGER,
       importado_em  TEXT NOT NULL,
       PRIMARY KEY (newsletter_id, data)
     )`,
  );
  bd.exec(
    `CREATE TABLE IF NOT EXISTS controlo_importacoes (
       id           INTEGER PRIMARY KEY AUTOINCREMENT,
       importado_em TEXT NOT NULL,
       ficheiro     TEXT NOT NULL,
       quem         TEXT,
       marcas       INTEGER NOT NULL,
       alteradas    INTEGER NOT NULL,
       resumo       TEXT NOT NULL
     )`,
  );
  const colunasRegistos = bd.prepare(`PRAGMA table_info(registos)`).all() as { name: string }[];
  if (!colunasRegistos.some((c) => c.name === "fonte")) {
    bd.exec(`ALTER TABLE registos ADD COLUMN fonte TEXT DEFAULT NULL`);
  }

  // Avisos do cliente por email (avisos.ts): cada email de um remetente
  // autorizado (AVISOS_REMETENTES) e o que se propôs a partir dele. As
  // propostas nunca se aplicam sozinhas: alguém decide no painel (/avisos).
  bd.exec(
    `CREATE TABLE IF NOT EXISTS avisos (
       id             INTEGER PRIMARY KEY AUTOINCREMENT,
       email_id       INTEGER NOT NULL UNIQUE,
       remetente      TEXT NOT NULL,
       assunto        TEXT NOT NULL,
       recebido_em    TEXT NOT NULL,
       estado         TEXT NOT NULL DEFAULT 'pendente',
       tentativas     INTEGER NOT NULL DEFAULT 0,
       interpretado_em TEXT DEFAULT NULL,
       modelo         TEXT DEFAULT NULL,
       resumo         TEXT DEFAULT NULL,
       propostas      TEXT DEFAULT NULL,
       outros         TEXT DEFAULT NULL,
       erro           TEXT DEFAULT NULL,
       tratado_em     TEXT DEFAULT NULL,
       tratado_por    TEXT DEFAULT NULL
     )`,
  );
  // Dias em que uma newsletter não se espera (pausas.ts): anunciados pelo
  // cliente, criados no painel ou aplicados a partir de um aviso. Sem email
  // nesses dias, o registo é 6 e não "Não Saiu"; com email, conta como saída.
  bd.exec(
    `CREATE TABLE IF NOT EXISTS pausas (
       id            INTEGER PRIMARY KEY AUTOINCREMENT,
       newsletter_id TEXT NOT NULL,
       de            TEXT NOT NULL,
       ate           TEXT NOT NULL,
       motivo        TEXT NOT NULL,
       origem        TEXT NOT NULL,
       aviso_id      INTEGER DEFAULT NULL,
       criada_em     TEXT NOT NULL,
       criada_por    TEXT DEFAULT NULL,
       anulada_em    TEXT DEFAULT NULL,
       anulada_por   TEXT DEFAULT NULL
     )`,
  );
  bd.exec(`CREATE INDEX IF NOT EXISTS idx_pausas_nl ON pausas (newsletter_id, de, ate) WHERE anulada_em IS NULL`);

  ligacao = bd;
  versaoAplicada = -1;
  sincronizarRegras(bd);
  return bd;
}

export function fecharDb(): void {
  ligacao?.close();
  ligacao = null;
}
