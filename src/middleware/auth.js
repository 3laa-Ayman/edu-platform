const jwt = require('jsonwebtoken');
const env = require('../config/env');
const db = require('../config/db');
const { unauthorized, forbidden } = require('../utils/errors');

const ISSUER = 'edu-platform';

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
    issuer: ISSUER,
    algorithm: 'HS256',
  });
}

/**
 * Short-lived token issued after the email OTP is verified. It can only be used to set the password
 * (POST /auth/set-password) — never as a login token.
 */
const SETUP_AUDIENCE = 'set-password';
function signSetupToken(user) {
  return jwt.sign({ sub: user.id, purpose: SETUP_AUDIENCE }, env.jwtSecret, {
    expiresIn: '30m', issuer: ISSUER, audience: SETUP_AUDIENCE, algorithm: 'HS256',
  });
}
function verifySetupToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'], issuer: ISSUER, audience: SETUP_AUDIENCE });
  } catch {
    throw unauthorized('انتهت صلاحية خطوة التسجيل، اطلب رمز تحقق جديد');
  }
}

/** Verifies the Bearer JWT and loads the user (so disabled accounts / revoked tokens are rejected immediately). */
async function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'], issuer: ISSUER });
  } catch {
    throw unauthorized('انتهت الجلسة أو التوكن غير صالح، سجّل الدخول مرة أخرى');
  }
  if (payload.purpose) throw unauthorized(); // setup tokens are not login tokens

  const { rows } = await db.query(
    `SELECT id, student_code, full_name, email, role, is_verified, is_active, token_version
       FROM users WHERE id = $1`,
    [payload.sub],
  );
  const user = rows[0];
  if (!user || !user.is_active || user.token_version !== payload.tv) throw unauthorized();
  req.user = user;
  next();
}

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) throw forbidden();
  next();
};

module.exports = { signToken, signSetupToken, verifySetupToken, authenticate, requireRole, requireAdmin: requireRole('admin') };
