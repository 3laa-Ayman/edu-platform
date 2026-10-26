/* Admin: students, subscriptions, teams and competitions management. */
const router = require('express').Router();
const bcrypt = require('bcrypt');
const env = require('../config/env');
const db = require('../config/db');
const { validate, idParam, z } = require('../middleware/validate');
const { nextStudentCode } = require('../utils/ids');
const { egyptPhone, email, password, fullName } = require('../utils/schemas');
const { grantSubscription } = require('../services/payment.service');
const { subjectPerformance, overall } = require('../services/stats.service');
const { getSettings } = require('../services/settings.service');
const { TEAM_SIZE } = require('../services/team.service');
const { badRequest, conflict, notFound } = require('../utils/errors');

// ------------------------------------------------------------------ Students
/** Add a student directly (already verified — no OTP). */
router.post('/students', validate({
  body: z.object({ full_name: fullName, email, password, phone: egyptPhone, parent_phone: egyptPhone, parent_email: email.optional() }),
}), async (req, res) => {
  const b = req.body;
  if (b.phone === b.parent_phone) throw badRequest('رقم ولي الأمر يجب أن يكون مختلفاً عن رقم الطالب');
  const hash = await bcrypt.hash(b.password, env.bcryptRounds);
  const { default_ai_limit_egp: aiLimit } = await getSettings();
  const student = await db.withTransaction(async (c) => {
    const code = await nextStudentCode(c);
    const { rows: [u] } = await c.query(
      `INSERT INTO users (student_code, full_name, email, password_hash, phone, parent_phone, parent_email, is_verified, ai_limit_egp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8) RETURNING id, student_code, full_name, email`,
      [code, b.full_name, b.email, hash, b.phone, b.parent_phone, b.parent_email || null, aiLimit]);
    return u;
  });
  res.status(201).json({ student });
});

/** Full student profile for the admin. */
router.get('/students/:id', validate({ params: idParam }), async (req, res) => {
  const { rows: [u] } = await db.query(
    `SELECT id, student_code, full_name, email, phone, parent_phone, parent_email, is_verified, is_active,
            ai_spent_egp, ai_limit_egp, created_at
       FROM users WHERE id = $1 AND role = 'student'`, [req.p.id]);
  if (!u) throw notFound('الطالب غير موجود');
  const [subs, payments, team, mistakes, subjects] = await Promise.all([
    db.query(
      `SELECT s.id, s.plan_code, p.name_ar, s.starts_at, s.ends_at, s.status, s.payment_id,
              (s.status = 'active' AND now() BETWEEN s.starts_at AND s.ends_at) AS is_current
         FROM subscriptions s JOIN plans p ON p.code = s.plan_code WHERE s.user_id = $1 ORDER BY s.starts_at DESC`, [u.id]),
    db.query(
      `SELECT id, plan_code, amount_egp, provider, status, created_at, paid_at FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [u.id]),
    db.query(
      `SELECT t.id, t.name FROM teams t JOIN team_members tm ON tm.team_id = t.id WHERE tm.user_id = $1`, [u.id]),
    db.query(`SELECT COUNT(*)::int AS n FROM mistakes WHERE user_id = $1`, [u.id]),
    subjectPerformance(u.id),
  ]);
  res.json({
    student: u,
    subscriptions: subs.rows,
    payments: payments.rows,
    team: team.rows[0] || null,
    open_mistakes: mistakes.rows[0].n,
    performance: { overall: overall(subjects), subjects },
  });
});

router.patch('/students/:id', validate({
  params: idParam,
  body: z.object({
    full_name: fullName,
    email,
    phone: egyptPhone,
    parent_phone: egyptPhone,
    parent_email: email.nullable(),
    is_verified: z.boolean(),
    is_active: z.boolean(),
    ai_limit_egp: z.number().min(0).max(10000),
    reset_ai_spent: z.boolean(),
  }).partial(),
}), async (req, res) => {
  const b = req.body;
  const fields = ['full_name', 'email', 'phone', 'parent_phone', 'parent_email', 'is_verified', 'is_active', 'ai_limit_egp'].filter((k) => k in b);
  // Column names come from the fixed whitelist — values are parameterized.
  const sets = fields.map((k, i) => `${k} = $${i + 2}`);
  if (b.reset_ai_spent) sets.push('ai_spent_egp = 0');
  if (b.is_active === false) sets.push('token_version = token_version + 1'); // log the student out everywhere
  if (!sets.length) throw badRequest('لا توجد حقول للتعديل');
  const { rows: [u] } = await db.query(
    `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND role = 'student'
     RETURNING id, student_code, full_name, email, phone, parent_phone, parent_email, is_verified, is_active, ai_spent_egp, ai_limit_egp`,
    [req.p.id, ...fields.map((k) => b[k])]);
  if (!u) throw notFound('الطالب غير موجود');
  res.json({ student: u });
});

/** Set a new password for a student (logs them out of all devices). */
router.post('/students/:id/password', validate({ params: idParam, body: z.object({ new_password: password }) }), async (req, res) => {
  const hash = await bcrypt.hash(req.body.new_password, env.bcryptRounds);
  const u = await db.withTransaction(async (c) => {
    const { rows: [cur] } = await c.query(`SELECT id, student_code FROM users WHERE id = $1 AND role = 'student' FOR UPDATE`, [req.p.id]);
    if (!cur) throw notFound('الطالب غير موجود');
    // A student who never finished registering gets verified + a student code here.
    const code = cur.student_code || await nextStudentCode(c);
    const { rows: [done] } = await c.query(
      `UPDATE users SET password_hash = $2, student_code = $3, is_verified = TRUE, token_version = token_version + 1, updated_at = now()
        WHERE id = $1 RETURNING student_code`, [cur.id, hash, code]);
    return done;
  });
  res.json({ message: 'تم تغيير كلمة مرور الطالب', student_code: u.student_code });
});

/** Grant a subscription manually (gift / cash payment / compensation). */
router.post('/students/:id/subscriptions', validate({
  params: idParam,
  body: z.object({ plan_code: z.string().max(20), days: z.number().int().min(1).max(3650).optional() }),
}), async (req, res) => {
  const sub = await db.withTransaction(async (c) => {
    const { rowCount } = await c.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'student'`, [req.p.id]);
    if (!rowCount) throw notFound('الطالب غير موجود');
    return grantSubscription(c, { userId: req.p.id, planCode: req.body.plan_code, days: req.body.days });
  });
  res.status(201).json({ subscription: sub });
});

