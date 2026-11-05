// Abertura do SQLite e criação do esquema.
import Database from 'better-sqlite3';

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS professores (
  id         INTEGER PRIMARY KEY,
  nome       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS turmas (
  id                INTEGER PRIMARY KEY,
  professor_id      INTEGER NOT NULL REFERENCES professores (id) ON DELETE CASCADE,
  nome              TEXT NOT NULL,
  disciplina        TEXT NOT NULL,
  ano               INTEGER NOT NULL,
  media_aprovacao   REAL NOT NULL DEFAULT 7 CHECK (media_aprovacao BETWEEN 0 AND 10),
  media_recuperacao REAL NOT NULL DEFAULT 5 CHECK (media_recuperacao BETWEEN 0 AND 10),
  CHECK (media_recuperacao <= media_aprovacao),
  UNIQUE (professor_id, nome, disciplina, ano)
);

CREATE TABLE IF NOT EXISTS alunos (
  id        INTEGER PRIMARY KEY,
  turma_id  INTEGER NOT NULL REFERENCES turmas (id) ON DELETE CASCADE,
  matricula TEXT NOT NULL,
  nome      TEXT NOT NULL,
  email     TEXT,
  UNIQUE (turma_id, matricula)
);

CREATE TABLE IF NOT EXISTS avaliacoes (
  id       INTEGER PRIMARY KEY,
  turma_id INTEGER NOT NULL REFERENCES turmas (id) ON DELETE CASCADE,
  titulo   TEXT NOT NULL,
  peso     REAL NOT NULL CHECK (peso > 0 AND peso <= 100),
  data     TEXT,
  UNIQUE (turma_id, titulo)
);

CREATE TABLE IF NOT EXISTS notas (
  aluno_id     INTEGER NOT NULL REFERENCES alunos (id) ON DELETE CASCADE,
  avaliacao_id INTEGER NOT NULL REFERENCES avaliacoes (id) ON DELETE CASCADE,
  valor        REAL NOT NULL CHECK (valor BETWEEN 0 AND 10),
  lancada_em   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (aluno_id, avaliacao_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_turmas_professor ON turmas (professor_id);
CREATE INDEX IF NOT EXISTS idx_notas_avaliacao ON notas (avaliacao_id);
`;

export function abrirBanco(caminho = ':memory:') {
  const db = new Database(caminho);
  if (caminho !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.exec(ESQUEMA);
  return db;
}
