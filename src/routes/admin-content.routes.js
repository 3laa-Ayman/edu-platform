/* Admin: content & configuration — subjects, lessons, questions, plans, settings, admin accounts. */
const router = require('express').Router();
const bcrypt = require('bcrypt');
const env = require('../config/env');
const db = require('../config/db');
const { validate, idParam, z } = require('../middleware/validate');
const { hashQuestion } = require('../services/excel.service');
const { SLOTS, saveMedia, mediaMap } = require('../services/media.service');
const { imageUpload } = require('../middleware/upload');
const { getSettings, updateSettings, SETTINGS_SCHEMA } = require('../services/settings.service');
const { email, password, fullName } = require('../utils/schemas');
const { badRequest, conflict, forbidden, notFound } = require('../utils/errors');

const name = z.string().trim().min(1).max(200);

// ------------------------------------------------------------------ Subjects & lessons
router.get('/subjects', async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id, s.name,
            (SELECT COUNT(*)::int FROM questions q WHERE q.subject_id = s.id) AS questions,
            COALESCE((SELECT json_agg(json_build_object('id', l.id, 'name', l.name, 'lesson_type', l.lesson_type,
                       'questions', (SELECT COUNT(*) FROM questions q WHERE q.lesson_id = l.id)) ORDER BY l.name)
                      FROM lessons l WHERE l.subject_id = s.id), '[]') AS lessons
       FROM subjects s ORDER BY s.name`,
  );
  res.json({ subjects: rows });
});

router.post('/subjects', validate({ body: z.object({ name: name.max(120) }) }), async (req, res) => {
  const { rows: [s] } = await db.query(`INSERT INTO subjects (name) VALUES ($1) RETURNING *`, [req.body.name]);
  res.status(201).json({ subject: s });
});

router.patch('/subjects/:id', validate({ params: idParam, body: z.object({ name: name.max(120) }) }), async (req, res) => {
  const { rows: [s] } = await db.query(`UPDATE subjects SET name = $2 WHERE id = $1 RETURNING *`, [req.p.id, req.body.name]);
  if (!s) throw notFound('المادة غير موجودة');
  res.json({ subject: s });
});

router.delete('/subjects/:id', validate({ params: idParam }), async (req, res) => {
  const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n FROM questions WHERE subject_id = $1`, [req.p.id]);
  if (n) throw conflict(`لا يمكن حذف مادة فيها ${n} سؤال — احذف الأسئلة أو انقلها لمادة أخرى أولاً`);
  const r = await db.query(`DELETE FROM subjects WHERE id = $1`, [req.p.id]);
  if (!r.rowCount) throw notFound('المادة غير موجودة');
  res.status(204).end();
});

const lessonBody = z.object({ name, lesson_type: z.string().trim().max(100).nullable().optional() });

router.post('/subjects/:id/lessons', validate({ params: idParam, body: lessonBody }), async (req, res) => {
  const { rows: [l] } = await db.query(
    `INSERT INTO lessons (subject_id, name, lesson_type) VALUES ($1, $2, $3) RETURNING *`,
    [req.p.id, req.body.name, req.body.lesson_type || null]);
  res.status(201).json({ lesson: l });
});

router.patch('/lessons/:id', validate({ params: idParam, body: lessonBody.partial() }), async (req, res) => {
  const { rows: [l] } = await db.query(
    `UPDATE lessons SET name = COALESCE($2, name),
            lesson_type = CASE WHEN $3::boolean THEN $4 ELSE lesson_type END
      WHERE id = $1 RETURNING *`,
    [req.p.id, req.body.name ?? null, 'lesson_type' in req.body, req.body.lesson_type || null]);
  if (!l) throw notFound('الدرس غير موجود');
  res.json({ lesson: l });
});

/** Questions of a deleted lesson stay in the subject without a lesson (lesson_id → NULL). */
router.delete('/lessons/:id', validate({ params: idParam }), async (req, res) => {
  const r = await db.query(`DELETE FROM lessons WHERE id = $1`, [req.p.id]);
  if (!r.rowCount) throw notFound('الدرس غير موجود');
  res.status(204).end();
});

// ------------------------------------------------------------------ Questions (single create / edit / delete)
const questionBody = z.object({
  subject_id: z.number().int().positive(),
  lesson_id: z.number().int().positive().nullable().optional(),
  // Text may be empty when the question/option is an image (uploaded via /questions/:id/media/:slot).
  question_text: z.string().trim().max(5000),
  option_a: z.string().trim().max(1000),
  option_b: z.string().trim().max(1000),
  option_c: z.string().trim().max(1000),
  option_d: z.string().trim().max(1000),
  correct_option: z.enum(['A', 'B', 'C', 'D']),
  explanation: z.string().trim().max(5000).nullable().optional(),
  law_note: z.string().trim().max(5000).nullable().optional(),
  lesson_type: z.string().trim().max(100).nullable().optional(),
  category: z.enum(['lesson', 'past_exam']).default('lesson'),
  exam_year: z.number().int().min(1990).max(2100).nullable().optional(),
  is_active: z.boolean().default(true),
});
const QUESTION_FIELDS = ['subject_id', 'lesson_id', 'question_text', 'option_a', 'option_b', 'option_c', 'option_d',
  'correct_option', 'explanation', 'law_note', 'lesson_type', 'category', 'exam_year', 'is_active'];

