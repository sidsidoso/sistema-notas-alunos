import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { iniciarServidor, loginProfessor } from './auxiliar.js';

let srv;
let token;
let turma;
const alunos = {};
const avs = {};

before(async () => {
  srv = await iniciarServidor();
  token = await loginProfessor(srv.api);
});
after(() => srv.fechar());

const api = (metodo, caminho, opcoes = {}) => srv.api(metodo, caminho, { token, ...opcoes });

test('cadastra turma, alunos e avaliações', async () => {
  const t = await api('POST', '/turmas', { json: { nome: '3º A', disciplina: 'Matemática', ano: 2026 } });
  assert.equal(t.status, 201);
  assert.equal(t.headers.get('location'), `/api/turmas/${t.corpo.id}`);
  assert.equal(t.corpo.media_aprovacao, 7);
  assert.equal(t.corpo.media_recuperacao, 5);
  turma = t.corpo;

  for (const [chave, matricula, nome] of [['ana', '1', 'Ana'], ['bruno', '2', 'Bruno'], ['carla', '3', 'Carla']]) {
    const r = await api('POST', `/turmas/${turma.id}/alunos`, { json: { matricula, nome } });
    assert.equal(r.status, 201);
    alunos[chave] = r.corpo;
  }
  assert.equal((await api('POST', `/turmas/${turma.id}/alunos`, { json: { matricula: '1', nome: 'Dup' } })).status, 409);

  for (const [chave, titulo, peso, data] of [['p1', 'Prova 1', 1, '2026-04-10'], ['p2', 'Prova 2', 2, '2026-06-20']]) {
    const r = await api('POST', `/turmas/${turma.id}/avaliacoes`, { json: { titulo, peso, data } });
    assert.equal(r.status, 201);
    avs[chave] = r.corpo;
  }

  const lista = await api('GET', '/turmas');
  assert.equal(lista.corpo[0].total_alunos, 3);
});

test('validação de entrada nas rotas', async () => {
  assert.equal((await api('POST', '/turmas', { json: { nome: 'X', disciplina: 'Y', ano: 1990 } })).status, 400);
  assert.equal((await api('POST', '/turmas', { json: { nome: 'X', disciplina: 'Y', ano: 2026, media_aprovacao: 5, media_recuperacao: 6 } })).status, 400);
  assert.equal((await api('POST', `/turmas/${turma.id}/avaliacoes`, { json: { titulo: 'P3', peso: 0 } })).status, 400);
  assert.equal((await api('POST', `/turmas/${turma.id}/avaliacoes`, { json: { titulo: 'P3', peso: 1, data: '2026-02-30' } })).status, 400);
  assert.equal((await api('GET', '/turmas/abc')).status, 400);
  assert.equal((await api('GET', '/turmas/999')).status, 404);
});

test('lança notas em lote e calcula média ponderada e situação no SQL', async () => {
  const r1 = await api('PUT', `/avaliacoes/${avs.p1.id}/notas`, {
    json: { notas: [{ aluno_id: alunos.ana.id, valor: 8 }, { aluno_id: alunos.bruno.id, valor: 5 }, { aluno_id: alunos.carla.id, valor: 2 }] },
  });
  assert.deepEqual(r1.corpo, { avaliacao_id: avs.p1.id, lancadas: 3 });
  await api('PUT', `/avaliacoes/${avs.p2.id}/notas`, {
    json: { notas: [{ aluno_id: alunos.ana.id, valor: 7 }, { aluno_id: alunos.bruno.id, valor: 5 }] },
  });
  // Relançar atualiza (ON CONFLICT DO UPDATE).
  await api('PUT', `/avaliacoes/${avs.p2.id}/notas`, { json: { notas: [{ aluno_id: alunos.ana.id, valor: 7 }] } });

  const { corpo } = await api('GET', `/turmas/${turma.id}/medias`);
  const porNome = Object.fromEntries(corpo.alunos.map((a) => [a.nome, a]));
  // Ana: (8*1 + 7*2) / 3 = 7,33 | Bruno: 5 | Carla: (2*1 + 0*2) / 3 = 0,67 (nota não lançada = 0)
  assert.deepEqual([porNome.Ana.media, porNome.Ana.situacao], [7.33, 'aprovado']);
  assert.deepEqual([porNome.Bruno.media, porNome.Bruno.situacao], [5, 'recuperacao']);
  assert.deepEqual([porNome.Carla.media, porNome.Carla.situacao, porNome.Carla.notas_lancadas], [0.67, 'reprovado', 1]);
});

