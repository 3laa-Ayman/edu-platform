const router = require('express').Router();
const path = require('path');
const env = require('../config/env');
const db = require('../config/db');
const { validate, idParam, pagination, z } = require('../middleware/validate');
const { excelUpload } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimit');
const { parseQuestionSheet, importQuestions } = require('../services/excel.service');
const { activatePayment } = require('../services/payment.service');
const { autoAssignTeams } = require('../services/team.service');
const { sendWeeklyReportsToAll } = require('../services/report.service');
const { badRequest, notFound, conflict } = require('../utils/errors');

// ------------------------------------------------------------------ Dashboard
router.get('/dashboard', async (req, res) => {
  const { rows: [d] } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'student')::int AS students,
      (SELECT COUNT(*) FROM users WHERE role = 'student' AND is_verified)::int AS verified_students,
      (SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE status = 'active' AND now() BETWEEN starts_at AND ends_at)::int AS active_subscribers,
      (SELECT COALESCE(SUM(amount_egp), 0) FROM payments WHERE status = 'paid')::float AS revenue_egp,
      (SELECT COUNT(*) FROM payments WHERE status = 'under_review')::int AS receipts_pending_review,
      (SELECT COUNT(*) FROM questions WHERE is_active)::int AS questions,
      (SELECT COALESCE(SUM(cost_egp), 0) FROM ai_usage_logs WHERE status = 'success')::float AS ai_cost_egp,
      (SELECT COUNT(*) FROM users WHERE ai_spent_egp >= ai_limit_egp * 0.95)::int AS students_at_ai_limit,
      (SELECT COUNT(*) FROM teams)::int AS teams`);
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
    return res.json({ dry_run: true, valid_rows: parsed.valid.length, failed: parsed.errors.length, errors: parsed.errors });
  }
  if (!parsed.valid.length) throw badRequest('لا يوجد أي صف صالح في الملف', { errors: parsed.errors });
  res.status(201).json(await importQuestions(parsed, { adminId: req.user.id, filename: req.file.originalname }));
});

router.get('/questions/template', (req, res) => {
  res.download(path.resolve(__dirname, '../../templates/questions-template.xlsx'));
});

router.get('/questions/uploads', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, filename, total_rows, inserted, duplicates, failed, created_at FROM question_uploads ORDER BY created_at DESC LIMIT 50`);
  res.json({ uploads: rows });
});

router.get('/questions', validate({
  query: z.object({
    subject_id: z.coerce.number().int().positive().optional(),
    lesson_id: z.coerce.number().int().positive().optional(),
    category: z.enum(['lesson', 'past_exam']).optional(),
    missing_explanation: z.enum(['true', 'false']).optional(),
    search: z.string().max(100).optional(),
    ...pagination,
  }),
}), async (req, res) => {
  const f = req.q;
  const { rows } = await db.query(
    `SELECT q.*, s.name AS subject, l.name AS lesson, COUNT(*) OVER()::int AS total
       FROM questions q JOIN subjects s ON s.id = q.subject_id LEFT JOIN lessons l ON l.id = q.lesson_id
      WHERE ($1::int IS NULL OR q.subject_id = $1) AND ($2::int IS NULL OR q.lesson_id = $2)
        AND ($3::text IS NULL OR q.category = $3)
        AND ($4::boolean = FALSE OR q.explanation IS NULL)
        AND ($5::text IS NULL OR q.question_text ILIKE '%' || $5 || '%')
      ORDER BY q.id DESC LIMIT $6 OFFSET $7`,
    [f.subject_id ?? null, f.lesson_id ?? null, f.category ?? null, f.missing_explanation === 'true',
      f.search ? f.search.replace(/[%_\\]/g, (m) => `\\${m}`) : null, f.limit, (f.page - 1) * f.limit],
  );
  res.json({ total: rows[0]?.total ?? 0, items: rows.map(({ total, ...q }) => q) });
});

router.patch('/questions/:id', validate({
  params: idParam,
  body: z.object({
    question_text: z.string().min(1).max(5000).optional(),
    option_a: z.string().min(1).optional(), option_b: z.string().min(1).optional(),
    option_c: z.string().min(1).optional(), option_d: z.string().min(1).optional(),
    correct_option: z.enum(['A', 'B', 'C', 'D']).optional(),
    explanation: z.string().max(5000).nullable().optional(),
    law_note: z.string().max(5000).nullable().optional(),
    category: z.enum(['lesson', 'past_exam']).optional(),
    is_active: z.boolean().optional(),
  }),
}), async (req, res) => {
  const allowed = ['question_text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_option', 'explanation', 'law_note', 'category', 'is_active'];
  const keys = allowed.filter((k) => k in req.body);
  if (!keys.length) throw badRequest('لا توجد حقول للتعديل');
  // Column names come from the fixed whitelist above — values are still parameterized.
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows: [q] } = await db.query(
    `UPDATE questions SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`, [req.p.id, ...keys.map((k) => req.body[k])]);
  if (!q) throw notFound('السؤال غير موجود');
  res.json({ question: q });
});

