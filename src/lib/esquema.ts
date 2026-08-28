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
  newsletter_id       TEXT             DEFAULT NULL
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
  -- Um registo por newsletter por dia. É o que garante a ausência de buracos
  -- e a ausência de duplicados na matriz.
  UNIQUE (newsletter_id, data_prevista)
);

CREATE INDEX IF NOT EXISTS idx_registos_data   ON registos (data_prevista);
CREATE INDEX IF NOT EXISTS idx_registos_abertos ON registos (fechado, hora_limite);

CREATE TABLE IF NOT EXISTS graph_token (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  refresh_token TEXT NOT NULL,
  expira_em     TEXT NOT NULL
);
`;