router.post('/subscriptions/:id/cancel', validate({ params: idParam }), async (req, res) => {
  const { rows: [s] } = await db.query(
    `UPDATE subscriptions SET status = 'cancelled' WHERE id = $1 AND status = 'active' RETURNING *`, [req.p.id]);
  if (!s) throw notFound('الاشتراك غير موجود أو ملغي بالفعل');
  res.json({ subscription: s });
});

// ------------------------------------------------------------------ Teams
router.get('/teams', validate({ query: z.object({ search: z.string().max(80).optional() }) }), async (req, res) => {
  const search = req.q.search ? req.q.search.replace(/[%_\\]/g, (m) => `\\${m}`) : null;
  const { rows } = await db.query(
    `SELECT t.id, t.name, t.captain_id, t.is_auto_generated, t.allow_auto_fill, t.created_at,
            COALESCE(json_agg(json_build_object('id', u.id, 'student_code', u.student_code, 'full_name', u.full_name)
                     ORDER BY tm.joined_at) FILTER (WHERE u.id IS NOT NULL), '[]') AS members
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id
       LEFT JOIN users u ON u.id = tm.user_id
      WHERE $1::text IS NULL OR t.name ILIKE '%' || $1 || '%'
         OR EXISTS (SELECT 1 FROM team_members m2 JOIN users u2 ON u2.id = m2.user_id
                     WHERE m2.team_id = t.id AND (u2.student_code ILIKE $1 || '%' OR u2.full_name ILIKE '%' || $1 || '%'))
      GROUP BY t.id ORDER BY t.created_at DESC LIMIT 200`,
    [search]);
  res.json({ teams: rows, max_size: TEAM_SIZE });
});

router.patch('/teams/:id', validate({
  params: idParam,
  body: z.object({ name: z.string().trim().min(2).max(80), allow_auto_fill: z.boolean(), captain_id: z.number().int().positive() }).partial(),
}), async (req, res) => {
  const b = req.body;
  if (b.captain_id) {
    const { rowCount } = await db.query(`SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2`, [req.p.id, b.captain_id]);
    if (!rowCount) throw badRequest('القائد لازم يكون عضو في التيم');
  }
  const { rows: [t] } = await db.query(
    `UPDATE teams SET name = COALESCE($2, name), allow_auto_fill = COALESCE($3, allow_auto_fill), captain_id = COALESCE($4, captain_id)
      WHERE id = $1 RETURNING *`,
    [req.p.id, b.name ?? null, b.allow_auto_fill ?? null, b.captain_id ?? null]);
  if (!t) throw notFound('التيم غير موجود');
  res.json({ team: t });
});

