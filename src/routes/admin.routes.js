const router = require('express').Router();
const path = require('path');
const env = require('../config/env');
const db = require('../config/db');
const { notify } = require('../services/notification.service');
const { validate, idParam, pagination, z } = require('../middleware/validate');
const crypto = require('crypto');
const { excelUpload, imageUpload } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimit');
const { parseQuestionSheet, importQuestions } = require('../services/excel.service');
const { mediaMap, saveMedia } = require('../services/media.service');
const { passageMap } = require('../services/passage.service');
const { activatePayment } = require('../services/payment.service');
const { autoAssignTeams } = require('../services/team.service');
const { startWeeklyReports } = require('../services/report.service');
const { continueReports } = require('../jobs');
const { badRequest, notFound, conflict } = require('../utils/errors');

/** Upload file name as typed: multer hands it over as latin1 bytes, so Arabic names would come out garbled. */
const fileName = (f) => {
  const n = String(f.originalname || '');
  return /[^\u0000-\u00ff]/.test(n) ? n : Buffer.from(n, 'latin1').toString('utf8');
};
/** Names saved before that fix: decode them for display when they are clearly garbled UTF-8. */
const cleanName = (n) => {
  if (!n || /[^\u0000-\u00ff]/.test(n) || !/[\u00c0-\u00ff]/.test(n)) return n;
  const fixed = Buffer.from(n, 'latin1').toString('utf8');
  return fixed.includes('\ufffd') ? n : fixed;
};

// ------------------------------------------------------------------ Dashboard
router.get('/dashboard', async (req, res) => {
  const { rows: [d] } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'student' AND student_code IS NOT NULL)::int AS students,
      (SELECT COUNT(*) FROM users WHERE role = 'student' AND student_code IS NULL)::int AS pending_registrations,
      (SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE status = 'active' AND now() BETWEEN starts_at AND ends_at)::int AS active_subscribers,
      (SELECT COALESCE(SUM(amount_egp), 0) FROM payments WHERE status = 'paid')::float AS revenue_egp,
      (SELECT COUNT(*) FROM payments WHERE status = 'under_review')::int AS receipts_pending_review,
      (SELECT COUNT(*) FROM questions WHERE is_active AND NOT competition_only)::int AS questions,
      (SELECT COALESCE(SUM(cost_egp), 0) FROM ai_usage_logs WHERE status = 'success')::float AS ai_cost_egp,
      (SELECT COUNT(*) FROM users WHERE ai_spent_egp >= ai_limit_egp * 0.95)::int AS students_at_ai_limit,
      (SELECT COUNT(*) FROM teams)::int AS teams,
      -- subscriptions ending within 7 days and not renewed: students to remind (WhatsApp) before they drop
      (SELECT COUNT(*) FROM users u WHERE u.role = 'student' AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active'
                AND s.ends_at > now() AND s.ends_at <= now() + make_interval(days => 7)
                AND NOT EXISTS (SELECT 1 FROM subscriptions s2 WHERE s2.user_id = u.id AND s2.status = 'active' AND s2.ends_at > s.ends_at)))::int AS expiring_soon`);
  res.json(d);
});

// ------------------------------------------------------------------ Questions (Excel)
/**
 * multipart/form-data: file=<.xlsx>, default_subject? (used when the sheet has no subject column)
 * ?dry_run=true validates without saving.
 */
router.post('/questions/upload', uploadLimiter, excelUpload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('ارفع ملف Excel في الحقل file');
  const defaultSubject = typeof req.body?.default_subject === 'string' ? req.body.default_subject.trim().slice(0, 120) : undefined;
  const parsed = await parseQuestionSheet(req.file.buffer, { defaultSubject });
  if (req.query.dry_run === 'true') {
    return res.json({ dry_run: true, valid_rows: parsed.valid.length, images: parsed.images, passages: parsed.passages, failed: parsed.errors.length, errors: parsed.errors });
  }
  if (!parsed.valid.length) throw badRequest('لا يوجد أي صف صالح في الملف', { errors: parsed.errors });
  res.status(201).json(await importQuestions(parsed, { adminId: req.user.id, filename: fileName(req.file), fileBuffer: req.file.buffer }));
});

router.get('/questions/template', (req, res) => {
  res.download(path.resolve(__dirname, '../../templates/questions-template.xlsx'));
});

// ------------------------------------------------------------------ Uploaded sheets (download / delete a whole sheet)
/** The question-bank sheets that still have questions, newest first. */
router.get('/questions/uploads', async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.filename, u.total_rows, u.inserted, u.duplicates, u.failed, u.created_at, u.file_size,
            (u.file_data IS NOT NULL) AS has_file, a.full_name AS admin_name,
            COUNT(q.id)::int AS questions,
            COUNT(q.id) FILTER (WHERE NOT q.is_active)::int AS hidden,
            COUNT(q.id) FILTER (WHERE EXISTS (SELECT 1 FROM attempts t WHERE t.question_id = q.id))::int AS answered,
            COALESCE(array_agg(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL), '{}') AS subjects
       FROM question_uploads u
       JOIN questions q ON q.upload_id = u.id AND NOT q.competition_only
       LEFT JOIN subjects s ON s.id = q.subject_id
       LEFT JOIN users a ON a.id = u.admin_id
      WHERE NOT u.for_competition
      GROUP BY u.id, a.full_name
      ORDER BY u.created_at DESC
      LIMIT 200`);
  res.json({ uploads: rows.map((u) => ({ ...u, filename: cleanName(u.filename) })) });
});

