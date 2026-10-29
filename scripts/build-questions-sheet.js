/**
 * Builds a questions sheet ready for upload (same columns as templates/questions-template.xlsx)
 * from a JSON file of extracted questions:
 *   node scripts/build-questions-sheet.js questions.json out.xlsx
 *
 * JSON: { "defaults": { subject, lesson, lesson_type, category, exam_year }, "questions": [ {
 *   question, A, B, C, D, answer,              // answer: أ/ب/ج/د (or A-D); leave "" when unknown
 *   explanation, law, subject, lesson, lesson_type, category, exam_year,
 *   passage_no, passage,                       // same passage_no = one shared passage (text written once is enough)
 *   images: { question, A, B, C, D, explanation, passage }   // paths to PNG/JPG files, relative to the JSON file
 * } ] }
 * The column headers are read from the template itself, so the sheet always matches what the platform expects.
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const [input, out] = process.argv.slice(2);
if (!input || !out) {
  console.error('usage: node scripts/build-questions-sheet.js questions.json out.xlsx');
  process.exit(1);
}
const TEMPLATE = path.join(__dirname, '../templates/questions-template.xlsx');

// JSON field → template header
const FIELD_HEADER = {
  question: 'السؤال', A: 'أ', B: 'ب', C: 'ج', D: 'د', answer: 'الإجابة الصحيحة', explanation: 'الشرح',
  law: 'القانون/الملحوظة', subject: 'المادة', lesson: 'الدرس', lesson_type: 'نوع الدرس', category: 'التصنيف',
  exam_year: 'سنة الامتحان', passage_no: 'رقم القطعة', passage: 'القطعة',
};
const IMAGE_HEADER = { question: 'صورة السؤال', A: 'أ', B: 'ب', C: 'ج', D: 'د', explanation: 'الشرح', passage: 'صورة القطعة' };

(async () => {
  const data = JSON.parse(fs.readFileSync(input, 'utf8'));
  const baseDir = path.dirname(path.resolve(input));
  const defaults = data.defaults || {};

  const tpl = new ExcelJS.Workbook();
  await tpl.xlsx.readFile(TEMPLATE);
  const tws = tpl.worksheets[0];
  const headers = [];
  tws.getRow(1).eachCell((c, col) => { headers[col - 1] = { name: String(c.value), width: tws.getColumn(col).width }; });
  const COL = Object.fromEntries(headers.map((h, i) => [h.name, i]));
  for (const h of [...Object.values(FIELD_HEADER), ...Object.values(IMAGE_HEADER)]) {
    if (!(h in COL)) throw new Error(`template has no column "${h}"`);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الأسئلة', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = headers.map((h) => ({ header: h.name, width: h.width }));
  ws.getRow(1).font = { bold: true };
  ws.getColumn(COL['القطعة'] + 1).alignment = { wrapText: true, vertical: 'top' };

  let images = 0;
  data.questions.forEach((q, i) => {
    const values = new Array(headers.length).fill('');
    for (const [field, header] of Object.entries(FIELD_HEADER)) {
      const v = q[field] ?? defaults[field];
      if (v !== undefined && v !== null) values[COL[header]] = String(v);
    }
    const row = ws.addRow(values);
    const rowNo = i + 2;
    const pics = Object.entries(q.images || {}).filter(([, p]) => p);
    if (pics.length) row.height = 110;
    for (const [slot, p] of pics) {
      const file = path.resolve(baseDir, p);
      const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg');
      if (!['png', 'jpeg', 'gif'].includes(ext)) throw new Error(`question ${i + 1}: unsupported image ${p}`);
      const id = wb.addImage({ buffer: fs.readFileSync(file), extension: ext });
      ws.addImage(id, { tl: { col: COL[IMAGE_HEADER[slot]] + 0.1, row: rowNo - 1 + 0.1 }, ext: { width: 150, height: 100 }, editAs: 'oneCell' });
      images++;
    }
  });

  await wb.xlsx.writeFile(out);
  console.log(`✅ ${data.questions.length} questions (${images} images) → ${out}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