test('lote de notas é atômico e valida aluno, valor e posse', async () => {
  const outra = await api('POST', '/turmas', { json: { nome: '3º B', disciplina: 'Matemática', ano: 2026 } });
  const intruso = await api('POST', `/turmas/${outra.corpo.id}/alunos`, { json: { matricula: '9', nome: 'Intruso' } });

  const r = await api('PUT', `/avaliacoes/${avs.p2.id}/notas`, {
    json: { notas: [{ aluno_id: alunos.carla.id, valor: 10 }, { aluno_id: intruso.corpo.id, valor: 10 }] },
  });
  assert.equal(r.status, 422);
  const { corpo } = await api('GET', `/turmas/${turma.id}/medias`);
  assert.equal(corpo.alunos.find((a) => a.nome === 'Carla').notas_lancadas, 1, 'nota da Carla não foi gravada');

  assert.equal((await api('PUT', `/avaliacoes/${avs.p2.id}/notas`, { json: { notas: [{ aluno_id: alunos.ana.id, valor: 10.5 }] } })).status, 400);
  assert.equal((await api('PUT', `/avaliacoes/${avs.p2.id}/notas`, { json: { notas: [] } })).status, 400);

  // Outro professor não enxerga a turma nem lança notas nela.
  const token2 = await (await import('./auxiliar.js')).loginProfessor(srv.api, 'outro@escola.edu');
  assert.equal((await srv.api('GET', `/turmas/${turma.id}`, { token: token2 })).status, 404);
  assert.equal((await srv.api('PUT', `/avaliacoes/${avs.p1.id}/notas`, { token: token2, json: { notas: [{ aluno_id: alunos.ana.id, valor: 0 }] } })).status, 404);
  assert.equal((await srv.api('GET', `/alunos/${alunos.ana.id}/boletim.pdf`, { token: token2 })).status, 404);
});

test('boletim da turma em Excel: reabre o arquivo e confere os valores', async () => {
  const r = await api('GET', `/turmas/${turma.id}/boletim.xlsx`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /spreadsheetml/);
  assert.match(r.headers.get('content-disposition'), /boletim-3-A-2026\.xlsx/);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.corpo);
  const ws = wb.getWorksheet('Boletim');
  assert.equal(ws.getCell('A1').value, 'Boletim — 3º A · Matemática · 2026');
  assert.deepEqual(ws.getRow(4).values.slice(1), ['Matrícula', 'Nome', 'Prova 1 (peso 1)', 'Prova 2 (peso 2)', 'Média', 'Situação']);
  assert.deepEqual(ws.getRow(5).values.slice(1), ['1', 'Ana', 8, 7, 7.33, 'Aprovado']);
  assert.deepEqual(ws.getRow(6).values.slice(1), ['2', 'Bruno', 5, 5, 5, 'Recuperação']);
  const carla = ws.getRow(7);
  assert.equal(carla.getCell(4).value, null, 'nota não lançada fica em branco');
  assert.equal(carla.getCell(6).value, 'Reprovado');
  assert.equal(ws.getCell('E5').numFmt, '0.00');

  const resumo = wb.getWorksheet('Resumo');
  assert.deepEqual(resumo.getRow(1).values.slice(1), ['Alunos', 3]);
  assert.deepEqual(resumo.getRow(2).values.slice(1), ['Aprovado', 1]);
  assert.deepEqual(resumo.getRow(6).values.slice(1), ['Média da turma', 4.33]);
});

test('boletim individual em PDF: assinatura %PDF- e uma página', async () => {
  const r = await api('GET', `/alunos/${alunos.ana.id}/boletim.pdf`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(r.corpo.subarray(0, 5).toString(), '%PDF-');
  const paginas = r.corpo.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? [];
  assert.equal(paginas.length, 1);
  assert.equal((await api('GET', '/alunos/9999/boletim.pdf')).status, 404);
});