router.get('/questions/uploads/:id/file', validate({ params: idParam }), async (req, res) => {
  const { rows: [u] } = await db.query(`SELECT filename, file_data FROM question_uploads WHERE id = $1`, [req.p.id]);
  if (!u?.file_data) throw notFound('ملف هذا الشيت غير محفوظ (رُفع قبل إضافة حفظ الملفات)');
  res.attachment(cleanName(u.filename) || `sheet-${req.p.id}.xlsx`).type('xlsx').send(u.file_data);
});

/**
 * Deletes every question that came from this sheet. Questions students already answered are hidden instead
 * (their answers stay in the students' statistics) unless ?force=true, which deletes them with their answers.
 * Refused while one of the questions is in a competition that hasn't ended.
 */
router.delete('/questions/uploads/:id', validate({ params: idParam, query: z.object({ force: z.enum(['true', 'false']).optional() }) }), async (req, res) => {
  const force = req.q.force === 'true';
  const result = await db.withTransaction(async (c) => {
    const { rows: [u] } = await c.query(`SELECT id, filename FROM question_uploads WHERE id = $1 AND NOT for_competition FOR UPDATE`, [req.p.id]);
    if (!u) throw notFound('الشيت غير موجود');
    const { rows: qs } = await c.query(
      `SELECT q.id, q.passage_id, EXISTS (SELECT 1 FROM attempts t WHERE t.question_id = q.id) AS answered
         FROM questions q WHERE q.upload_id = $1 AND NOT q.competition_only`, [u.id]);
    const ids = qs.map((q) => q.id);
    const { rowCount: live } = await c.query(
      `SELECT 1 FROM competition_questions cq JOIN competitions m ON m.id = cq.competition_id
        WHERE cq.question_id = ANY($1::bigint[]) AND m.ends_at > now() LIMIT 1`, [ids]);
    if (live) throw conflict('بعض أسئلة هذا الشيت داخل مسابقة لم تنتهِ بعد — احذف الشيت بعد انتهاء المسابقة');
    const toHide = force ? [] : qs.filter((q) => q.answered).map((q) => q.id);
    const toDelete = qs.filter((q) => !toHide.includes(q.id)).map((q) => q.id);
    if (toHide.length) await c.query(`UPDATE questions SET is_active = FALSE, updated_at = now() WHERE id = ANY($1::bigint[])`, [toHide]);
    if (toDelete.length) await c.query(`DELETE FROM questions WHERE id = ANY($1::bigint[])`, [toDelete]);
    // Passages / shared figures left without questions go too.
    const passageIds = [...new Set(qs.map((q) => q.passage_id).filter(Boolean))];
    if (passageIds.length) {
      await c.query(`DELETE FROM passages p WHERE p.id = ANY($1::bigint[]) AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.passage_id = p.id)`, [passageIds]);
    }
    if (!toHide.length) await c.query(`DELETE FROM question_uploads WHERE id = $1`, [u.id]);
    return { filename: cleanName(u.filename), deleted: toDelete.length, hidden: toHide.length };
  });
  res.json(result);
});