// ------------------------------------------------------------------ Payments review
router.get('/payments', validate({
  query: z.object({ status: z.enum(['pending', 'under_review', 'paid', 'failed', 'rejected']).default('under_review'), ...pagination }),
}), async (req, res) => {
  const { status, page, limit } = req.q;
  const { rows } = await db.query(
    `SELECT p.id, p.reference, p.plan_code, p.amount_egp, p.provider, p.method_type, p.status, p.sender_account,
            p.transfer_ref, p.receipt_path IS NOT NULL AS has_receipt, p.admin_note, p.created_at, p.paid_at,
            u.student_code, u.full_name, u.phone
       FROM payments p JOIN users u ON u.id = p.user_id
      WHERE p.status = $1 ORDER BY p.created_at ASC LIMIT $2 OFFSET $3`,
    [status, limit, (page - 1) * limit],
  );
  res.json({ items: rows });
});

router.get('/payments/:id/receipt', validate({ params: idParam }), async (req, res) => {
  const { rows: [p] } = await db.query(`SELECT receipt_path FROM payments WHERE id = $1`, [req.p.id]);
  if (!p?.receipt_path) throw notFound('لا يوجد إيصال');
  // receipt_path is a server-generated basename; path.basename guards against traversal anyway.
  res.sendFile(path.join(env.uploadDir, 'receipts', path.basename(p.receipt_path)));
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
      WHERE id = $1 AND status = 'under_review' AND method_type = 'manual'`,
    [req.p.id, req.body.note, req.user.id]);
  if (!r.rowCount) throw conflict('لا يمكن رفض هذه العملية');
  res.json({ message: 'تم رفض الإيصال' });
});

// ------------------------------------------------------------------ Students
router.get('/students', validate({ query: z.object({ search: z.string().max(100).optional(), ...pagination }) }), async (req, res) => {
  const { search, page, limit } = req.q;
  const { rows } = await db.query(
    `SELECT id, student_code, full_name, email, phone, parent_phone, is_verified, is_active, ai_spent_egp, ai_limit_egp, created_at
       FROM users
      WHERE role = 'student' AND ($1::text IS NULL OR student_code ILIKE $1 || '%' OR email ILIKE $1 || '%' OR full_name ILIKE '%' || $1 || '%')
      ORDER BY id DESC LIMIT $2 OFFSET $3`,
    [search ? search.replace(/[%_\\]/g, (m) => `\\${m}`) : null, limit, (page - 1) * limit],
  );
  res.json({ items: rows });
});

router.patch('/students/:id', validate({
  params: idParam,
  body: z.object({ is_active: z.boolean().optional(), ai_limit_egp: z.number().min(0).max(10000).optional(), reset_ai_spent: z.boolean().optional() }),
}), async (req, res) => {
  const b = req.body;
  const { rows: [u] } = await db.query(
    `UPDATE users SET
        is_active = COALESCE($2, is_active),
        ai_limit_egp = COALESCE($3, ai_limit_egp),
        ai_spent_egp = CASE WHEN $4 THEN 0 ELSE ai_spent_egp END,
        token_version = CASE WHEN $2 IS FALSE THEN token_version + 1 ELSE token_version END,
        updated_at = now()
      WHERE id = $1 AND role = 'student'
      RETURNING id, student_code, is_active, ai_spent_egp, ai_limit_egp`,
    [req.p.id, b.is_active ?? null, b.ai_limit_egp ?? null, b.reset_ai_spent === true]);
  if (!u) throw notFound('الطالب غير موجود');
  res.json({ student: u });
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
    random: z.object({
      count: z.number().int().min(1).max(200),
      subject_id: z.number().int().positive().optional(),
      category: z.enum(['lesson', 'past_exam']).optional(),
    }).optional(),
  }).refine((b) => b.ends_at > b.starts_at, { message: 'وقت النهاية يجب أن يكون بعد البداية', path: ['ends_at'] })
    .refine((b) => b.question_ids?.length || b.random, { message: 'حدد question_ids أو random', path: ['question_ids'] }),
}), async (req, res) => {
  const b = req.body;
  const comp = await db.withTransaction(async (c) => {
    const { rows: [comp] } = await c.query(
      `INSERT INTO competitions (title, type, starts_at, ends_at, duration_minutes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [b.title, b.type, b.starts_at, b.ends_at, b.duration_minutes, req.user.id]);
    const ins = b.question_ids?.length
      ? await c.query(
        `INSERT INTO competition_questions (competition_id, question_id)
         SELECT $1, id FROM questions WHERE id = ANY($2::bigint[]) AND is_active`, [comp.id, b.question_ids])
      : await c.query(
        `INSERT INTO competition_questions (competition_id, question_id)
         SELECT $1, id FROM questions
          WHERE is_active AND ($2::int IS NULL OR subject_id = $2) AND ($3::text IS NULL OR category = $3)
          ORDER BY random() LIMIT $4`,
        [comp.id, b.random.subject_id ?? null, b.random.category ?? null, b.random.count]);
    if (!ins.rowCount) throw badRequest('لم يتم العثور على أسئلة مطابقة');
    return { ...comp, question_count: ins.rowCount };
  });
  res.status(201).json({ competition: comp });
});

router.post('/teams/auto-assign', validate({ body: z.object({ require_subscription: z.boolean().default(true) }) }), async (req, res) => {
  res.json(await autoAssignTeams({ requireSubscription: req.body.require_subscription }));
});

// ------------------------------------------------------------------ Reports
router.post('/reports/send-weekly', async (req, res) => {
  res.json(await sendWeeklyReportsToAll());
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

module.exports = router;
