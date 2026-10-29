const crypto = require('crypto');
const ExcelJS = require('exceljs');
const db = require('../config/db');
const { normalizeChoice } = require('../utils/choices');
const { badRequest } = require('../utils/errors');
const { sha256, sniffMime, MAX_IMAGE_BYTES } = require('./media.service');
const { passageHash, upsertPassage } = require('./passage.service');

const MAX_ROWS = 5000;
const MAX_PASSAGE_CHARS = 20000;

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
  // Optional column where the question's picture is pasted (any picture in the row outside option/explanation columns also counts).
  image: ['image', 'picture', 'صورة', 'الصورة', 'صورة السؤال'],
  // Reading passage / shared figure: rows with the same "رقم القطعة" share one passage (text and/or picture),
  // written (or pasted) once in any of its rows. Without a number, rows with the exact same passage are grouped.
  passage_key: ['passage no', 'passage number', 'passage id', 'group', 'رقم القطعة', 'رقم الرسمة', 'رقم القطعة/الرسمة', 'رقم المجموعة', 'المجموعة'],
  passage: ['passage', 'reading passage', 'القطعة', 'نص القطعة', 'قطعة القراءة', 'القطعة/الرسمة'],
  passage_image: ['passage image', 'figure', 'صورة القطعة', 'الرسمة', 'صورة الرسمة', 'الرسمة المشتركة'],
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
  // Numbers formatted as scientific in Excel (3.00E+08) keep that meaning: 3×10^{8}
  if (typeof v === 'number' && /E[+-]/i.test(cell.numFmt || '')) {
    const [m, e] = v.toExponential().split('e');
    return `${Number(m)}×10^{${Number(e)}}`;
  }
  if (typeof v === 'object') {
    // Keep Excel superscript/subscript formatting as ^{..} / _{..} (rendered as real exponents on the platform).
    if (v.richText) {
      return v.richText.map((t) => {
        const va = t.font?.vertAlign;
        if (va === 'superscript' && t.text.trim()) return `^{${t.text.trim()}}`;
        if (va === 'subscript' && t.text.trim()) return `_{${t.text.trim()}}`;
        return t.text;
      }).join('').trim();
    }
    if (v.text !== undefined) return String(v.text).trim();
    if (v.result !== undefined) return String(v.result ?? '').trim();
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

/**
 * De-duplication hash: subject + text + options (+ image hashes, so same text with different figures is kept)
 * (+ the passage, so "what is the main idea?" under two different passages are two questions).
 */
const hashQuestion = (r) =>
  crypto.createHash('sha256')
    .update([r.subject, r.question, r.option_a, r.option_b, r.option_c, r.option_d].map(norm).join('|')
      + (r.media ? `|${Object.entries(r.media).map(([slot, m]) => `${slot}:${m.hash}`).sort().join(',')}` : '')
      + (r.passage_hash ? `|passage:${r.passage_hash}` : ''))
    .digest('hex');

const IMAGE_SLOT_FIELDS = ['option_a', 'option_b', 'option_c', 'option_d', 'explanation', 'passage_image'];
const SLOT_LABEL = { question: 'السؤال', option_a: 'الاختيار أ', option_b: 'الاختيار ب', option_c: 'الاختيار ج', option_d: 'الاختيار د', explanation: 'الشرح', passage: 'القطعة/الرسمة' };

/**
 * Pictures pasted over the sheet ("Place over cells"), grouped by row.
 * Slot = column of the picture's top-left corner: an option column → that option, the explanation column → explanation,
 * the passage picture column → the shared passage/figure, anything else (image column, question column...) → the question itself.
 */
function imagesByRow(wb, ws, columns) {
  const byRow = new Map();
  for (const img of ws.getImages()) {
    const media = wb.getImage(Number(img.imageId)) || wb.getImage(img.imageId);
    if (!media?.buffer) continue;
    const row = Math.floor(img.range.tl.nativeRow ?? img.range.tl.row) + 1;
    const col = Math.floor(img.range.tl.nativeCol ?? img.range.tl.col) + 1;
    const field = IMAGE_SLOT_FIELDS.find((f) => columns[f] === col);
    const slot = field === 'passage_image' ? 'passage' : field || 'question';
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push({ slot, buffer: Buffer.from(media.buffer) });
  }
  return byRow;
}

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

  const parsed = [];
  const errors = [];
  const rowImages = imagesByRow(wb, ws, columns);
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
    const passageKey = get('passage_key');
    const passageText = get('passage');
    const images = rowImages.get(i) || [];
    if (!r.question && !r.option_a && !r.option_b && !images.length && !passageText) continue; // skip empty rows

    const rowErrors = [];
    const media = {};
    for (const { slot, buffer } of images) {
      if (media[slot]) { rowErrors.push(`أكثر من صورة في خانة ${SLOT_LABEL[slot]}`); continue; }
      const mime = sniffMime(buffer);
      if (!mime) rowErrors.push(`صورة ${SLOT_LABEL[slot]} بصيغة غير مدعومة (PNG / JPG / WEBP / GIF)`);
      else if (buffer.length > MAX_IMAGE_BYTES) rowErrors.push(`صورة ${SLOT_LABEL[slot]} أكبر من 2MB — صغّرها`);
      else media[slot] = { buffer, mime, hash: sha256(buffer) };
    }
    const passageImage = media.passage || null;
    delete media.passage;
    if (passageText.length > MAX_PASSAGE_CHARS) rowErrors.push(`نص القطعة أطول من ${MAX_PASSAGE_CHARS} حرف`);
    const passageInfo = { key: passageKey, text: passageText, image: passageImage };

    // A row with only the passage (no question, no options) just defines the passage for its number.
    if (!r.question && !media.question && !['a', 'b', 'c', 'd'].some((k) => r[`option_${k}`] || media[`option_${k}`])) {
      if (rowErrors.length) errors.push({ row: i, errors: rowErrors });
      else if (!passageKey && (passageText || passageImage)) errors.push({ row: i, errors: ['صف فيه قطعة من غير أسئلة — اكتب "رقم القطعة" فيه وفي صفوف أسئلتها'] });
      else if (passageText || passageImage) parsed.push({ row: i, passageOnly: true, passage: passageInfo });
      continue;
    }
    if (!r.question && !media.question) rowErrors.push('السؤال فارغ (لا نص ولا صورة)');
    for (const k of ['option_a', 'option_b', 'option_c', 'option_d']) {
      if (!r[k] && !media[k]) rowErrors.push(`الاختيار ${k.slice(-1).toUpperCase()} فارغ (لا نص ولا صورة)`);
    }
    if (Object.keys(media).length) r.media = media;
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

    parsed.push({ ...r, row: i, correct, category, exam_year: examYear, passage: passageInfo, rowErrors });
  }

  // Passages: one per "رقم القطعة" (its text/picture may be in any of its rows), else one per identical text+picture.
  const groups = new Map();
  for (const p of parsed) {
    const { key, text, image } = p.passage;
    if (!key && !text && !image) continue;
    const gk = key ? `k:${norm(key)}` : `c:${passageHash(text, image?.hash)}`;
    if (!groups.has(gk)) groups.set(gk, { key, text: '', image: null, conflicts: [] });
    const g = groups.get(gk);
    if (text) {
      if (!g.text) g.text = text;
      else if (passageHash(g.text) !== passageHash(text)) g.conflicts.push(p.row);
    }
    if (image) {
      if (!g.image) g.image = image;
      else if (g.image.hash !== image.hash) g.conflicts.push(p.row);
    }
    p.group = g;
  }

  const valid = [];
  const seen = new Set();
  for (const p of parsed) {
    if (p.passageOnly) continue;
    const { rowErrors, passage, group, ...r } = p;
    if (group) {
      if (!group.text && !group.image) rowErrors.push(`القطعة رقم "${group.key}" مفيهاش نص ولا صورة في أي صف`);
      else if (group.conflicts.includes(p.row)) rowErrors.push(`نص أو صورة القطعة رقم "${group.key}" مختلف عن صف تاني بنفس الرقم`);
      else {
        r.passage = { text: group.text || null, image: group.image };
        r.passage_hash = passageHash(group.text, group.image?.hash);
      }
    }
    if (rowErrors.length) {
      errors.push({ row: p.row, errors: rowErrors });
      continue;
    }
    const hash = hashQuestion(r);
    if (seen.has(hash)) {
      errors.push({ row: p.row, errors: ['سؤال مكرر داخل نفس الملف'] });
      continue;
    }
    seen.add(hash);
    valid.push({ ...r, hash });
  }
  errors.sort((a, b) => a.row - b.row);
  const imageCount = valid.reduce((n, r) => n + Object.keys(r.media || {}).length, 0);
  const passages = new Set(valid.filter((r) => r.passage_hash).map((r) => r.passage_hash)).size;
  return { valid, errors, images: imageCount, passages };
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
    const passageIds = new Map();
    let inserted = 0;
    let duplicates = 0;
    let images = 0;

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

      let passageId = null;
      if (r.passage) {
        if (!passageIds.has(r.passage_hash)) passageIds.set(r.passage_hash, await upsertPassage(c, r.passage));
        passageId = passageIds.get(r.passage_hash);
      }

      const res = await c.query(
        `INSERT INTO questions (subject_id, lesson_id, question_text, option_a, option_b, option_c, option_d,
                                correct_option, explanation, law_note, lesson_type, category, exam_year, content_hash, upload_id, passage_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (content_hash) DO NOTHING RETURNING id`,
        [subjectId, lessonId, r.question, r.option_a, r.option_b, r.option_c, r.option_d, r.correct,
          r.explanation, r.law_note, r.lesson_type, r.category, r.exam_year, r.hash, upload.id, passageId],
      );
      if (res.rowCount) {
        inserted++;
        for (const [slot, m] of Object.entries(r.media || {})) {
          await c.query(
            `INSERT INTO question_media (question_id, slot, mime, data, hash) VALUES ($1, $2, $3, $4, $5)`,
            [res.rows[0].id, slot, m.mime, m.buffer, m.hash]);
          images++;
        }
      } else duplicates++;
    }

    await c.query(
      `UPDATE question_uploads SET inserted = $2, duplicates = $3, failed = $4, errors = $5 WHERE id = $1`,
      [upload.id, inserted, duplicates, errors.length, JSON.stringify(errors)],
    );
    return { upload_id: upload.id, total_rows: valid.length + errors.length, inserted, duplicates, images, passages: passageIds.size, failed: errors.length, errors };
  });
}

module.exports = { parseQuestionSheet, importQuestions, hashQuestion, HEADER_ALIASES };
