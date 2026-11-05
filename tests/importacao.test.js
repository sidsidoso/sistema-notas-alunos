import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidor, loginProfessor } from './auxiliar.js';
import { lerAlunosDaPlanilha } from '../src/importacao.js';
import { planilhaExemplo } from '../scripts/gerar-exemplo.js';

let srv;
let token;
let turmaId;
before(async () => {
  srv = await iniciarServidor();
  token = await loginProfessor(srv.api);
  const t = await srv.api('POST', '/turmas', { token, json: { nome: '1º C', disciplina: 'Física', ano: 2026 } });
  turmaId = t.corpo.id;
});
after(() => srv.fechar());

const importar = (corpo, tipo = 'application/octet-stream') =>
  srv.api('POST', `/turmas/${turmaId}/alunos/importar`, { token, corpo, tipo });

test('lerAlunosDaPlanilha normaliza e rejeita linhas inválidas (função pura)', () => {
  const { alunos, rejeitados } = lerAlunosDaPlanilha(planilhaExemplo());
  assert.deepEqual(alunos.map((a) => a.matricula), ['2026001', '2026002', '2026003', '2026004']);
  assert.equal(alunos[1].email, 'bruno@exemplo.com');
  assert.equal(alunos[2].email, null);
  assert.equal(alunos[3].nome, 'Diego Ramos');
  assert.deepEqual(rejeitados, [
    { linha: 6, motivo: 'matrícula ausente ou com mais de 30 caracteres' },
    { linha: 7, motivo: 'e-mail inválido: "eduarda(arroba)exemplo.com"' },
    { linha: 8, motivo: 'matrícula 2026001 repetida na planilha' },
  ]);
  assert.throws(() => lerAlunosDaPlanilha(planilhaExemplo([['RA', 'Curso']])), /colunas "Matrícula" e "Nome"/);
});

test('importa .xlsx via application/octet-stream e faz upsert por matrícula', async () => {
  const r = await importar(planilhaExemplo());
  assert.equal(r.status, 200);
  assert.equal(r.corpo.inseridos, 4);
  assert.equal(r.corpo.atualizados, 0);
  assert.equal(r.corpo.rejeitados.length, 3);

  const csv = Buffer.from('﻿Matrícula,Nome,E-mail\n2026001,Ana Beatriz Souza Lima,ana@exemplo.com\n2026010,Lúcia Ávila,\n');
  const r2 = await importar(csv);
  assert.deepEqual([r2.corpo.inseridos, r2.corpo.atualizados], [1, 1]);

  const { corpo: lista } = await srv.api('GET', `/turmas/${turmaId}/alunos`, { token });
  assert.equal(lista.length, 5);
  assert.ok(lista.some((a) => a.nome === 'Ana Beatriz Souza Lima'));
  assert.ok(lista.some((a) => a.nome === 'Lúcia Ávila'), 'CSV UTF-8 mantém acentos');
});

test('importação recusa tipo errado, corpo vazio, arquivo corrompido e corpo acima de 2 MB', async () => {
  assert.equal((await importar(planilhaExemplo(), 'text/plain')).status, 415);
  assert.equal((await importar(Buffer.alloc(0))).status, 400);
  assert.equal((await importar(Buffer.from('PK\u0003\u0004 lixo'))).status, 400);
  const grande = await importar(Buffer.alloc(2 * 1024 * 1024 + 1, 0x41));
  assert.equal(grande.status, 413);
  assert.match(grande.corpo.erro, /excede o limite/);
});
