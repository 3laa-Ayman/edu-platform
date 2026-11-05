const router = require('express').Router();
const bcrypt = require('bcrypt');
const env = require('../config/env');
const db = require('../config/db');
const { validate, idParam, z } = require('../middleware/validate');
const { authenticate, signToken, signSetupToken, verifySetupToken, signDeviceToken, verifyDeviceToken } = require('../middleware/auth');
const devices = require('../services/device.service');
const { authLimiter, otpLimiter } = require('../middleware/rateLimit');
const { getActiveSubscription } = require('../middleware/subscription');
const { nextStudentCode } = require('../utils/ids');
const { issueOtp, consumeOtp } = require('../services/otp.service');
const { sendOtpEmail } = require('../services/notify.service');
const { getSettings } = require('../services/settings.service');
const { AppError, badRequest, conflict, unauthorized, forbidden } = require('../utils/errors');
const guard = require('../services/login-guard');

const { egyptPhone, email, password, fullName } = require('../utils/schemas');
const otpCode = z.string().trim().regex(/^\d{6}$/, 'رمز التحقق 6 أرقام');

// Used when the email is unknown, so response time does not reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);
const devOtp = (code) => (env.otp.devEcho ? { dev_otp: code } : {});
const deviceId = z.string().max(100).optional(); // the browser's copy of its device id (the cookie wins)
/** "a***@gmail.com" — tells the student where the code went without exposing the full address. */
const maskEmail = (e) => e.replace(/^(.)[^@]*(@.*)$/, (_, a, d) => `${a}***${d}`);

/**
 * Registration (3 steps):
 *   1. POST /register      — name, email, phone, parent phone (no password) → OTP sent to the email (cheaper than SMS)
 *   2. POST /verify-otp    — email + code → short-lived setup_token
 *   3. POST /set-password  — setup_token + password → student code (STU-2026-XXXX) assigned, logged in
 * Codes are only assigned to completed registrations, so abandoned sign-ups never consume an ID.
 */
router.post('/register', authLimiter, validate({
  body: z.object({
    full_name: fullName,
    email,
    phone: egyptPhone,
    parent_phone: egyptPhone,
    parent_email: email.optional(),
  }),
}), async (req, res) => {
  const b = req.body;
  if (b.phone === b.parent_phone) throw badRequest('رقم ولي الأمر يجب أن يكون مختلفاً عن رقم الطالب');
  const { default_ai_limit_egp: aiLimit } = await getSettings();

  const { user, code } = await db.withTransaction(async (c) => {
    const { rows: [existing] } = await c.query(`SELECT id, password_hash FROM users WHERE email = $1 FOR UPDATE`, [b.email]);
    if (existing?.password_hash) throw conflict('هذا البريد الإلكتروني مسجل بالفعل — سجّل الدخول أو استخدم "نسيت كلمة المرور"');
    let u;
    if (existing) {
      // Unfinished registration with this email: update the details and send a fresh code.
      ({ rows: [u] } = await c.query(
        `UPDATE users SET full_name = $2, phone = $3, parent_phone = $4, parent_email = $5, updated_at = now()
          WHERE id = $1 RETURNING id, email`,
        [existing.id, b.full_name, b.phone, b.parent_phone, b.parent_email || null]));
    } else {
      ({ rows: [u] } = await c.query(
        `INSERT INTO users (full_name, email, phone, parent_phone, parent_email, ai_limit_egp)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email`,
        [b.full_name, b.email, b.phone, b.parent_phone, b.parent_email || null, aiLimit]));
    }
    return { user: u, code: await issueOtp(c, u.id, 'verify_email') };
  });
  await sendOtpEmail(user.email, code, 'verify_email');

  res.status(201).json({ message: 'أرسلنا رمز تحقق إلى بريدك الإلكتروني', ...devOtp(code) });
});

async function findByEmail(e) {
  const { rows } = await db.query(`SELECT * FROM users WHERE email = $1`, [e]);
  return rows[0];
}