/** Validates the subject/lesson pair and returns the de-duplication hash for the question. */
async function prepareQuestion(q) {
  const { rows: [s] } = await db.query(`SELECT name FROM subjects WHERE id = $1`, [q.subject_id]);
  if (!s) throw badRequest('المادة غير موجودة');
  if (q.lesson_id) {
    const { rowCount } = await db.query(`SELECT 1 FROM lessons WHERE id = $1 AND subject_id = $2`, [q.lesson_id, q.subject_id]);
    if (!rowCount) throw badRequest('الدرس لا يتبع هذه المادة');
  }
  return hashQuestion({ subject: s.name, question: q.question_text, option_a: q.option_a, option_b: q.option_b, option_c: q.option_c, option_d: q.option_d });
}

router.post('/questions', validate({ body: questionBody }), async (req, res) => {
  const q = req.body;
  const hash = await prepareQuestion(q);
  const values = QUESTION_FIELDS.map((k) => q[k] ?? null);
  const { rows: [created] } = await db.query(
    `INSERT INTO questions (${QUESTION_FIELDS.join(', ')}, content_hash)
     VALUES (${QUESTION_FIELDS.map((_, i) => `$${i + 1}`).join(', ')}, $${QUESTION_FIELDS.length + 1})
     ON CONFLICT (content_hash) DO NOTHING RETURNING *`,
    [...values, hash],
  );
  if (!created) throw conflict('يوجد سؤال مطابق بالفعل في نفس المادة');
  res.status(201).json({ question: created });
});

router.patch('/questions/:id', validate({ params: idParam, body: questionBody.partial() }), async (req, res) => {
  const { rows: [cur] } = await db.query(`SELECT * FROM questions WHERE id = $1`, [req.p.id]);
  if (!cur) throw notFound('السؤال غير موجود');
  const merged = { ...cur, ...req.body };
  if ('subject_id' in req.body && !('lesson_id' in req.body) && req.body.subject_id !== cur.subject_id) merged.lesson_id = null;
  const hash = await prepareQuestion(merged);
  // Column names come from the fixed whitelist — values are parameterized.
  const sets = QUESTION_FIELDS.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows: [q] } = await db.query(
    `UPDATE questions SET ${sets}, content_hash = $${QUESTION_FIELDS.length + 2}, updated_at = now() WHERE id = $1 RETURNING *`,
    [req.p.id, ...QUESTION_FIELDS.map((k) => merged[k] ?? null), hash],
  );
  // Keep open mistakes classified under the question's current subject/lesson.
  await db.query(`UPDATE mistakes SET subject_id = $2, lesson_id = $3 WHERE question_id = $1`, [q.id, q.subject_id, q.lesson_id]);
  res.json({ question: q });
});

// ------------------------------------------------------------------ Question images
const slotParams = z.object({ id: z.coerce.number().int().positive(), slot: z.enum(SLOTS) });

router.put('/questions/:id/media/:slot', imageUpload.single('image'), validate({ params: slotParams }), async (req, res) => {
  if (!req.file) throw badRequest('ارفع الصورة في الحقل image');
  const { rowCount } = await db.query(`SELECT 1 FROM questions WHERE id = $1`, [req.p.id]);
  if (!rowCount) throw notFound('السؤال غير موجود');
  try {
    const url = await saveMedia(db, req.p.id, req.p.slot, req.file.buffer);
    res.json({ slot: req.p.slot, url });
  } catch (err) {
    if (err.status === 400) throw badRequest(err.message);
    throw err;
  }
});

router.delete('/questions/:id/media/:slot', validate({ params: slotParams }), async (req, res) => {
  const r = await db.query(`DELETE FROM question_media WHERE question_id = $1 AND slot = $2`, [req.p.id, req.p.slot]);
  if (!r.rowCount) throw notFound('لا توجد صورة');
  res.status(204).end();
});

/** Questions students already answered are hidden (kept for their history); unused ones are deleted. */
router.delete('/questions/:id', validate({ params: idParam }), async (req, res) => {
  const { rowCount: used } = await db.query(`SELECT 1 FROM attempts WHERE question_id = $1 LIMIT 1`, [req.p.id]);
  if (used) {
    const r = await db.query(`UPDATE questions SET is_active = FALSE, updated_at = now() WHERE id = $1`, [req.p.id]);
    if (!r.rowCount) throw notFound('السؤال غير موجود');
    return res.json({ deleted: false, hidden: true, message: 'السؤال له إجابات سابقة من الطلاب، فتم إخفاؤه بدل الحذف' });
  }
  const r = await db.query(`DELETE FROM questions WHERE id = $1`, [req.p.id]);
  if (!r.rowCount) throw notFound('السؤال غير موجود');
  return res.json({ deleted: true, message: 'تم حذف السؤال' });
});