router.get('/questions', validate({
  query: z.object({
    subject_id: z.coerce.number().int().positive().optional(),
    lesson_id: z.coerce.number().int().positive().optional(),
    category: z.enum(['lesson', 'past_exam']).optional(),
    missing_explanation: z.enum(['true', 'false']).optional(),
    search: z.string().max(100).optional(),
    upload_id: z.coerce.number().int().positive().optional(),
    ...pagination,
  }),
}), async (req, res) => {
  const f = req.q;
  const { rows } = await db.query(
    `SELECT q.*, s.name AS subject, l.name AS lesson, COUNT(*) OVER()::int AS total
       FROM questions q JOIN subjects s ON s.id = q.subject_id LEFT JOIN lessons l ON l.id = q.lesson_id
      WHERE NOT q.competition_only AND ($1::int IS NULL OR q.subject_id = $1) AND ($2::int IS NULL OR q.lesson_id = $2)
        AND ($3::text IS NULL OR q.category = $3)
        AND ($4::boolean = FALSE OR q.explanation IS NULL)
        AND ($8::bigint IS NULL OR q.upload_id = $8)
        AND ($5::text IS NULL OR q.question_text ILIKE '%' || $5 || '%'
             OR EXISTS (SELECT 1 FROM passages p WHERE p.id = q.passage_id AND p.passage_text ILIKE '%' || $5 || '%'))
      -- Newest first, with a passage's questions kept together (in their upload order).
      ORDER BY MAX(q.id) OVER (PARTITION BY COALESCE(q.passage_id, -q.id)) DESC, q.id LIMIT $6 OFFSET $7`,
    [f.subject_id ?? null, f.lesson_id ?? null, f.category ?? null, f.missing_explanation === 'true',
      f.search ? f.search.replace(/[%_\\]/g, (m) => `\\${m}`) : null, f.limit, (f.page - 1) * f.limit, f.upload_id ?? null],
  );
  const [media, passages] = await Promise.all([mediaMap(rows.map((q) => q.id)), passageMap(rows.map((q) => q.passage_id))]);
  res.json({ total: rows[0]?.total ?? 0, items: rows.map(({ total, ...q }) => ({ ...q, media: media[q.id] || {}, passage: passages[q.passage_id] || null })) });
});

// ------------------------------------------------------------------ Payments review
router.get('/payments', validate({
  query: z.object({ status: z.enum(['pending', 'under_review', 'paid', 'failed', 'rejected']).default('under_review'), ...pagination }),
}), async (req, res) => {
  const { status, page, limit } = req.q;
  const { rows } = await db.query(
    `SELECT p.id, p.reference, p.plan_code, p.amount_egp, p.provider, p.method_type, p.status, p.sender_account,
            p.transfer_ref, (p.receipt_data IS NOT NULL OR p.receipt_path IS NOT NULL) AS has_receipt, p.admin_note, p.created_at, p.paid_at,
            u.student_code, COALESCE(u.full_name, p.student_label) AS full_name, u.phone
       FROM payments p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.status = $1
      -- queues (waiting for review/payment): oldest first; history (paid, rejected…): newest first
      ORDER BY CASE WHEN p.status IN ('under_review', 'pending') THEN p.created_at END ASC, p.created_at DESC
      LIMIT $2 OFFSET $3`,
    [status, limit, (page - 1) * limit],
  );
  res.json({ items: rows });
});

