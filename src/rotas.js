// Rotas da API. Toda rota (exceto /auth e /saude) exige JWT e só enxerga dados do próprio professor.
import express, { Router } from 'express';
import { ErroHttp } from './erros.js';
import * as v from './validacao.js';
import { gerarHashSenha, verificarSenhaOuFingir, emitirToken, autenticar, criarLimitadorLogin } from './seguranca.js';
import { lerAlunosDaPlanilha } from './importacao.js';
import { escreverBoletimTurma, escreverBoletimAluno } from './relatorios.js';

const LIMITE_PLANILHA = '2mb';
const slug = (s) => String(s).normalize('NFD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'arquivo';

export function criarRotas(repo, { segredoJwt, limitadorLogin = criarLimitadorLogin() }) {
  const r = Router();

  // ---------- Autenticação ----------
  r.post('/auth/registro', async (req, res) => {
    const corpo = v.objeto(req.body);
    const nome = v.texto(corpo.nome, 'nome', { min: 2 });
    const email = v.email(corpo.email);
    const senha = v.texto(corpo.senha, 'senha', { min: 8, max: 128 });
    const professor = repo.criarProfessor(nome, email, await gerarHashSenha(senha));
    res.status(201).json(professor);
  });

  r.post('/auth/login', async (req, res) => {
    limitadorLogin.verificar(req.ip);
    const corpo = v.objeto(req.body);
    const email = v.email(corpo.email);
    const senha = v.texto(corpo.senha, 'senha', { max: 128 });
    const professor = repo.professorPorEmail(email);
    if (!(await verificarSenhaOuFingir(senha, professor?.senha_hash))) {
      limitadorLogin.registrarFalha(req.ip);
      throw new ErroHttp(401, 'e-mail ou senha inválidos');
    }
    limitadorLogin.limpar(req.ip);
    res.json({ token: emitirToken(professor, segredoJwt), tipo: 'Bearer', expira_em: '8h' });
  });

  r.use(autenticar(segredoJwt));

  // Carrega a turma do professor logado ou responde 404 (não revela turmas de terceiros).
  const turmaDoProfessor = (req) => {
    const turma = repo.turma(v.id(req.params.id), req.professor.id);
    if (!turma) throw new ErroHttp(404, 'turma não encontrada');
    return turma;
  };

  // ---------- Turmas ----------
  r.get('/turmas', (req, res) => res.json(repo.listarTurmas(req.professor.id)));

  r.post('/turmas', (req, res) => {
    const c = v.objeto(req.body);
    const dados = {
      professor_id: req.professor.id,
      nome: v.texto(c.nome, 'nome'),
      disciplina: v.texto(c.disciplina, 'disciplina'),
      ano: v.inteiro(c.ano, 'ano', { min: 2000, max: 2100 }),
      media_aprovacao: v.numero(c.media_aprovacao, 'media_aprovacao', { min: 0, max: 10, padrao: 7 }),
      media_recuperacao: v.numero(c.media_recuperacao, 'media_recuperacao', { min: 0, max: 10, padrao: 5 }),
    };
    if (dados.media_recuperacao > dados.media_aprovacao) {
      throw new ErroHttp(400, '"media_recuperacao" não pode ser maior que "media_aprovacao"');
    }
    const turma = repo.criarTurma(dados);
    res.status(201).location(`/api/turmas/${turma.id}`).json(turma);
  });

  r.get('/turmas/:id', (req, res) => res.json(turmaDoProfessor(req)));

  // ---------- Alunos ----------
  r.get('/turmas/:id/alunos', (req, res) => res.json(repo.listarAlunos(turmaDoProfessor(req).id)));

  r.post('/turmas/:id/alunos', (req, res) => {
    const turma = turmaDoProfessor(req);
    const c = v.objeto(req.body);
    res.status(201).json(repo.criarAluno({
      turma_id: turma.id,
      matricula: v.texto(c.matricula, 'matricula', { max: 30 }),
      nome: v.texto(c.nome, 'nome'),
      email: v.email(c.email, 'email', { opcional: true }),
    }));
  });

  r.post('/turmas/:id/alunos/importar',
    express.raw({ type: 'application/octet-stream', limit: LIMITE_PLANILHA }),
    (req, res) => {
      const turma = turmaDoProfessor(req);
      if (!req.is('application/octet-stream')) {
        throw new ErroHttp(415, 'use Content-Type: application/octet-stream com o arquivo no corpo');
      }
      const { alunos, rejeitados } = lerAlunosDaPlanilha(req.body);
      const { inseridos, atualizados } = repo.importarAlunos(turma.id, alunos);
      res.json({ inseridos, atualizados, rejeitados });
    });

  // ---------- Avaliações e notas ----------
  r.get('/turmas/:id/avaliacoes', (req, res) => res.json(repo.listarAvaliacoes(turmaDoProfessor(req).id)));

  r.post('/turmas/:id/avaliacoes', (req, res) => {
    const turma = turmaDoProfessor(req);
    const c = v.objeto(req.body);
    res.status(201).json(repo.criarAvaliacao({
      turma_id: turma.id,
      titulo: v.texto(c.titulo, 'titulo', { max: 80 }),
      peso: v.numero(c.peso, 'peso', { min: 0.1, max: 100 }),
      data: v.data(c.data, 'data'),
    }));
  });

  r.put('/avaliacoes/:id/notas', (req, res) => {
    const avaliacao = repo.avaliacao(v.id(req.params.id), req.professor.id);
    if (!avaliacao) throw new ErroHttp(404, 'avaliação não encontrada');
    const { notas } = v.objeto(req.body);
    if (!Array.isArray(notas) || notas.length === 0 || notas.length > 500) {
      throw new ErroHttp(400, '"notas" deve ser uma lista com 1 a 500 itens');
    }
    const lote = notas.map((n, i) => ({
      aluno_id: v.inteiro(n?.aluno_id, `notas[${i}].aluno_id`, { min: 1 }),
      valor: Math.round(v.numero(n?.valor, `notas[${i}].valor`, { min: 0, max: 10 }) * 100) / 100,
    }));
    res.json({ avaliacao_id: avaliacao.id, lancadas: repo.lancarNotas(avaliacao.id, lote) });
  });

  // ---------- Médias e boletins ----------
  r.get('/turmas/:id/medias', (req, res) => {
    const turma = turmaDoProfessor(req);
    res.json({ turma, alunos: repo.mediasDaTurma(turma.id) });
  });

  r.get('/turmas/:id/boletim.xlsx', async (req, res) => {
    const turma = turmaDoProfessor(req);
    const dados = {
      turma,
      avaliacoes: repo.listarAvaliacoes(turma.id),
      medias: repo.mediasDaTurma(turma.id),
      notas: repo.notasDaTurma(turma.id),
    };
    res.attachment(`boletim-${slug(turma.nome)}-${turma.ano}.xlsx`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await escreverBoletimTurma(res, dados);
  });

  r.get('/alunos/:id/boletim.pdf', (req, res) => {
    const aluno = repo.aluno(v.id(req.params.id), req.professor.id);
    if (!aluno) throw new ErroHttp(404, 'aluno não encontrado');
    const turma = repo.turma(aluno.turma_id, req.professor.id);
    const dados = { turma, aluno, notas: repo.notasDoAluno(aluno.id, turma.id), resumo: repo.mediaDoAluno(aluno.id) };
    res.attachment(`boletim-${slug(aluno.matricula)}.pdf`);
    res.type('application/pdf');
    escreverBoletimAluno(res, dados);
  });

  return r;
}
