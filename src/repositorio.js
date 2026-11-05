// Camada de dados: todos os statements são preparados uma única vez, na criação do repositório.
import { ErroHttp } from './erros.js';

/**
 * Média ponderada e situação calculadas no SQL.
 * Nota não lançada conta como 0; sem avaliações → média NULL e situação "sem_avaliacoes".
 */
const SQL_MEDIAS = (filtro) => `
  WITH medias AS (
    SELECT a.id AS aluno_id, a.turma_id, a.matricula, a.nome,
           COUNT(av.id) AS avaliacoes,
           COUNT(n.valor) AS notas_lancadas,
           ROUND(SUM(COALESCE(n.valor, 0) * av.peso) / SUM(av.peso), 2) AS media
      FROM alunos a
      LEFT JOIN avaliacoes av ON av.turma_id = a.turma_id
      LEFT JOIN notas n ON n.aluno_id = a.id AND n.avaliacao_id = av.id
     WHERE ${filtro}
     GROUP BY a.id
  )
  SELECT m.aluno_id, m.matricula, m.nome, m.avaliacoes, m.notas_lancadas, m.media,
         CASE
           WHEN m.media IS NULL THEN 'sem_avaliacoes'
           WHEN m.media >= t.media_aprovacao THEN 'aprovado'
           WHEN m.media >= t.media_recuperacao THEN 'recuperacao'
           ELSE 'reprovado'
         END AS situacao
    FROM medias m
    JOIN turmas t ON t.id = m.turma_id
   ORDER BY m.nome COLLATE NOCASE`;

export function criarRepositorio(db) {
  const s = {
    criarProfessor: db.prepare('INSERT INTO professores (nome, email, senha_hash) VALUES (?, ?, ?) RETURNING id, nome, email'),
    professorPorEmail: db.prepare('SELECT * FROM professores WHERE email = ?'),

    criarTurma: db.prepare(`INSERT INTO turmas (professor_id, nome, disciplina, ano, media_aprovacao, media_recuperacao)
      VALUES (@professor_id, @nome, @disciplina, @ano, @media_aprovacao, @media_recuperacao) RETURNING *`),
    listarTurmas: db.prepare(`SELECT t.*, (SELECT count(*) FROM alunos a WHERE a.turma_id = t.id) AS total_alunos
      FROM turmas t WHERE t.professor_id = ? ORDER BY t.ano DESC, t.nome`),
    turma: db.prepare('SELECT * FROM turmas WHERE id = ? AND professor_id = ?'),

    criarAluno: db.prepare('INSERT INTO alunos (turma_id, matricula, nome, email) VALUES (@turma_id, @matricula, @nome, @email) RETURNING *'),
    upsertAluno: db.prepare(`INSERT INTO alunos (turma_id, matricula, nome, email) VALUES (@turma_id, @matricula, @nome, @email)
      ON CONFLICT (turma_id, matricula) DO UPDATE SET nome = excluded.nome, email = excluded.email`),
    alunoExiste: db.prepare('SELECT 1 FROM alunos WHERE turma_id = ? AND matricula = ?').pluck(),
    listarAlunos: db.prepare('SELECT * FROM alunos WHERE turma_id = ? ORDER BY nome COLLATE NOCASE'),
    aluno: db.prepare(`SELECT a.* FROM alunos a JOIN turmas t ON t.id = a.turma_id
      WHERE a.id = ? AND t.professor_id = ?`),

    criarAvaliacao: db.prepare('INSERT INTO avaliacoes (turma_id, titulo, peso, data) VALUES (@turma_id, @titulo, @peso, @data) RETURNING *'),
    listarAvaliacoes: db.prepare('SELECT * FROM avaliacoes WHERE turma_id = ? ORDER BY data IS NULL, data, id'),
    avaliacao: db.prepare(`SELECT av.* FROM avaliacoes av JOIN turmas t ON t.id = av.turma_id
      WHERE av.id = ? AND t.professor_id = ?`),

    // Só grava se o aluno pertencer à mesma turma da avaliação (changes = 0 caso contrário).
    lancarNota: db.prepare(`INSERT INTO notas (aluno_id, avaliacao_id, valor)
      SELECT a.id, av.id, @valor FROM alunos a JOIN avaliacoes av ON av.turma_id = a.turma_id
       WHERE a.id = @aluno_id AND av.id = @avaliacao_id
      ON CONFLICT (aluno_id, avaliacao_id) DO UPDATE SET valor = excluded.valor, lancada_em = datetime('now')`),
    notasDaTurma: db.prepare(`SELECT n.aluno_id, n.avaliacao_id, n.valor FROM notas n
      JOIN avaliacoes av ON av.id = n.avaliacao_id WHERE av.turma_id = ?`),
    notasDoAluno: db.prepare(`SELECT av.id AS avaliacao_id, av.titulo, av.peso, av.data, n.valor
      FROM avaliacoes av LEFT JOIN notas n ON n.avaliacao_id = av.id AND n.aluno_id = @aluno_id
      WHERE av.turma_id = @turma_id ORDER BY av.data IS NULL, av.data, av.id`),

    mediasDaTurma: db.prepare(SQL_MEDIAS('a.turma_id = ?')),
    mediaDoAluno: db.prepare(SQL_MEDIAS('a.id = ?')),
  };

  const lancarNotas = db.transaction((avaliacaoId, notas) => {
    for (const { aluno_id, valor } of notas) {
      if (s.lancarNota.run({ aluno_id, avaliacao_id: avaliacaoId, valor }).changes === 0) {
        // Lançar dentro da transação desfaz todas as notas do lote.
        throw new ErroHttp(422, `aluno ${aluno_id} não pertence à turma desta avaliação`);
      }
    }
    return notas.length;
  });

  const importarAlunos = db.transaction((turmaId, alunos) => {
    let inseridos = 0;
    let atualizados = 0;
    for (const a of alunos) {
      if (s.alunoExiste.get(turmaId, a.matricula)) atualizados++; else inseridos++;
      s.upsertAluno.run({ turma_id: turmaId, ...a });
    }
    return { inseridos, atualizados };
  });

  return {
    criarProfessor: (nome, email, hash) => s.criarProfessor.get(nome, email, hash),
    professorPorEmail: (email) => s.professorPorEmail.get(email),

    criarTurma: (dados) => s.criarTurma.get(dados),
    listarTurmas: (professorId) => s.listarTurmas.all(professorId),
    turma: (id, professorId) => s.turma.get(id, professorId),

    criarAluno: (dados) => s.criarAluno.get(dados),
    listarAlunos: (turmaId) => s.listarAlunos.all(turmaId),
    aluno: (id, professorId) => s.aluno.get(id, professorId),
    importarAlunos,

    criarAvaliacao: (dados) => s.criarAvaliacao.get(dados),
    listarAvaliacoes: (turmaId) => s.listarAvaliacoes.all(turmaId),
    avaliacao: (id, professorId) => s.avaliacao.get(id, professorId),

    lancarNotas,
    notasDaTurma: (turmaId) => s.notasDaTurma.all(turmaId),
    notasDoAluno: (alunoId, turmaId) => s.notasDoAluno.all({ aluno_id: alunoId, turma_id: turmaId }),
    mediasDaTurma: (turmaId) => s.mediasDaTurma.all(turmaId),
    mediaDoAluno: (alunoId) => s.mediaDoAluno.get(alunoId),
  };
}