router.get('/payments/:id/receipt', validate({ params: idParam }), async (req, res) => {
  const { rows: [p] } = await db.query(`SELECT receipt_data, receipt_mime, receipt_path FROM payments WHERE id = $1`, [req.p.id]);
  if (p?.receipt_data) {
    // Mime type comes from the upload whitelist; helmet adds X-Content-Type-Options: nosniff.
    return res.type(p.receipt_mime).set('Content-Disposition', 'inline').send(p.receipt_data);
  }
  if (!p?.receipt_path) throw notFound('لا يوجد إيصال');
  // Legacy disk receipts: receipt_path is a server-generated basename; path.basename guards against traversal anyway.
  return res.sendFile(path.join(env.uploadDir, 'receipts', path.basename(p.receipt_path)));
});

router.post('/payments/:id/approve', validate({ params: idParam, body: z.object({ note: z.string().max(500).optional() }) }), async (req, res) => {
  const out = await db.withTransaction(async (c) => {
    const { rows: [p] } = await c.query(`SELECT * FROM payments WHERE id = $1 FOR UPDATE`, [req.p.id]);
    if (!p) throw notFound('عملية الدفع غير موجودة');
    if (p.method_type !== 'manual') throw badRequest('المدفوعات الإلكترونية تُفعل تلقائياً عبر الـ Webhook');
    if (p.status !== 'under_review') throw conflict('تمت مراجعة هذه العملية بالفعل');
    if (req.body.note) await c.query(`UPDATE payments SET admin_note = $2 WHERE id = $1`, [p.id, req.body.note]);
    return activatePayment(c, p.id, { reviewerId: req.user.id });
  });
  res.json({ message: 'تم تفعيل الاشتراك', subscription: out.subscription });
});

router.post('/payments/:id/reject', validate({ params: idParam, body: z.object({ note: z.string().trim().min(3).max(500) }) }), async (req, res) => {
  const r = await db.query(
    `UPDATE payments SET status = 'rejected', admin_note = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'under_review' AND method_type = 'manual' RETURNING user_id`,
    [req.p.id, req.body.note, req.user.id]);
  if (!r.rowCount) throw conflict('لا يمكن رفض هذه العملية');
  if (r.rows[0].user_id) {
    await notify(db, r.rows[0].user_id, {
      kind: 'payment_rejected', tone: 'warning', link: '#/subscribe',
      title: '❌ تم رفض الإيصال', body: `السبب: ${req.body.note} — يمكنك رفع إيصال جديد من صفحة الاشتراك.`,
    });
  }
  res.json({ message: 'تم رفض الإيصال' });
});

/**
 * Delete a payment (and its receipt image). For a paid one the admin chooses whether the subscription it bought is
 * cancelled too; otherwise the subscription stays (it just loses its link to the payment). Revenue drops by its amount.
 */
router.delete('/payments/:id', validate({ params: idParam, body: z.object({ cancel_subscription: z.boolean().default(false) }).default({}) }), async (req, res) => {
  const out = await db.withTransaction(async (c) => {
    const { rows: [p] } = await c.query(`SELECT id, status FROM payments WHERE id = $1 FOR UPDATE`, [req.p.id]);
    if (!p) throw notFound('العملية غير موجودة');
    let cancelled = 0;
    if (req.body.cancel_subscription) {
      cancelled = (await c.query(`UPDATE subscriptions SET status = 'cancelled' WHERE payment_id = $1 AND status = 'active'`, [p.id])).rowCount;
    }
    await c.query(`DELETE FROM payments WHERE id = $1`, [p.id]);
    return { deleted: true, subscription_cancelled: cancelled > 0 };
  });
  res.json(out);
});

