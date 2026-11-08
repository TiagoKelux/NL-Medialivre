/**
 * O esquema vive dentro do modulo, e nao num .sql lido do disco: quando o Next
 * empacota o servidor, o caminho relativo ao ficheiro deixa de existir.
 */
export const ESQUEMA = String.raw`
-- Media Livre — Monitor de Newsletters (§5 da spec).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS emails (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Deduplicação: o mesmo email entregue duas vezes pelo servidor traz o mesmo
  -- internetMessageId e é rejeitado aqui, sem chegar a contar como ocorrência.
  internet_message_id TEXT    NOT NULL UNIQUE,
  remetente           TEXT    NOT NULL DEFAULT '',
  assunto             TEXT    NOT NULL DEFAULT '',
  recebido_em         TEXT    NOT NULL,
  corpo_html          TEXT    NOT NULL DEFAULT '',
  corpo_normalizado   TEXT    NOT NULL DEFAULT '',
  hash_conteudo       TEXT    NOT NULL DEFAULT '',
  newsletter_id       TEXT             DEFAULT NULL,
  -- JSON com o que a identificação precisa do corpo, extraído à entrada
  -- (marcas.ts). Em bases antigas é acrescentada pelo db.ts.
  marcas              TEXT             DEFAULT NULL,
  -- Abertura (abertura.ts): quando o pixel do SES respondeu, quantas vezes
  -- falhou (-1 sem pixel, -2 anterior a este registo) e a última tentativa.
  -- Em bases antigas são acrescentadas pelo db.ts.
  aberto_em           TEXT             DEFAULT NULL,
  abertura_falhas     INTEGER NOT NULL DEFAULT 0,
  abertura_tentada_em TEXT             DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_emails_newsletter ON emails (newsletter_id, recebido_em);
CREATE INDEX IF NOT EXISTS idx_emails_recebido   ON emails (recebido_em);

CREATE TABLE IF NOT EXISTS registos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  newsletter_id  TEXT    NOT NULL,
  data_prevista  TEXT    NOT NULL,
  hora_limite    TEXT    NOT NULL,
  hora_recebida  TEXT             DEFAULT NULL,
  atraso_minutos INTEGER          DEFAULT NULL,
  -- Critério 6: é impossível gravar um valor que não seja 1 a 6.
  codigo_estado  INTEGER NOT NULL CHECK (codigo_estado BETWEEN 1 AND 6),
  nr_ocorrencias INTEGER NOT NULL DEFAULT 0,
  detalhe        TEXT    NOT NULL DEFAULT '',
  fechado        INTEGER NOT NULL DEFAULT 0 CHECK (fechado IN (0, 1)),
  -- Ressalva ao código, sem o mudar (ver tipos.ts). Em bases antigas é
  -- acrescentada pelo db.ts.
  ressalva       TEXT             DEFAULT NULL CHECK (ressalva IN ('sem-prova', 'sem-comparacao')),
  -- O calendário da newsletter nesse dia, em JSON: congela quando o dia passa
  -- (registos.ts, newsletterNoDia). Em bases antigas é acrescentada pelo db.ts.
  calendario     TEXT             DEFAULT NULL,
  -- Um registo por newsletter por dia. É o que garante a ausência de buracos
  -- e a ausência de duplicados na matriz.
  UNIQUE (newsletter_id, data_prevista)
);

CREATE INDEX IF NOT EXISTS idx_registos_data   ON registos (data_prevista);
CREATE INDEX IF NOT EXISTS idx_registos_abertos ON registos (fechado, hora_limite);

-- Pares chave/valor do funcionamento: a última leitura da caixa que correu
-- bem e a última que falhou, para o painel avisar quando deixa de ler.
CREATE TABLE IF NOT EXISTS estado (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Regras de reconhecimento guardadas no painel ("Por classificar"). Somam-se
-- ao config/newsletters.ts ao carregar (regras-fusao.ts): o ficheiro continua
-- a ser a base, gerada do Excel, e a aplicação nunca o escreve.
CREATE TABLE IF NOT EXISTS regras_newsletter (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  newsletter_id TEXT NOT NULL,
  remetente     TEXT NOT NULL,
  marca_corpo   TEXT NOT NULL CHECK (length(marca_corpo) >= 10),
  criado_em     TEXT NOT NULL,
  UNIQUE (newsletter_id, remetente, marca_corpo)
);

-- Emails marcados no painel como "não é newsletter": só os tira da lista
-- "por classificar". Por assunto (normalizado) ou por mensagem exata.
CREATE TABLE IF NOT EXISTS exclusoes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo      TEXT NOT NULL CHECK (tipo IN ('assunto', 'mensagem')),
  valor     TEXT NOT NULL,
  rotulo    TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL,
  UNIQUE (tipo, valor)
);

-- Registo de cada alteração feita no painel: quando, quem (se o proxy o
-- disser) e o quê.
CREATE TABLE IF NOT EXISTS alteracoes (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  em      TEXT NOT NULL,
  quem    TEXT          DEFAULT NULL,
  acao    TEXT NOT NULL,
  detalhe TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS graph_token (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  refresh_token TEXT NOT NULL,
  expira_em     TEXT NOT NULL
);
`;
