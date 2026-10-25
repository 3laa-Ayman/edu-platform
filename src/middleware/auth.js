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

module.exports = { signToken, authenticate, requireRole, requireAdmin: requireRole('admin') };
