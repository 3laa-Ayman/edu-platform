const crypto = require('crypto');
const ExcelJS = require('exceljs');
const db = require('../config/db');
const { normalizeChoice } = require('../utils/choices');
const { badRequest } = require('../utils/errors');

const MAX_ROWS = 5000;

/** Normalizes Arabic/English text for header matching & de-duplication. */
function norm(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '') // tashkeel + tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\s_\-/]+/g, ' ');
}

// Column header aliases (Arabic + English). Matching is done on normalized text.
const HEADER_ALIASES = {
  question: ['question', 'السؤال', 'نص السؤال'],
  option_a: ['a', 'option a', 'أ', 'الاختيار أ', 'اختيار أ', 'الاختيار الاول'],
  option_b: ['b', 'option b', 'ب', 'الاختيار ب', 'اختيار ب', 'الاختيار الثاني'],
  option_c: ['c', 'option c', 'ج', 'الاختيار ج', 'اختيار ج', 'الاختيار الثالث'],
  option_d: ['d', 'option d', 'د', 'الاختيار د', 'اختيار د', 'الاختيار الرابع'],
  correct: ['correct', 'answer', 'correct answer', 'الإجابة الصحيحة', 'الاجابة', 'الحل'],
  explanation: ['explanation', 'الشرح', 'التفسير'],
  law_note: ['law', 'note', 'law note', 'القانون', 'الملحوظة', 'القانون/الملحوظة', 'القانون الملحوظة', 'ملحوظة', 'القاعدة'],
  subject: ['subject', 'المادة'],
  lesson: ['lesson', 'الدرس', 'اسم الدرس'],
  lesson_type: ['lesson type', 'نوع الدرس'],
  category: ['category', 'type', 'التصنيف', 'تصنيف السؤال', 'النوع'],
  exam_year: ['exam year', 'year', 'سنة الامتحان', 'السنة'],
};
const HEADER_LOOKUP = new Map();
for (const [field, aliases] of Object.entries(HEADER_ALIASES)) for (const a of aliases) HEADER_LOOKUP.set(norm(a), field);

const CATEGORY_MAP = new Map([
  ['lesson', 'lesson'], ['درس', 'lesson'], ['دروس', 'lesson'],
  ['past exam', 'past_exam'], ['past_exam', 'past_exam'], ['exam', 'past_exam'],
  ['امتحان سابق', 'past_exam'], ['امتحان', 'past_exam'], ['امتحانات سابقه', 'past_exam'], ['سابق', 'past_exam'],
].map(([k, v]) => [norm(k), v]));

function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('').trim();
    if (v.text !== undefined) return String(v.text).trim();
    if (v.result !== undefined) return String(v.result ?? '').trim();
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

const hashQuestion = (r) =>
  crypto.createHash('sha256')
    .update([r.subject, r.question, r.option_a, r.option_b, r.option_c, r.option_d].map(norm).join('|'))
    .digest('hex');

