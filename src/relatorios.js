// Boletim da turma em Excel (ExcelJS, escrita em stream) e boletim do aluno em PDF (PDFKit).
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export const ROTULO_SITUACAO = {
  aprovado: 'Aprovado',
  recuperacao: 'Recuperação',
  reprovado: 'Reprovado',
  sem_avaliacoes: 'Sem avaliações',
};
const COR_SITUACAO = { aprovado: '1E7B34', recuperacao: 'B7791F', reprovado: 'B42318', sem_avaliacoes: '6B7280' };

/**
 * Escreve o boletim da turma (.xlsx) diretamente no stream de saída.
 * dados: { turma, avaliacoes, medias, notas: [{ aluno_id, avaliacao_id, valor }] }
 */
export async function escreverBoletimTurma(stream, { turma, avaliacoes, medias, notas }) {
  const nota = new Map(notas.map((n) => [`${n.aluno_id}:${n.avaliacao_id}`, n.valor]));
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
  wb.creator = 'sistema-notas-alunos';
  wb.created = new Date();

  const ws = wb.addWorksheet('Boletim', { views: [{ state: 'frozen', ySplit: 4, xSplit: 2 }] });
  ws.columns = [
    { key: 'matricula', width: 14 },
    { key: 'nome', width: 34 },
    ...avaliacoes.map((av) => ({ key: `av${av.id}`, width: 14, style: { numFmt: '0.00' } })),
    { key: 'media', width: 10, style: { numFmt: '0.00' } },
    { key: 'situacao', width: 16 },
  ];
  const totalColunas = avaliacoes.length + 4;

  const titulo = ws.addRow([`Boletim — ${turma.nome} · ${turma.disciplina} · ${turma.ano}`]);
  titulo.font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, totalColunas);
  titulo.commit();
  ws.addRow([`Aprovação: média ≥ ${turma.media_aprovacao} · Recuperação: média ≥ ${turma.media_recuperacao}`]).commit();
  ws.addRow([]).commit();

  const cab = ws.addRow(['Matrícula', 'Nome', ...avaliacoes.map((av) => `${av.titulo} (peso ${av.peso})`), 'Média', 'Situação']);
  cab.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  cab.commit();

  for (const m of medias) {
    const linha = ws.addRow([
      m.matricula,
      m.nome,
      ...avaliacoes.map((av) => nota.get(`${m.aluno_id}:${av.id}`) ?? null),
      m.media,
      ROTULO_SITUACAO[m.situacao],
    ]);
    const cel = linha.getCell(totalColunas);
    cel.font = { bold: true, color: { argb: `FF${COR_SITUACAO[m.situacao]}` } };
    linha.commit();
  }
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + medias.length, column: totalColunas } };
  ws.commit();

  const resumo = wb.addWorksheet('Resumo');
  resumo.columns = [{ width: 22 }, { width: 12 }];
  const comMedia = medias.filter((m) => m.media !== null);
  const mediaTurma = comMedia.length ? comMedia.reduce((s, m) => s + m.media, 0) / comMedia.length : null;
  const linhasResumo = [
    ['Alunos', medias.length],
    ...Object.entries(ROTULO_SITUACAO).map(([k, rotulo]) => [rotulo, medias.filter((m) => m.situacao === k).length]),
    ['Média da turma', mediaTurma === null ? null : Math.round(mediaTurma * 100) / 100],
  ];
  for (const r of linhasResumo) {
    const row = resumo.addRow(r);
    row.getCell(1).font = { bold: true };
    row.commit();
  }
  resumo.commit();
  await wb.commit();
}

const fmt = (n) => (n === null || n === undefined ? '—' : n.toFixed(2).replace('.', ','));
const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');

/**
 * Gera o boletim individual em PDF (A4 retrato) e faz pipe para o stream.
 * dados: { turma, aluno, notas: [{ titulo, peso, data, valor }], resumo: { media, situacao, ... } }
 */
export function escreverBoletimAluno(stream, { turma, aluno, notas, resumo }) {
  const doc = new PDFDocument({
    size: 'A4', margin: 50,
    info: { Title: `Boletim - ${aluno.nome}`, Subject: `${turma.disciplina} ${turma.ano}`, Creator: 'sistema-notas-alunos' },
  });
  doc.pipe(stream);
  const largura = doc.page.width - 100;

  doc.rect(0, 0, doc.page.width, 90).fill('#1F3A5F');
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(22).text('Boletim do aluno', 50, 30);
  doc.font('Helvetica').fontSize(11).text(`${turma.disciplina} · ${turma.nome} · ${turma.ano}`, 50, 58);

  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(14).text(aluno.nome, 50, 115);
  doc.font('Helvetica').fontSize(10).fillColor('#555555')
    .text(`Matrícula: ${aluno.matricula}${aluno.email ? `   ·   ${aluno.email}` : ''}`);

  // Tabela de notas.
  const col = [50, 290, 360, 450];
  let y = 170;
  doc.rect(50, y - 6, largura, 22).fill('#E8EDF3');
  doc.fillColor('#1F3A5F').font('Helvetica-Bold').fontSize(10);
  ['Avaliação', 'Peso', 'Data', 'Nota'].forEach((t, i) => doc.text(t, col[i] + 6, y));
  y += 24;
  doc.font('Helvetica').fillColor('#111111');
  for (const n of notas) {
    if (y > doc.page.height - 160) { doc.addPage(); y = 60; }
    doc.text(n.titulo, col[0] + 6, y, { width: 230, ellipsis: true, lineBreak: false });
    doc.text(fmt(n.peso).replace(',00', ''), col[1] + 6, y);
    doc.text(fmtData(n.data), col[2] + 6, y);
    doc.text(n.valor === null ? 'não lançada' : fmt(n.valor), col[3] + 6, y);
    y += 20;
    doc.moveTo(50, y - 6).lineTo(50 + largura, y - 6).lineWidth(0.5).strokeColor('#D0D5DD').stroke();
  }
  if (notas.length === 0) { doc.fillColor('#555555').text('Nenhuma avaliação cadastrada.', 56, y); y += 20; }

  y += 16;
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(12)
    .text(`Média ponderada: ${fmt(resumo.media)}`, 50, y);
  doc.fillColor(`#${COR_SITUACAO[resumo.situacao]}`)
    .text(`Situação: ${ROTULO_SITUACAO[resumo.situacao]}`, 50, y + 20);
  doc.fillColor('#555555').font('Helvetica').fontSize(9)
    // Helvetica padrão usa WinAnsi (sem "≥"), por isso o texto por extenso.
    .text(`Critérios: aprovado com média a partir de ${fmt(turma.media_aprovacao)}; `
      + `recuperação a partir de ${fmt(turma.media_recuperacao)}. `
      + 'Avaliações sem nota lançada contam como zero.', 50, y + 46, { width: largura });

  doc.fontSize(8).text(`Emitido em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
    50, doc.page.height - 70, { width: largura, align: 'right', lineBreak: false });
  doc.end();
  return doc;
}