router.post('/verify-otp', authLimiter, validate({ body: z.object({ email, code: otpCode }) }), async (req, res) => {
  const user = await findByEmail(req.body.email);
  if (!user) throw badRequest('رمز التحقق غير صالح');
  if (user.password_hash) throw badRequest('الحساب مفعل بالفعل، سجّل الدخول');
  await consumeOtp(user.id, 'verify_email', req.body.code);
  await db.query(`UPDATE users SET is_verified = TRUE, updated_at = now() WHERE id = $1`, [user.id]);
  res.json({ message: 'تم تأكيد البريد الإلكتروني — عيّن كلمة المرور', setup_token: signSetupToken(user) });
});

router.post('/set-password', authLimiter, validate({
  body: z.object({ setup_token: z.string().min(10).max(1000), password, device_id: deviceId }),
}), async (req, res) => {
  const { sub } = verifySetupToken(req.body.setup_token);
  const hash = await bcrypt.hash(req.body.password, env.bcryptRounds);
  const keyHash = devices.hashKey(devices.deviceKey(req, res));
  let sid;
  const user = await db.withTransaction(async (c) => {
    const { rows: [u] } = await c.query(`SELECT * FROM users WHERE id = $1 FOR NO KEY UPDATE`, [sub]);
    if (!u || !u.is_verified) throw badRequest('أكّد بريدك الإلكتروني أولاً');
    // Single use: once a password exists, this step is closed (changes go through "forgot password").
    if (u.password_hash) throw conflict('تم تعيين كلمة المرور بالفعل، سجّل الدخول');
    const studentCode = u.student_code || await nextStudentCode(c);
    const { rows: [done] } = await c.query(
      `UPDATE users SET password_hash = $2, student_code = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [u.id, hash, studentCode]);
    // The email was just confirmed on this browser: it becomes the account's first device, no extra code.
    const device = await devices.addDevice(c, done, keyHash, req);
    sid = await devices.startSession(c, done.id, device, req);
    return done;
  });
  res.status(201).json({
    message: `تم إنشاء حسابك بنجاح — كود الطالب الخاص بك: ${user.student_code}`,
    student_code: user.student_code,
    token: signToken(user, sid),
    user: profile(user),
  });
});

router.post('/resend-otp', otpLimiter, validate({ body: z.object({ email }) }), async (req, res) => {
  const user = await findByEmail(req.body.email);
  let code;
  if (user && !user.password_hash) {
    code = await issueOtp(db, user.id, 'verify_email');
    await sendOtpEmail(user.email, code, 'verify_email');
  }
  // Same answer whether or not the account exists (prevents email enumeration).
  res.json({ message: 'إذا كان التسجيل غير مكتمل فسيصلك رمز جديد', ...(code ? devOtp(code) : {}) });
});

router.post('/login', authLimiter, validate({
  body: z.object({ identifier: z.string().trim().min(3).max(255), password: z.string().min(1).max(72), device_id: deviceId }),
}), async (req, res) => {
  const id = req.body.identifier.toLowerCase();
  const { rows } = await db.query(
    `SELECT * FROM users WHERE email = $1 OR student_code = UPPER($1)`, [id]);
  const user = rows[0];
  const guardKey = guard.keyFor(user, id);
  const mins = await guard.lockedFor(guardKey);
  if (mins) {
    throw new AppError(429, `محاولات كتير بكلمة مرور غلط على الحساب ده — حاول بعد ${mins} دقيقة، أو استخدم «نسيت كلمة المرور»`, 'ACCOUNT_LOCKED');
  }
  const ok = await bcrypt.compare(req.body.password, user?.password_hash || DUMMY_HASH);
  if (!user?.password_hash || !ok) {
    await guard.recordFailure(guardKey);
    throw unauthorized('البريد/الكود أو كلمة المرور غير صحيحة');
  }
  await guard.clearFailures(guardKey);
  if (!user.is_active) throw forbidden('تم إيقاف هذا الحساب، تواصل مع الدعم', 'ACCOUNT_DISABLED');
  if (!user.is_verified) throw forbidden('يجب تأكيد البريد الإلكتروني أولاً', 'EMAIL_NOT_VERIFIED');
  if (user.role === 'admin') return res.json({ token: signToken(user), user: profile(user) });

  // Students: a known device logs straight in (signing the other device out); a new one needs the email code.
  const keyHash = devices.hashKey(devices.deviceKey(req, res));
  const known = await devices.findDevice(db, user.id, keyHash);
  if (known) {
    const sid = await db.withTransaction((c) => devices.startSession(c, user.id, known, req));
    return res.json({ token: signToken(user, sid), user: profile(user) });
  }
  await devices.assertRoom(db, user, req);
  const code = await issueOtp(db, user.id, 'new_device', { cooldown: false });
  await sendOtpEmail(user.email, code, 'new_device');
  res.json({
    device_verification: true,
    device_token: signDeviceToken(user, keyHash),
    email_hint: maskEmail(user.email),
    message: 'ده جهاز جديد — أرسلنا رمز تأكيد على إيميلك',
    ...devOtp(code),
  });
});

/** Second step of a login from a new device: the email code → the device is added (max 2) and the session starts. */
router.post('/verify-device', authLimiter, validate({
  body: z.object({ device_token: z.string().min(10).max(1000), code: otpCode }),
}), async (req, res) => {
  const { sub, dk } = verifyDeviceToken(req.body.device_token);
  await consumeOtp(sub, 'new_device', req.body.code);
  const { user, sid } = await db.withTransaction(async (c) => {
    const { rows: [u] } = await c.query(`SELECT * FROM users WHERE id = $1 FOR NO KEY UPDATE`, [sub]);
    if (!u?.is_active) throw forbidden('تم إيقاف هذا الحساب، تواصل مع الدعم', 'ACCOUNT_DISABLED');
    const device = await devices.addDevice(c, u, dk, req);
    return { user: u, sid: await devices.startSession(c, u.id, device, req) };
  });
  res.json({ token: signToken(user, sid), user: profile(user), message: 'تم تأكيد الجهاز' });
});

router.post('/resend-device-otp', otpLimiter, validate({ body: z.object({ device_token: z.string().min(10).max(1000) }) }), async (req, res) => {
  const { sub } = verifyDeviceToken(req.body.device_token);
  const { rows: [u] } = await db.query(`SELECT id, email FROM users WHERE id = $1 AND is_active`, [sub]);
  if (!u) throw unauthorized();
  const code = await issueOtp(db, u.id, 'new_device');
  await sendOtpEmail(u.email, code, 'new_device');
  res.json({ message: 'أرسلنا رمز جديد', ...devOtp(code) });
});

/** The student's devices (max 2) — they can remove the other one, a limited number of times a month. */
router.get('/devices', authenticate, async (req, res) => {
  const list = await devices.listDevices(db, req.user.id);
  res.json({
    devices: list.map((d) => ({ id: d.id, name: d.name, created_at: d.created_at, last_seen_at: d.last_seen_at, current: d.id === req.user.active_device_id })),
    max: devices.MAX_DEVICES,
    removals_left: await devices.removalsLeft(db, req.user.id),
    removals_per_month: devices.REMOVALS_PER_MONTH,
  });
});

router.delete('/devices/:id', authenticate, validate({ params: idParam }), async (req, res) => {
  res.json(await devices.removeByStudent(req.user.id, req.p.id, req.user.active_device_id));
});

router.post('/forgot-password', otpLimiter, validate({ body: z.object({ email }) }), async (req, res) => {
  const user = await findByEmail(req.body.email);
  let code;
  if (user && user.is_active && user.password_hash) {
    code = await issueOtp(db, user.id, 'reset_password');
    await sendOtpEmail(user.email, code, 'reset_password');
  }
  res.json({ message: 'إذا كان البريد مسجلاً فسيصلك رمز لإعادة تعيين كلمة المرور', ...(code ? devOtp(code) : {}) });
});

router.post('/reset-password', authLimiter, validate({ body: z.object({ email, code: otpCode, new_password: password }) }), async (req, res) => {
  const user = await findByEmail(req.body.email);
  if (!user?.password_hash) throw badRequest('رمز التحقق غير صالح');
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
