const router = require('express').Router();
const bcrypt = require('bcrypt');
const env = require('../config/env');
const db = require('../config/db');
const { validate, z } = require('../middleware/validate');
const { authenticate, signToken } = require('../middleware/auth');
const { authLimiter, otpLimiter } = require('../middleware/rateLimit');
const { getActiveSubscription } = require('../middleware/subscription');
const { nextStudentCode } = require('../utils/ids');
const { issueOtp, consumeOtp } = require('../services/otp.service');
const { sendOtpEmail } = require('../services/notify.service');
const { getSettings } = require('../services/settings.service');
const { badRequest, conflict, unauthorized, forbidden } = require('../utils/errors');

const { egyptPhone, email, password, fullName } = require('../utils/schemas');
const otpCode = z.string().trim().regex(/^\d{6}$/, 'رمز التحقق 6 أرقام');

// Used when the email is unknown, so response time does not reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);
const devOtp = (code) => (env.otp.devEcho ? { dev_otp: code } : {});

router.post('/register', authLimiter, validate({
  body: z.object({
    full_name: fullName,
    email,
    password,
    phone: egyptPhone,
    parent_phone: egyptPhone,
    parent_email: email.optional(),
  }),
}), async (req, res) => {
  const b = req.body;
  if (b.phone === b.parent_phone) throw badRequest('رقم ولي الأمر يجب أن يكون مختلفاً عن رقم الطالب');
  const passwordHash = await bcrypt.hash(b.password, env.bcryptRounds);
  const { default_ai_limit_egp: aiLimit } = await getSettings();

  const { user, code } = await db.withTransaction(async (c) => {
    const exists = await c.query(`SELECT 1 FROM users WHERE email = $1`, [b.email]);
    if (exists.rowCount) throw conflict('هذا البريد الإلكتروني مسجل بالفعل');
    const studentCode = await nextStudentCode(c);
    const { rows: [u] } = await c.query(
      `INSERT INTO users (student_code, full_name, email, password_hash, phone, parent_phone, parent_email, ai_limit_egp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, student_code, full_name, email`,
      [studentCode, b.full_name, b.email, passwordHash, b.phone, b.parent_phone, b.parent_email || null, aiLimit],
    );
    return { user: u, code: await issueOtp(c, u.id, 'verify_email') };
  });
  await sendOtpEmail(user.email, code, 'verify_email');

  res.status(201).json({
    message: 'تم إنشاء الحساب. أرسلنا رمز تحقق إلى بريدك الإلكتروني.',
    student_code: user.student_code,
    ...devOtp(code),
  });
});

async function findByEmail(e) {
  const { rows } = await db.query(`SELECT * FROM users WHERE email = $1`, [e]);
  return rows[0];
}

router.post('/verify-otp', authLimiter, validate({ body: z.object({ email, code: otpCode }) }), async (req, res) => {
  const user = await findByEmail(req.body.email);
  if (!user) throw badRequest('رمز التحقق غير صالح');
  if (user.is_verified) throw badRequest('الحساب مفعل بالفعل، سجّل الدخول');
  await consumeOtp(user.id, 'verify_email', req.body.code);
  const { rows: [u] } = await db.query(
    `UPDATE users SET is_verified = TRUE, updated_at = now() WHERE id = $1 RETURNING *`, [user.id]);
  res.json({ message: 'تم تفعيل الحساب بنجاح', token: signToken(u), user: profile(u) });
});

router.post('/resend-otp', otpLimiter, validate({ body: z.object({ email }) }), async (req, res) => {
  const user = await findByEmail(req.body.email);
  let code;
  if (user && !user.is_verified) {
    code = await issueOtp(db, user.id, 'verify_email');
    await sendOtpEmail(user.email, code, 'verify_email');
  }
  // Same answer whether or not the account exists (prevents email enumeration).
  res.json({ message: 'إذا كان الحساب موجوداً وغير مفعل فسيصلك رمز جديد', ...(code ? devOtp(code) : {}) });
});

router.post('/login', authLimiter, validate({
  body: z.object({ identifier: z.string().trim().min(3).max(255), password: z.string().min(1).max(72) }),
}), async (req, res) => {
  const id = req.body.identifier.toLowerCase();
  const { rows } = await db.query(
    `SELECT * FROM users WHERE email = $1 OR student_code = UPPER($1)`, [id]);
  const user = rows[0];
  const ok = await bcrypt.compare(req.body.password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw unauthorized('البريد/الكود أو كلمة المرور غير صحيحة');
  if (!user.is_active) throw forbidden('تم إيقاف هذا الحساب، تواصل مع الدعم', 'ACCOUNT_DISABLED');
  if (!user.is_verified) throw forbidden('يجب تأكيد البريد الإلكتروني أولاً', 'EMAIL_NOT_VERIFIED');
  res.json({ token: signToken(user), user: profile(user) });
});

router.post('/forgot-password', otpLimiter, validate({ body: z.object({ email }) }), async (req, res) => {
  const user = await findByEmail(req.body.email);
  let code;
  if (user && user.is_active) {
    code = await issueOtp(db, user.id, 'reset_password');
    await sendOtpEmail(user.email, code, 'reset_password');
  }
  res.json({ message: 'إذا كان البريد مسجلاً فسيصلك رمز لإعادة تعيين كلمة المرور', ...(code ? devOtp(code) : {}) });
});

router.post('/reset-password', authLimiter, validate({ body: z.object({ email, code: otpCode, new_password: password }) }), async (req, res) => {
  const user = await findByEmail(req.body.email);
  if (!user) throw badRequest('رمز التحقق غير صالح');
  await consumeOtp(user.id, 'reset_password', req.body.code);
  const hash = await bcrypt.hash(req.body.new_password, env.bcryptRounds);
  // token_version++ logs out every existing session.
  await db.query(
    `UPDATE users SET password_hash = $2, token_version = token_version + 1, is_verified = TRUE, updated_at = now() WHERE id = $1`,
    [user.id, hash]);
  res.json({ message: 'تم تغيير كلمة المرور، سجّل الدخول من جديد' });
});

router.post('/logout-all', authenticate, async (req, res) => {
  await db.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [req.user.id]);
  res.json({ message: 'تم تسجيل الخروج من جميع الأجهزة' });
});

router.get('/me', authenticate, async (req, res) => {
  const { rows: [u] } = await db.query(`SELECT * FROM users WHERE id = $1`, [req.user.id]);
  res.json({ user: profile(u), subscription: await getActiveSubscription(u.id) });
});

function profile(u) {
  return {
    id: u.id,
    student_code: u.student_code,
    full_name: u.full_name,
    email: u.email,
    phone: u.phone,
    parent_phone: u.parent_phone,
    parent_email: u.parent_email,
    role: u.role,
    ai: { spent_egp: Number(Number(u.ai_spent_egp).toFixed(2)), limit_egp: u.ai_limit_egp },
  };
}

module.exports = router;