// ------------------------------------------------------------------ Plans
const PLAN_FEATURES = ['practice', 'mistakes_bank', 'ai_explanations', 'competitions', 'parent_reports', 'past_exams', 'priority_support'];
const planBody = z.object({
  name_ar: z.string().trim().min(2).max(60),
  price_egp: z.number().min(0).max(100000),
  duration_days: z.number().int().min(1).max(3650),
  rank: z.number().int().min(0).max(100),
  features: z.object(Object.fromEntries(PLAN_FEATURES.map((f) => [f, z.boolean()]))).partial(),
  is_active: z.boolean(),
});

router.get('/plans', async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.*, (SELECT COUNT(DISTINCT s.user_id)::int FROM subscriptions s
                   WHERE s.plan_code = p.code AND s.status = 'active' AND now() BETWEEN s.starts_at AND s.ends_at) AS active_subscribers
       FROM plans p ORDER BY p.rank, p.code`);
  res.json({ plans: rows, features: PLAN_FEATURES });
});

router.post('/plans', validate({
  body: planBody.extend({ code: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,19}$/, 'الكود: حروف إنجليزية صغيرة وأرقام فقط') }),
}), async (req, res) => {
  const b = req.body;
  const { rows: [p] } = await db.query(
    `INSERT INTO plans (code, name_ar, price_egp, duration_days, rank, features, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.code, b.name_ar, b.price_egp, b.duration_days, b.rank, JSON.stringify(b.features), b.is_active]);
  res.status(201).json({ plan: p });
});

/** Price/duration changes apply to new purchases; existing subscriptions keep their dates. */
router.patch('/plans/:code', validate({ params: z.object({ code: z.string().max(20) }), body: planBody.partial() }), async (req, res) => {
  const b = req.body;
  const { rows: [p] } = await db.query(
    `UPDATE plans SET name_ar = COALESCE($2, name_ar), price_egp = COALESCE($3, price_egp), duration_days = COALESCE($4, duration_days),
            rank = COALESCE($5, rank), features = COALESCE($6, features), is_active = COALESCE($7, is_active)
      WHERE code = $1 RETURNING *`,
    [req.p.code, b.name_ar ?? null, b.price_egp ?? null, b.duration_days ?? null, b.rank ?? null,
      b.features ? JSON.stringify(b.features) : null, b.is_active ?? null]);
  if (!p) throw notFound('الباقة غير موجودة');
  res.json({ plan: p });
});

// ------------------------------------------------------------------ Settings
router.get('/settings', async (req, res) => {
  res.json({ settings: await getSettings() });
});

router.patch('/settings', validate({ body: SETTINGS_SCHEMA.partial() }), async (req, res) => {
  res.json({ settings: await updateSettings(req.body, req.user.id) });
});

/** Applies the current default AI limit to every existing student. */
router.post('/settings/apply-ai-limit', async (req, res) => {
  const { default_ai_limit_egp: limit } = await getSettings();
  const r = await db.query(`UPDATE users SET ai_limit_egp = $1, updated_at = now() WHERE role = 'student'`, [limit]);
  res.json({ updated: r.rowCount, limit_egp: limit });
});

// ------------------------------------------------------------------ Admin accounts
router.get('/admins', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, full_name, email, is_active, created_at FROM users WHERE role = 'admin' ORDER BY id`);
  res.json({ admins: rows, me: req.user.id });
});

router.post('/admins', validate({ body: z.object({ full_name: fullName, email, password }) }), async (req, res) => {
  const hash = await bcrypt.hash(req.body.password, env.bcryptRounds);
  const { rows: [a] } = await db.query(
    `INSERT INTO users (full_name, email, password_hash, phone, parent_phone, role, is_verified)
     VALUES ($1, $2, $3, '01000000000', '01000000001', 'admin', TRUE)
     RETURNING id, full_name, email, is_active, created_at`,
    [req.body.full_name, req.body.email, hash]);
  res.status(201).json({ admin: a });
});

router.patch('/admins/:id', validate({ params: idParam, body: z.object({ is_active: z.boolean() }) }), async (req, res) => {
  if (req.p.id === req.user.id) throw forbidden('لا يمكنك إيقاف حسابك أنت');
  const { rows: [a] } = await db.query(
    `UPDATE users SET is_active = $2, token_version = token_version + CASE WHEN $2 THEN 0 ELSE 1 END, updated_at = now()
      WHERE id = $1 AND role = 'admin' RETURNING id, full_name, email, is_active`,
    [req.p.id, req.body.is_active]);
  if (!a) throw notFound('الأدمن غير موجود');
  res.json({ admin: a });
});

/** Change my own password (requires the current one). Other sessions are logged out. */
router.post('/me/password', validate({ body: z.object({ current_password: z.string().min(1).max(72), new_password: password }) }), async (req, res) => {
  const { rows: [u] } = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
  if (!(await bcrypt.compare(req.body.current_password, u.password_hash))) throw badRequest('كلمة المرور الحالية غير صحيحة');
  const hash = await bcrypt.hash(req.body.new_password, env.bcryptRounds);
  await db.query(`UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = now() WHERE id = $1`, [req.user.id, hash]);
  res.json({ message: 'تم تغيير كلمة المرور — سجّل الدخول من جديد' });
});

module.exports = router;