router.delete('/teams/:id', validate({ params: idParam }), async (req, res) => {
  const r = await db.query(`DELETE FROM teams WHERE id = $1`, [req.p.id]);
  if (!r.rowCount) throw notFound('التيم غير موجود');
  res.status(204).end();
});

router.post('/teams/:id/members', validate({
  params: idParam,
  body: z.object({ student_code: z.string().trim().toUpperCase().max(20) }),
}), async (req, res) => {
  await db.withTransaction(async (c) => {
    const { rows: [t] } = await c.query(`SELECT id, captain_id FROM teams WHERE id = $1 FOR UPDATE`, [req.p.id]);
    if (!t) throw notFound('التيم غير موجود');
    const { rows: [u] } = await c.query(`SELECT id FROM users WHERE student_code = $1 AND role = 'student'`, [req.body.student_code]);
    if (!u) throw notFound('لا يوجد طالب بهذا الكود');
    const { rowCount: inTeam } = await c.query(`SELECT 1 FROM team_members WHERE user_id = $1`, [u.id]);
    if (inTeam) throw conflict('الطالب عضو في تيم آخر — أزله منه أولاً');
    const { rows: [{ n }] } = await c.query(`SELECT COUNT(*)::int AS n FROM team_members WHERE team_id = $1`, [t.id]);
    if (n >= TEAM_SIZE) throw conflict(`التيم مكتمل (${TEAM_SIZE} طلاب)`);
    await c.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`, [t.id, u.id]);
    if (!t.captain_id) await c.query(`UPDATE teams SET captain_id = $2 WHERE id = $1`, [t.id, u.id]);
    await c.query(`UPDATE team_invites SET status = 'expired', responded_at = now() WHERE invitee_id = $1 AND status = 'pending'`, [u.id]);
  });
  res.status(201).json({ message: 'تمت إضافة الطالب للتيم' });
});

/** Remove a member; captaincy passes to the longest-standing member and an empty team is deleted. */
router.delete('/teams/:id/members/:userId', validate({
  params: z.object({ id: z.coerce.number().int().positive(), userId: z.coerce.number().int().positive() }),
}), async (req, res) => {
  await db.withTransaction(async (c) => {
    const { rows: [t] } = await c.query(`SELECT id, captain_id FROM teams WHERE id = $1 FOR UPDATE`, [req.p.id]);
    if (!t) throw notFound('التيم غير موجود');
    const r = await c.query(`DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`, [t.id, req.p.userId]);
    if (!r.rowCount) throw notFound('الطالب ليس عضواً في هذا التيم');
    const { rows: [next] } = await c.query(`SELECT user_id FROM team_members WHERE team_id = $1 ORDER BY joined_at LIMIT 1`, [t.id]);
    if (!next) await c.query(`DELETE FROM teams WHERE id = $1`, [t.id]);
    else if (t.captain_id === req.p.userId) await c.query(`UPDATE teams SET captain_id = $2 WHERE id = $1`, [t.id, next.user_id]);
  });
  res.json({ message: 'تمت إزالة الطالب من التيم' });
});

// ------------------------------------------------------------------ Competitions
router.patch('/competitions/:id', validate({
  params: idParam,
  body: z.object({
    title: z.string().trim().min(3).max(150),
    starts_at: z.coerce.date(),
    ends_at: z.coerce.date(),
    duration_minutes: z.number().int().min(1).max(600),
  }).partial(),
}), async (req, res) => {
  const b = req.body;
  const { rows: [cur] } = await db.query(`SELECT * FROM competitions WHERE id = $1`, [req.p.id]);
  if (!cur) throw notFound('المسابقة غير موجودة');
  if ((b.ends_at ?? cur.ends_at) <= (b.starts_at ?? cur.starts_at)) throw badRequest('وقت النهاية يجب أن يكون بعد البداية');
  const { rows: [c] } = await db.query(
    `UPDATE competitions SET title = COALESCE($2, title), starts_at = COALESCE($3, starts_at), ends_at = COALESCE($4, ends_at),
            duration_minutes = COALESCE($5, duration_minutes)
      WHERE id = $1 RETURNING *`,
    [req.p.id, b.title ?? null, b.starts_at ?? null, b.ends_at ?? null, b.duration_minutes ?? null]);
  res.json({ competition: c });
});

/** Deletes the competition with all entries/results (student attempts stay in their history). */
router.delete('/competitions/:id', validate({ params: idParam }), async (req, res) => {
  const r = await db.query(`DELETE FROM competitions WHERE id = $1`, [req.p.id]);
  if (!r.rowCount) throw notFound('المسابقة غير موجودة');
  res.status(204).end();
});

module.exports = router;