/** Parses + validates the sheet. Returns { valid: [...rows], errors: [{row, errors}] }. */
async function parseQuestionSheet(buffer, { defaultSubject } = {}) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw badRequest('تعذر قراءة ملف Excel — تأكد أنه ملف .xlsx سليم');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest('الملف لا يحتوي على أي شيت');

  const columns = {};
  ws.getRow(1).eachCell((cell, col) => {
    const field = HEADER_LOOKUP.get(norm(cellText(cell)));
    if (field && !columns[field]) columns[field] = col;
  });
  const required = ['question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct'];
  const missing = required.filter((f) => !columns[f]);
  if (!columns.subject && !defaultSubject) missing.push('subject');
  if (missing.length) throw badRequest('أعمدة مطلوبة غير موجودة في الصف الأول', { missing_columns: missing });

  const valid = [];
  const errors = [];
  const seen = new Set();
  if (ws.actualRowCount > MAX_ROWS + 1) throw badRequest(`الحد الأقصى ${MAX_ROWS} سؤال في الملف الواحد`);

  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const get = (f) => (columns[f] ? cellText(row.getCell(columns[f])) : '');
    const r = {
      question: get('question'),
      option_a: get('option_a'), option_b: get('option_b'), option_c: get('option_c'), option_d: get('option_d'),
      explanation: get('explanation') || null,
      law_note: get('law_note') || null,
      subject: get('subject') || defaultSubject || '',
      lesson: get('lesson') || null,
      lesson_type: get('lesson_type') || null,
    };
    if (!r.question && !r.option_a && !r.option_b) continue; // skip empty rows

    const rowErrors = [];
    if (!r.question) rowErrors.push('نص السؤال فارغ');
    for (const k of ['option_a', 'option_b', 'option_c', 'option_d']) if (!r[k]) rowErrors.push(`الاختيار ${k.slice(-1).toUpperCase()} فارغ`);
    if (!r.subject) rowErrors.push('المادة غير محددة');

    const rawCorrect = get('correct');
    let correct = normalizeChoice(rawCorrect);
    if (!correct && rawCorrect) {
      // Allow the correct answer to be written as the option text itself.
      correct = ['A', 'B', 'C', 'D'].find((L) => norm(r[`option_${L.toLowerCase()}`]) === norm(rawCorrect)) || null;
    }
    if (!correct) rowErrors.push(`الإجابة الصحيحة غير مفهومة: "${rawCorrect}" (استخدم A/B/C/D أو أ/ب/ج/د)`);

    const rawCategory = get('category');
    const category = rawCategory ? CATEGORY_MAP.get(norm(rawCategory)) : 'lesson';
    if (!category) rowErrors.push(`تصنيف غير معروف: "${rawCategory}" (درس / امتحان سابق)`);

    const rawYear = get('exam_year');
    const examYear = rawYear ? parseInt(rawYear, 10) : null;
    if (rawYear && (!Number.isInteger(examYear) || examYear < 1990 || examYear > 2100)) rowErrors.push('سنة الامتحان غير صحيحة');

    for (const k of ['question', 'explanation', 'law_note']) if (r[k] && r[k].length > 5000) rowErrors.push(`${k} أطول من 5000 حرف`);

    if (rowErrors.length) {
      errors.push({ row: i, errors: rowErrors });
      continue;
    }
    const hash = hashQuestion(r);
    if (seen.has(hash)) {
      errors.push({ row: i, errors: ['سؤال مكرر داخل نفس الملف'] });
      continue;
    }
    seen.add(hash);
    valid.push({ ...r, row: i, correct, category, exam_year: examYear, hash });
  }
  return { valid, errors };
}

/** Inserts validated rows in one transaction; subjects/lessons are created on the fly. Duplicates are skipped. */
async function importQuestions({ valid, errors }, { adminId, filename }) {
  return db.withTransaction(async (c) => {
    const { rows: [upload] } = await c.query(
      `INSERT INTO question_uploads (admin_id, filename, total_rows) VALUES ($1, $2, $3) RETURNING id`,
      [adminId, filename, valid.length + errors.length],
    );
    const subjectIds = new Map();
    const lessonIds = new Map();
    let inserted = 0;
    let duplicates = 0;

    for (const r of valid) {
      if (!subjectIds.has(r.subject)) {
        const { rows } = await c.query(
          `INSERT INTO subjects (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [r.subject],
        );
        subjectIds.set(r.subject, rows[0].id);
      }
      const subjectId = subjectIds.get(r.subject);

      let lessonId = null;
      if (r.lesson) {
        const key = `${subjectId}|${r.lesson}`;
        if (!lessonIds.has(key)) {
          const { rows } = await c.query(
            `INSERT INTO lessons (subject_id, name, lesson_type) VALUES ($1, $2, $3)
             ON CONFLICT (subject_id, name) DO UPDATE SET lesson_type = COALESCE(EXCLUDED.lesson_type, lessons.lesson_type)
             RETURNING id`,
            [subjectId, r.lesson, r.lesson_type],
          );
          lessonIds.set(key, rows[0].id);
        }
        lessonId = lessonIds.get(key);
      }

      const res = await c.query(
        `INSERT INTO questions (subject_id, lesson_id, question_text, option_a, option_b, option_c, option_d,
                                correct_option, explanation, law_note, lesson_type, category, exam_year, content_hash, upload_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (content_hash) DO NOTHING RETURNING id`,
        [subjectId, lessonId, r.question, r.option_a, r.option_b, r.option_c, r.option_d, r.correct,
          r.explanation, r.law_note, r.lesson_type, r.category, r.exam_year, r.hash, upload.id],
      );
      if (res.rowCount) inserted++;
      else duplicates++;
    }

    await c.query(
      `UPDATE question_uploads SET inserted = $2, duplicates = $3, failed = $4, errors = $5 WHERE id = $1`,
      [upload.id, inserted, duplicates, errors.length, JSON.stringify(errors)],
    );
    return { upload_id: upload.id, total_rows: valid.length + errors.length, inserted, duplicates, failed: errors.length, errors };
  });
}

module.exports = { parseQuestionSheet, importQuestions, hashQuestion, HEADER_ALIASES };