/**
 * A search text that looks like a phone number → its digits as stored (01xxxxxxxxx): Arabic digits, spaces, dashes
 * and the +20 / 0020 / 20 country code are accepted. Fewer than 4 digits → not a phone search.
 */
function phoneDigits(text) {
  if (!text) return null;
  let d = text.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[\s\-()+]/g, '');
  if (!/^\d{4,15}$/.test(d)) return null;
  d = d.replace(/^0020/, '0').replace(/^20(?=1\d{9}$)/, '0');
  return d;
}

// ------------------------------------------------------------------ Students
router.get('/students', validate({
  query: z.object({ search: z.string().max(100).optional(), expiring: z.coerce.number().int().min(1).max(60).optional(), ...pagination }),
}), async (req, res) => {
  const { search, page, limit, expiring } = req.q;
  const { rows } = await db.query(
    `SELECT u.id, u.student_code, u.full_name, u.email, u.phone, u.parent_phone, u.is_verified, u.is_active,
            u.ai_spent_egp, u.ai_limit_egp, u.created_at,
            (SELECT p.name_ar FROM subscriptions s JOIN plans p ON p.code = s.plan_code
              WHERE s.user_id = u.id AND s.status = 'active' AND now() BETWEEN s.starts_at AND s.ends_at
              ORDER BY p.rank DESC LIMIT 1) AS current_plan,
            (SELECT MAX(s.ends_at) FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND s.ends_at > now()) AS plan_ends_at,
            (SELECT COUNT(*)::int FROM user_devices d WHERE d.user_id = u.id) AS devices,
            -- tries from a 3rd device in the last 30 days: a hint that the account is being shared
            (SELECT COUNT(*)::int FROM device_events e WHERE e.user_id = u.id AND e.type = 'blocked_limit'
                AND e.created_at > now() - interval '30 days') AS blocked_device_attempts
       FROM users u
      WHERE u.role = 'student' AND ($1::text IS NULL OR u.student_code ILIKE $1 || '%' OR u.email ILIKE $1 || '%' OR u.full_name ILIKE '%' || $1 || '%'
            -- phone search: student's or parent's number, any part of it (01012345678, 1234567…)
            OR ($4::text IS NOT NULL AND (u.phone LIKE '%' || $4 || '%' OR u.parent_phone LIKE '%' || $4 || '%')))
        AND ($5::int IS NULL OR EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active'
                AND s.ends_at > now() AND s.ends_at <= now() + make_interval(days => $5::int)
                AND NOT EXISTS (SELECT 1 FROM subscriptions s2 WHERE s2.user_id = u.id AND s2.status = 'active' AND s2.ends_at > s.ends_at)))
      ORDER BY CASE WHEN $5::int IS NOT NULL THEN (SELECT MAX(s.ends_at) FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active') END ASC,
               u.id DESC
      LIMIT $2 OFFSET $3`,
    [search ? search.replace(/[%_\\]/g, (m) => `\\${m}`) : null, limit, (page - 1) * limit, phoneDigits(search), expiring ?? null],
  );
  res.json({ items: rows });
});

