// Gera saidas/alunos-exemplo.xlsx para testar a importação de alunos.
// Uso: npm run exemplo
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';

XLSX.set_fs(fs);

export const ALUNOS_EXEMPLO = [
  ['Matrícula', 'Nome', 'E-mail'],
  ['2026001', 'Ana Beatriz Souza', 'ana@exemplo.com'],
  ['2026002', 'Bruno Carvalho', 'BRUNO@EXEMPLO.COM'],
  ['2026003', 'Carla Mendes', ''],
  ['2026004', '  Diego   Ramos ', 'diego@exemplo.com'],
  ['', 'Sem Matrícula', 'sem@exemplo.com'],
  ['2026005', 'Eduarda Lima', 'eduarda(arroba)exemplo.com'],
  ['2026001', 'Ana Repetida', 'ana2@exemplo.com'],
];

/** Monta a planilha em memória (Buffer .xlsx). */
export function planilhaExemplo(linhas = ALUNOS_EXEMPLO) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), 'Alunos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const destino = path.join(raiz, 'saidas', 'alunos-exemplo.xlsx');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, planilhaExemplo());
  console.log(`Planilha de exemplo: ${path.relative(raiz, destino)}`);
}
