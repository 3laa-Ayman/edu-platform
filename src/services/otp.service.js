const crypto = require('crypto');
const env = require('../config/env');
const db = require('../config/db');
const { badRequest, tooMany } = require('../utils/errors');

const generateCode = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
const hashCode = (userId, code) => crypto.createHmac('sha256', env.jwtSecret).update(`${userId}:${code}`).digest('hex');

/** Creates a fresh OTP (invalidating previous ones). Only the HMAC of the code is stored. */
async function issueOtp(client, userId, purpose) {
  const { rows } = await client.query(
    `SELECT created_at FROM otp_codes WHERE user_id = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose],
  );
  if (rows[0] && Date.now() - rows[0].created_at.getTime() < env.otp.resendCooldownSec * 1000) {
    throw tooMany(`انتظر ${env.otp.resendCooldownSec} ثانية قبل طلب رمز جديد`);
  }
  await client.query(
    `UPDATE otp_codes SET consumed_at = now() WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose],
  );
  const code = generateCode();
  await client.query(
    `INSERT INTO otp_codes (user_id, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [userId, purpose, hashCode(userId, code), env.otp.ttlMinutes],
  );
  return code;
}

/**
 * Verifies and consumes an OTP. Deliberately NOT inside a caller's transaction so that the
 * failed-attempt counter persists even when the request ends with an error.
 */
async function consumeOtp(userId, purpose, code) {
  const { rows } = await db.query(
    `SELECT id, code_hash, attempts, expires_at FROM otp_codes
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose],
  );
  const otp = rows[0];
  if (!otp || otp.expires_at < new Date()) throw badRequest('رمز التحقق غير صالح أو منتهي، اطلب رمزاً جديداً');

  const bump = await db.query(
    `UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1 AND attempts < $2 RETURNING attempts`,
    [otp.id, env.otp.maxAttempts],
  );
  if (!bump.rowCount) throw badRequest('تجاوزت عدد المحاولات المسموح، اطلب رمزاً جديداً');

  const expected = Buffer.from(otp.code_hash, 'hex');
  const given = Buffer.from(hashCode(userId, String(code)), 'hex');
  if (!crypto.timingSafeEqual(expected, given)) {
    throw badRequest(`رمز التحقق غير صحيح (متبقي ${env.otp.maxAttempts - bump.rows[0].attempts} محاولات)`);
  }

  const used = await db.query(
    `UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`,
    [otp.id],
  );
  if (!used.rowCount) throw badRequest('تم استخدام هذا الرمز بالفعل');
}

module.exports = { issueOtp, consumeOtp };
