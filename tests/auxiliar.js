// Utilitários dos testes: sobe a API em porta aleatória com banco em memória.
import { abrirBanco } from '../src/db.js';
import { criarApp } from '../src/app.js';

export const SEGREDO = 'segredo-de-teste-com-pelo-menos-32-caracteres!';

export async function iniciarServidor(opcoes = {}) {
  const db = abrirBanco(':memory:');
  const app = criarApp({ db, segredoJwt: SEGREDO, ...opcoes });
  const servidor = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}/api`;

  /** fetch com JSON e token opcionais; devolve { status, headers, corpo }. */
  async function api(metodo, caminho, { token, json, corpo, tipo } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (json !== undefined) headers['content-type'] = 'application/json';
    if (tipo) headers['content-type'] = tipo;
    const res = await fetch(base + caminho, {
      method: metodo, headers, body: json !== undefined ? JSON.stringify(json) : corpo,
    });
    const ct = res.headers.get('content-type') ?? '';
    const dados = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, corpo: dados };
  }

  async function fechar() {
    await new Promise((ok) => servidor.close(ok));
    db.close();
  }

  return { api, fechar, db, base };
}

/** Registra um professor e devolve o token. */
export async function loginProfessor(api, email = 'prof@escola.edu', senha = 'senha-forte-123') {
  await api('POST', '/auth/registro', { json: { nome: 'Profa. Helena', email, senha } });
  const { corpo } = await api('POST', '/auth/login', { json: { email, senha } });
  return corpo.token;
}
