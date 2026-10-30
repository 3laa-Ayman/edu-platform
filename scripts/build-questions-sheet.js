/**
 * Builds a questions sheet ready for upload (same columns as templates/questions-template.xlsx)
 * from a JSON file of extracted questions:
 *   node scripts/build-questions-sheet.js questions.json out.xlsx
 *
 * JSON: { "defaults": { subject, lesson, lesson_type, category, exam_year }, "questions": [ {
 *   question, A, B, C, D, answer,              // answer: أ/ب/ج/د (or A-D) — always filled (solve it when the source has no answer)
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
  // Readable widths for the text columns (the sheet is also the owner's archive, not just an upload file).
  const WIDTH = { 'السؤال': 48, 'أ': 26, 'ب': 26, 'ج': 26, 'د': 26, 'الإجابة الصحيحة': 11, 'الشرح': 50, 'القانون/الملحوظة': 28, 'القطعة': 70 };
  ws.columns = headers.map((h) => ({ header: h.name, width: WIDTH[h.name] || h.width }));
  const header = ws.getRow(1);
  header.height = 30;
  header.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  const border = { style: 'thin', color: { argb: 'FFD9DCE6' } };
  // Rough row height so wrapped text is visible without resizing (Excel doesn't auto-fit generated rows).
  const linesFor = (text, width) => String(text || '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / (width * 1.15))), 0);
  let band = false;
  let lastPassage = null;

  let images = 0;
  data.questions.forEach((q, i) => {
    const values = new Array(headers.length).fill('');
    for (const [field, header] of Object.entries(FIELD_HEADER)) {
      const v = q[field] ?? defaults[field];
      if (v !== undefined && v !== null) values[COL[header]] = String(v);
    }
    const row = ws.addRow(values);
    const rowNo = i + 2;
    // Questions of one passage share a background band, so passage groups are easy to see.
    const pkey = q.passage_no ? `p${q.passage_no}` : `q${i}`;
    if (pkey !== lastPassage) { band = !band; lastPassage = pkey; }
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.alignment = { wrapText: true, vertical: 'top', readingOrder: 'rtl', horizontal: col === COL['الإجابة الصحيحة'] + 1 ? 'center' : 'right' };
      c.font = { size: 12 };
      c.border = { top: border, bottom: border, left: border, right: border };
      if (band) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F5FB' } };
    });
    const ans = row.getCell(COL['الإجابة الصحيحة'] + 1);
    ans.font = { size: 14, bold: true, color: { argb: 'FF15803D' } };
    ans.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F6EC' } };
    const lines = Math.max(...headers.map((h, c) => (h.name === 'القطعة' ? Math.min(linesFor(values[c], ws.getColumn(c + 1).width), 10) : linesFor(values[c], ws.getColumn(c + 1).width))));
    row.height = Math.min(300, Math.max(22, lines * 17));
    const pics = Object.entries(q.images || {}).filter(([, p]) => p);
    if (pics.length) row.height = Math.max(row.height, 110);
    for (const [slot, p] of pics) {
      const file = path.resolve(baseDir, p);
      const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg');
      if (!['png', 'jpeg', 'gif'].includes(ext)) throw new Error(`question ${i + 1}: unsupported image ${p}`);
      const id = wb.addImage({ buffer: fs.readFileSync(file), extension: ext });
      ws.addImage(id, { tl: { col: COL[IMAGE_HEADER[slot]] + 0.1, row: rowNo - 1 + 0.1 }, ext: { width: 150, height: 100 }, editAs: 'oneCell' });
      images++;
    }
  });

  // Summary sheet for the archive (the platform reads the first sheet only).
  const sum = wb.addWorksheet('ملخص', { views: [{ rightToLeft: true }] });
  sum.columns = [{ header: 'الدرس', width: 40 }, { header: 'عدد الأسئلة', width: 14 }, { header: 'فيها صور', width: 12 }, { header: 'عدد القطع', width: 12 }];
  sum.getRow(1).font = { bold: true };
  const per = new Map();
  data.questions.forEach((q) => {
    const l = q.lesson ?? defaults.lesson ?? '—';
    if (!per.has(l)) per.set(l, { n: 0, img: 0, passages: new Set() });
    const x = per.get(l);
    x.n++;
    if (Object.values(q.images || {}).some(Boolean)) x.img++;
    if (q.passage_no) x.passages.add(q.passage_no);
  });
  for (const [l, x] of per) sum.addRow([l, x.n, x.img, x.passages.size]);
  const totalPassages = new Set(data.questions.filter((q) => q.passage_no).map((q) => q.passage_no)).size;
  sum.addRow(['الإجمالي', data.questions.length, data.questions.filter((q) => Object.values(q.images || {}).some(Boolean)).length, totalPassages]).font = { bold: true };

  await wb.xlsx.writeFile(out);
  console.log(`✅ ${data.questions.length} questions (${images} images) → ${out}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
