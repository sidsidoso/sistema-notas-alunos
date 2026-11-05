// Validadores simples de entrada; lançam ErroHttp 400 com mensagem clara.
import { ErroHttp } from './erros.js';

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

const invalido = (msg) => new ErroHttp(400, msg);

export function objeto(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw invalido('corpo JSON (objeto) obrigatório');
  return corpo;
}

export function texto(valor, campo, { min = 1, max = 120, opcional = false } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (opcional) return null;
    throw invalido(`"${campo}" é obrigatório`);
  }
  if (typeof valor !== 'string') throw invalido(`"${campo}" deve ser texto`);
  const t = valor.trim();
  if (t.length < min || t.length > max) throw invalido(`"${campo}" deve ter entre ${min} e ${max} caracteres`);
  return t;
}

export function email(valor, campo = 'email', { opcional = false } = {}) {
  const e = texto(valor, campo, { max: 254, opcional });
  if (e === null) return null;
  if (!RE_EMAIL.test(e)) throw invalido(`"${campo}" inválido`);
  return e.toLowerCase();
}

export function numero(valor, campo, { min = -Infinity, max = Infinity, opcional = false, padrao } = {}) {
  if (valor === undefined || valor === null) {
    if (padrao !== undefined) return padrao;
    if (opcional) return null;
    throw invalido(`"${campo}" é obrigatório`);
  }
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < min || valor > max) {
    throw invalido(`"${campo}" deve ser um número entre ${min} e ${max}`);
  }
  return valor;
}

export function inteiro(valor, campo, opcoes) {
  const n = numero(valor, campo, opcoes);
  if (n !== null && !Number.isInteger(n)) throw invalido(`"${campo}" deve ser inteiro`);
  return n;
}

export function data(valor, campo, { opcional = true } = {}) {
  const d = texto(valor, campo, { max: 10, opcional });
  if (d === null) return null;
  const dt = new Date(`${d}T00:00:00Z`);
  if (!RE_DATA.test(d) || Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== d) {
    throw invalido(`"${campo}" deve estar no formato AAAA-MM-DD`);
  }
  return d;
}

/** Parâmetro de rota numérico (ex.: /turmas/:id). */
export function id(valor, campo = 'id') {
  if (!/^[1-9]\d{0,9}$/.test(String(valor))) throw invalido(`"${campo}" inválido`);
  return Number(valor);
}
