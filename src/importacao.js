// Interpreta a planilha de alunos enviada no corpo da requisição (SheetJS). Função pura.
import * as XLSX from 'xlsx';
import { ErroHttp } from './erros.js';

export const MAX_LINHAS = 2000;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COLUNAS = {
  matricula: ['matricula', 'ra', 'registro'],
  nome: ['nome', 'aluno', 'nome completo'],
  email: ['email', 'e-mail'],
};

const chave = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const textoCelula = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

/** .xlsx/.xls são binários (ZIP "PK" ou OLE); qualquer outra coisa é tratada como CSV UTF-8. */
function abrirPasta(buffer) {
  const zip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const ole = buffer[0] === 0xd0 && buffer[1] === 0xcf;
  const opcoes = { cellFormula: false, cellHTML: false, sheetRows: MAX_LINHAS + 2 };
  try {
    return zip || ole
      ? XLSX.read(buffer, { ...opcoes, type: 'buffer' })
      : XLSX.read(buffer.toString('utf8').replace(/^﻿/, ''), { ...opcoes, type: 'string', raw: true });
  } catch {
    throw new ErroHttp(400, 'arquivo não é uma planilha válida (.xlsx, .xls ou .csv)');
  }
}

/** Devolve { alunos: [{ matricula, nome, email }], rejeitados: [{ linha, motivo }] }. */
export function lerAlunosDaPlanilha(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ErroHttp(400, 'envie a planilha no corpo com Content-Type: application/octet-stream');
  }
  const wb = abrirPasta(buffer);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matriz = ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null, blankrows: true }) : [];
  if (matriz.length > MAX_LINHAS + 1) throw new ErroHttp(413, `a planilha pode ter no máximo ${MAX_LINHAS} alunos`);

  const [cab = [], ...linhas] = matriz;
  const idx = {};
  for (const [campo, apelidos] of Object.entries(COLUNAS)) {
    const i = cab.findIndex((c) => apelidos.includes(chave(c)));
    if (i >= 0) idx[campo] = i;
  }
  if (idx.matricula === undefined || idx.nome === undefined) {
    throw new ErroHttp(400, 'a planilha precisa das colunas "Matrícula" e "Nome"');
  }

  const alunos = [];
  const rejeitados = [];
  const vistas = new Set();
  linhas.forEach((valores, i) => {
    const linha = i + 2;
    if (valores.every((v) => textoCelula(v) === '')) return;
    const matricula = textoCelula(valores[idx.matricula]);
    const nome = textoCelula(valores[idx.nome]);
    const email = idx.email !== undefined ? textoCelula(valores[idx.email]).toLowerCase() || null : null;

    let motivo = null;
    if (!matricula || matricula.length > 30) motivo = 'matrícula ausente ou com mais de 30 caracteres';
    else if (!nome || nome.length > 120) motivo = 'nome ausente ou com mais de 120 caracteres';
    else if (email && !RE_EMAIL.test(email)) motivo = `e-mail inválido: "${email}"`;
    else if (vistas.has(matricula)) motivo = `matrícula ${matricula} repetida na planilha`;
    if (motivo) { rejeitados.push({ linha, motivo }); return; }

    vistas.add(matricula);
    alunos.push({ matricula, nome, email });
  });
  return { alunos, rejeitados };
}
