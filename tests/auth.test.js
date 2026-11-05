import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { iniciarServidor, SEGREDO } from './auxiliar.js';
import { gerarHashSenha, verificarSenha, criarLimitadorLogin } from '../src/seguranca.js';

let srv;
before(async () => { srv = await iniciarServidor({ limitadorLogin: criarLimitadorLogin({ maxFalhas: 3 }) }); });
after(() => srv.fechar());

test('scrypt: hash com salt aleatório e verificação em tempo constante', async () => {
  const h1 = await gerarHashSenha('minha-senha');
  const h2 = await gerarHashSenha('minha-senha');
  assert.match(h1, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(h1, h2, 'salts diferentes');
  assert.equal(await verificarSenha('minha-senha', h1), true);
  assert.equal(await verificarSenha('outra-senha', h1), false);
  assert.equal(await verificarSenha('x', 'formato-invalido'), false);
});

test('registro valida dados, não expõe hash e recusa e-mail duplicado', async () => {
  const ok = await srv.api('POST', '/auth/registro', { json: { nome: 'Helena', email: 'Helena@Escola.edu', senha: 'senha-forte-123' } });
  assert.equal(ok.status, 201);
  assert.deepEqual(Object.keys(ok.corpo).sort(), ['email', 'id', 'nome']);
  assert.equal(ok.corpo.email, 'helena@escola.edu');

  const dup = await srv.api('POST', '/auth/registro', { json: { nome: 'Outra', email: 'helena@escola.edu', senha: 'senha-forte-123' } });
  assert.equal(dup.status, 409);

  const curta = await srv.api('POST', '/auth/registro', { json: { nome: 'X', email: 'x@escola.edu', senha: '123' } });
  assert.equal(curta.status, 400);
});

test('login devolve JWT HS256 com sub e expiração', async () => {
  const { status, corpo } = await srv.api('POST', '/auth/login', { json: { email: 'helena@escola.edu', senha: 'senha-forte-123' } });
  assert.equal(status, 200);
  const dec = jwt.decode(corpo.token, { complete: true });
  assert.equal(dec.header.alg, 'HS256');
  assert.equal(dec.payload.nome, 'Helena');
  assert.ok(dec.payload.exp - dec.payload.iat === 8 * 3600);
});

test('rotas protegidas exigem token válido e com algoritmo HS256', async () => {
  assert.equal((await srv.api('GET', '/turmas')).status, 401);
  const semToken = await srv.api('GET', '/turmas');
  assert.equal(semToken.headers.get('www-authenticate'), 'Bearer');

  const hs512 = jwt.sign({ nome: 'x' }, SEGREDO, { algorithm: 'HS512', subject: '1', issuer: 'sistema-notas-alunos' });
  assert.equal((await srv.api('GET', '/turmas', { token: hs512 })).status, 401, 'outro algoritmo é recusado');

  const algNone = jwt.sign({ nome: 'x' }, null, { algorithm: 'none', subject: '1', issuer: 'sistema-notas-alunos' });
  assert.equal((await srv.api('GET', '/turmas', { token: algNone })).status, 401, 'alg none é recusado');

  const outroSegredo = jwt.sign({ nome: 'x' }, 'outro-segredo-qualquer-com-32-caracteres!!', { algorithm: 'HS256', subject: '1', issuer: 'sistema-notas-alunos' });
  assert.equal((await srv.api('GET', '/turmas', { token: outroSegredo })).status, 401);

  const expirado = jwt.sign({ nome: 'x', exp: Math.floor(Date.now() / 1000) - 10 }, SEGREDO, { algorithm: 'HS256', subject: '1', issuer: 'sistema-notas-alunos' });
  assert.equal((await srv.api('GET', '/turmas', { token: expirado })).status, 401);
});

test('login inválido responde 401 genérico e o limitador bloqueia após falhas', async () => {
  const errada = await srv.api('POST', '/auth/login', { json: { email: 'helena@escola.edu', senha: 'errada-123' } });
  assert.equal(errada.status, 401);
  assert.equal(errada.corpo.erro, 'e-mail ou senha inválidos');
  const inexistente = await srv.api('POST', '/auth/login', { json: { email: 'ninguem@escola.edu', senha: 'errada-123' } });
  assert.equal(inexistente.corpo.erro, errada.corpo.erro, 'não revela se o e-mail existe');

  await srv.api('POST', '/auth/login', { json: { email: 'helena@escola.edu', senha: 'errada-456' } });
  const bloqueado = await srv.api('POST', '/auth/login', { json: { email: 'helena@escola.edu', senha: 'senha-forte-123' } });
  assert.equal(bloqueado.status, 429);
});

test('erros gerais em JSON: 404, JSON malformado, corpo grande e x-powered-by', async () => {
  assert.equal((await srv.api('GET', '/nao-existe')).status, 401, 'sem token nem a existência da rota é revelada');
  const token = jwt.sign({ nome: 'x' }, SEGREDO, { algorithm: 'HS256', subject: '1', issuer: 'sistema-notas-alunos' });
  const r404 = await srv.api('GET', '/nao-existe', { token });
  assert.equal(r404.status, 404);
  assert.match(r404.corpo.erro, /rota não encontrada/);
  assert.equal(r404.headers.get('x-powered-by'), null);
  assert.equal(r404.headers.get('x-content-type-options'), 'nosniff');

  const malformado = await srv.api('POST', '/auth/registro', { corpo: '{"nome":', tipo: 'application/json' });
  assert.equal(malformado.status, 400);
  assert.equal(malformado.corpo.erro, 'JSON malformado');

  const grande = await srv.api('POST', '/auth/registro', { json: { nome: 'x'.repeat(200_000) } });
  assert.equal(grande.status, 413);
});

test('criarApp exige segredo com pelo menos 32 caracteres', async () => {
  const { criarApp } = await import('../src/app.js');
  assert.throws(() => criarApp({ db: srv.db, segredoJwt: 'curto' }), /32 caracteres/);
  assert.throws(() => criarApp({ db: srv.db, segredoJwt: undefined }), /32 caracteres/);
});
