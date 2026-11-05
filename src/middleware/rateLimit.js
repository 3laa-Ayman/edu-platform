const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { PgStore } = require('./rateLimitStore');

const message = (msg) => ({ error: { code: 'TOO_MANY_REQUESTS', message: msg } });
const base = { standardHeaders: 'draft-8', legacyHeaders: false };
// Security-sensitive limits are shared through Postgres (all instances see the same counters).
// If the database is briefly unreachable the request is let through rather than failing.
const shared = (prefix) => ({ store: new PgStore(prefix), passOnStoreError: true });
/*
 * Many real students share ONE IP in Egypt (mobile carrier NAT, a centre's or school's Wi-Fi), so per-IP limits are
 * high and only stop automated abuse; the real protections are per account (wrong passwords: login-guard.js,
 * email codes: 5 tries per code + 1 min between codes) and per signed-in student for general traffic.
 * The auth IP limit is configurable (e.g. raised for automated tests).
 */
const AUTH_LIMIT = Number(process.env.AUTH_RATE_LIMIT) || 300;

// Keyed by user id when authenticated, else by IP (IPv6-safe helper).
const userOrIp = (req) => (req.user ? `u:${req.user.id}` : ipKeyGenerator(req.ip));

// The general limiter runs before authentication: a VALID token (signature checked, cheap) gives the student their
// own budget; anything else is counted per IP. A forged token can't escape the IP budget.
function tokenUser(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    const p = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    return p.purpose ? null : p.sub;
  } catch { return null; }
}
const userOrIpKey = (req) => {
  const sub = tokenUser(req);
  return sub ? `u:${sub}` : `ip:${ipKeyGenerator(req.ip)}`;
};

module.exports = {
  // Per signed-in student 600 / 15 min; a whole IP (shared by many students) 5000.
  globalLimiter: rateLimit({
    ...base, windowMs: 15 * 60 * 1000, keyGenerator: userOrIpKey,
    limit: (req) => (userOrIpKey(req).startsWith('u:') ? 600 : 5000),
    message: message('طلبات كثيرة جداً، حاول بعد قليل'),
  }),
  authLimiter: rateLimit({ ...base, ...shared('auth'), windowMs: 15 * 60 * 1000, limit: AUTH_LIMIT, message: message('محاولات كثيرة من نفس الشبكة، حاول بعد شوية') }),
  otpLimiter: rateLimit({ ...base, ...shared('otp'), windowMs: 60 * 60 * 1000, limit: 100, message: message('طلبات رمز تحقق كثيرة من نفس الشبكة، حاول لاحقاً') }),
  aiLimiter: rateLimit({ ...base, ...shared('ai'), windowMs: 60 * 1000, limit: 10, keyGenerator: userOrIp, message: message('طلبات شرح كثيرة، انتظر دقيقة') }),
  uploadLimiter: rateLimit({ ...base, ...shared('upload'), windowMs: 60 * 60 * 1000, limit: 20, keyGenerator: userOrIp, message: message('عمليات رفع كثيرة') }),
  webhookLimiter: rateLimit({ ...base, windowMs: 60 * 1000, limit: 300 }),
};