// ------------------------------------------------------------------ Competitions & teams
router.post('/competitions', validate({
  body: z.object({
    title: z.string().trim().min(3).max(150),
    type: z.enum(['team_weekly', 'individual_monthly']),
    starts_at: z.coerce.date(),
    ends_at: z.coerce.date(),
    duration_minutes: z.number().int().min(1).max(600).default(30),
    question_ids: z.array(z.number().int().positive()).max(200).optional(),
    // Questions written for this competition only (created first with POST /admin/competition-questions[/upload]).
    extra_question_ids: z.array(z.number().int().positive()).max(200).optional(),
    random: z.object({
      count: z.number().int().min(1).max(200),
      subject_id: z.number().int().positive().optional(),
      lesson_id: z.number().int().positive().optional(),
      category: z.enum(['lesson', 'past_exam']).optional(),
    }).optional(),
  }).refine((b) => b.ends_at > b.starts_at, { message: 'وقت النهاية يجب أن يكون بعد البداية', path: ['ends_at'] })
    .refine((b) => b.question_ids?.length || b.random || b.extra_question_ids?.length, { message: 'أضف أسئلة للمسابقة', path: ['question_ids'] }),
}), async (req, res) => {
  const b = req.body;
  const comp = await db.withTransaction(async (c) => {
    const { rows: [comp] } = await c.query(
      `INSERT INTO competitions (title, type, starts_at, ends_at, duration_minutes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [b.title, b.type, b.starts_at, b.ends_at, b.duration_minutes, req.user.id]);
    const ins = b.question_ids?.length
      ? await c.query(
        `INSERT INTO competition_questions (competition_id, question_id)
         SELECT $1, id FROM questions WHERE id = ANY($2::bigint[]) AND is_active AND NOT competition_only`, [comp.id, b.question_ids])
      : b.random ? await c.query(
        `INSERT INTO competition_questions (competition_id, question_id)
         SELECT $1, id FROM questions
          WHERE is_active AND NOT competition_only AND ($2::int IS NULL OR subject_id = $2) AND ($3::text IS NULL OR category = $3)
            AND ($5::int IS NULL OR lesson_id = $5)
          ORDER BY random() LIMIT $4`,
        [comp.id, b.random.subject_id ?? null, b.random.category ?? null, b.random.count, b.random.lesson_id ?? null])
      : { rowCount: 0 };
    if ((b.question_ids?.length || b.random) && !ins.rowCount) throw badRequest('لم يتم العثور على أسئلة مطابقة في البنك');
    // The competition's own questions: only unused ones (each belongs to a single competition).
    const extra = b.extra_question_ids?.length ? await c.query(
      `INSERT INTO competition_questions (competition_id, question_id)
       SELECT $1, q.id FROM questions q
        WHERE q.id = ANY($2::bigint[]) AND q.competition_only
          AND NOT EXISTS (SELECT 1 FROM competition_questions cq WHERE cq.question_id = q.id)`, [comp.id, b.extra_question_ids]) : { rowCount: 0 };
    if (b.extra_question_ids?.length && extra.rowCount !== new Set(b.extra_question_ids).size) {
      throw badRequest('بعض الأسئلة الخاصة غير موجودة أو مستخدمة في مسابقة أخرى — أضفها من جديد');
    }
    return { ...comp, question_count: ins.rowCount + extra.rowCount, extra_questions: extra.rowCount };
  });
  res.status(201).json({ competition: comp });
});

// ------------------------------------------------------------------ A competition's own questions
// Not added to the question bank: hidden from practice, the bank list, random picks and the mistakes bank, and
// deleted with their competition (unused ones after a day — see the cleanup job).
const compQuestionBody = z.object({
  subject_id: z.coerce.number().int().positive(),
  question_text: z.string().trim().max(5000).default(''),
  option_a: z.string().trim().min(1, 'اكتب الاختيار أ').max(1000),
  option_b: z.string().trim().min(1, 'اكتب الاختيار ب').max(1000),
  // C and D both empty = two-option question (e.g. true / false).
  option_c: z.string().trim().max(1000).default(''),
  option_d: z.string().trim().max(1000).default(''),
  correct_option: z.enum(['A', 'B', 'C', 'D']),
  explanation: z.string().trim().max(5000).optional(),
}).refine((b) => Boolean(b.option_c) === Boolean(b.option_d), { message: 'اكتب الاختيارين ج و د، أو اتركهما فارغين معًا لسؤال باختيارين', path: ['option_c'] })
  .refine((b) => b.option_c || ['A', 'B'].includes(b.correct_option), { message: 'السؤال له اختياران فقط — الإجابة الصحيحة لازم تكون أ أو ب', path: ['correct_option'] });

/** One question typed in the competition form (multipart: the fields + optional image "image"). */
router.post('/competition-questions', uploadLimiter, imageUpload.single('image'), validate({ body: compQuestionBody }), async (req, res) => {
  const b = req.body;
  if (!b.question_text && !req.file) throw badRequest('اكتب نص السؤال أو ارفع صورة له');
  const { rowCount: subjectOk } = await db.query(`SELECT 1 FROM subjects WHERE id = $1`, [b.subject_id]);
  if (!subjectOk) throw badRequest('المادة غير موجودة');
  const q = await db.withTransaction(async (c) => {
    const { rows: [q] } = await c.query(
      `INSERT INTO questions (subject_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation,
                              content_hash, competition_only)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
       RETURNING id, question_text, option_a, option_b, option_c, option_d, correct_option`,
      [b.subject_id, b.question_text, b.option_a, b.option_b, b.option_c, b.option_d, b.correct_option, b.explanation || null,
        crypto.randomBytes(32).toString('hex')]);
    if (req.file) {
      try {
        q.image = await saveMedia(c, q.id, 'question', req.file.buffer);
      } catch (err) {
        if (err.status === 400) throw badRequest(err.message);
        throw err;
      }
    }
    return q;
  });
  res.status(201).json({ question: q });
});

/** An Excel sheet (same template as the bank) whose questions are for one competition only. */
router.post('/competition-questions/upload', uploadLimiter, excelUpload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('ارفع ملف Excel في الحقل file');
  const defaultSubject = typeof req.body?.default_subject === 'string' ? req.body.default_subject.trim().slice(0, 120) : undefined;
  const parsed = await parseQuestionSheet(req.file.buffer, { defaultSubject });
  if (!parsed.valid.length) throw badRequest('لا يوجد أي صف صالح في الملف', { errors: parsed.errors });
  const r = await importQuestions(parsed, { adminId: req.user.id, filename: fileName(req.file), competitionOnly: true });
  const { rows } = await db.query(
    `SELECT id, question_text, correct_option FROM questions WHERE id = ANY($1::bigint[]) ORDER BY id`, [r.question_ids]);
  res.status(201).json({ questions: rows, images: r.images, passages: r.passages, failed: r.failed, errors: r.errors });
});

router.post('/teams/auto-assign', validate({ body: z.object({ require_subscription: z.boolean().default(true) }) }), async (req, res) => {
  res.json(await autoAssignTeams({ requireSubscription: req.body.require_subscription }));
});

// ------------------------------------------------------------------ Reports
/** "Send parent reports now": first batch here, the rest continues in the background. */
router.post('/reports/send-weekly', async (req, res) => {
  await startWeeklyReports();
  res.json(await continueReports({ baseUrl: `${req.protocol}://${req.get('host')}` }));
});

router.get('/ai-usage', async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.student_code, u.full_name, u.ai_spent_egp, u.ai_limit_egp,
            COUNT(l.id) FILTER (WHERE l.status = 'success')::int AS requests,
            COALESCE(SUM(l.total_tokens), 0)::int AS tokens
       FROM users u LEFT JOIN ai_usage_logs l ON l.user_id = u.id
      WHERE u.role = 'student'
      GROUP BY u.id ORDER BY u.ai_spent_egp DESC LIMIT 100`);
  res.json({ items: rows });
});

// ------------------------------------------------------------------ Products
const productBody = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().max(2000).optional().nullable(),
  image_url: z.string().url().optional().nullable(),
  category: z.string().max(60).optional().nullable(),
  original_price: z.number().min(0),
  discount_percent: z.number().int().min(0).max(100).default(0),
  coupon_code: z.string().max(40).optional().nullable(),
  external_url: z.string().url().optional().nullable(),
  is_active: z.boolean().default(true),
});

router.get('/products', async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM products ORDER BY is_active DESC, created_at DESC`);
  res.json({ products: rows });
});

router.post('/products', validate({ body: productBody }), async (req, res) => {
  const b = req.body;
  const { rows: [p] } = await db.query(
    `INSERT INTO products (title, description, image_url, category, original_price, discount_percent, coupon_code, external_url, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [b.title, b.description ?? null, b.image_url ?? null, b.category ?? null, b.original_price, b.discount_percent,
      b.coupon_code ?? null, b.external_url ?? null, b.is_active]);
  res.status(201).json({ product: p });
});

router.put('/products/:id', validate({ params: idParam, body: productBody }), async (req, res) => {
  const b = req.body;
  const { rows: [p] } = await db.query(
    `UPDATE products SET title=$2, description=$3, image_url=$4, category=$5, original_price=$6, discount_percent=$7,
            coupon_code=$8, external_url=$9, is_active=$10 WHERE id=$1 RETURNING *`,
    [req.p.id, b.title, b.description ?? null, b.image_url ?? null, b.category ?? null, b.original_price, b.discount_percent,
      b.coupon_code ?? null, b.external_url ?? null, b.is_active]);
  if (!p) throw notFound('المنتج غير موجود');
  res.json({ product: p });
});

router.delete('/products/:id', validate({ params: idParam }), async (req, res) => {
  const r = await db.query(`DELETE FROM products WHERE id = $1`, [req.p.id]);
  if (!r.rowCount) throw notFound('المنتج غير موجود');
  res.status(204).end();
});

// ------------------------------------------------------------------ Announcements
const announcementBody = z.object({
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().max(5000).default(''),
  tone: z.enum(['info', 'success', 'warning']).default('info'),
  audience: z.enum(['all', 'subscribers', 'free']).default('all'),
  link_url: z.string().url().regex(/^https?:\/\//i, 'يجب أن يبدأ الرابط بـ https://').max(500).optional().nullable(),
  pinned: z.boolean().default(false),
  is_active: z.boolean().default(true),
  starts_at: z.coerce.date().optional().nullable(),
  expires_at: z.coerce.date().optional().nullable(),
}).refine((b) => !b.expires_at || b.expires_at > (b.starts_at || new Date(0)), { message: 'تاريخ الانتهاء يجب أن يكون بعد البداية', path: ['expires_at'] });

router.get('/announcements', async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.*, (SELECT COUNT(*)::int FROM announcement_reads r WHERE r.announcement_id = a.id) AS reads
       FROM announcements a ORDER BY a.pinned DESC, a.starts_at DESC LIMIT 200`);
  res.json({ announcements: rows });
});

const announcementValues = (b) => [b.title, b.body, b.tone, b.audience, b.link_url ?? null, b.pinned, b.is_active, b.starts_at ?? null, b.expires_at ?? null];

router.post('/announcements', validate({ body: announcementBody }), async (req, res) => {
  const { rows: [a] } = await db.query(
    `INSERT INTO announcements (title, body, tone, audience, link_url, pinned, is_active, starts_at, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, now()),$9,$10) RETURNING *`,
    [...announcementValues(req.body), req.user.id]);
  res.status(201).json({ announcement: a });
});

router.put('/announcements/:id', validate({ params: idParam, body: announcementBody }), async (req, res) => {
  const { rows: [a] } = await db.query(
    `UPDATE announcements SET title=$2, body=$3, tone=$4, audience=$5, link_url=$6, pinned=$7, is_active=$8,
            starts_at=COALESCE($9, starts_at), expires_at=$10 WHERE id=$1 RETURNING *`,
    [req.p.id, ...announcementValues(req.body)]);
  if (!a) throw notFound('الإعلان غير موجود');
  res.json({ announcement: a });
});

router.delete('/announcements/:id', validate({ params: idParam }), async (req, res) => {
  const r = await db.query(`DELETE FROM announcements WHERE id = $1`, [req.p.id]);
  if (!r.rowCount) throw notFound('الإعلان غير موجود');
  res.status(204).end();
});

module.exports = router;
