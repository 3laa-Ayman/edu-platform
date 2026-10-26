const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { PgStore } = require('./rateLimitStore');

const message = (msg) => ({ error: { code: 'TOO_MANY_REQUESTS', message: msg } });
const base = { standardHeaders: 'draft-8', legacyHeaders: false };
// Security-sensitive limits are shared through Postgres (all instances see the same counters).
// If the database is briefly unreachable the request is let through rather than failing.
const shared = (prefix) => ({ store: new PgStore(prefix), passOnStoreError: true });
// Auth limit is configurable (e.g. raised for automated tests); everything else uses fixed defaults.
const AUTH_LIMIT = Number(process.env.AUTH_RATE_LIMIT) || 20;

// Keyed by user id when authenticated, else by IP (IPv6-safe helper).
const userOrIp = (req) => (req.user ? `u:${req.user.id}` : ipKeyGenerator(req.ip));

module.exports = {
  globalLimiter: rateLimit({ ...base, windowMs: 15 * 60 * 1000, limit: 600, message: message('طلبات كثيرة جداً، حاول بعد قليل') }),
  authLimiter: rateLimit({ ...base, ...shared('auth'), windowMs: 15 * 60 * 1000, limit: AUTH_LIMIT, message: message('محاولات دخول كثيرة، حاول بعد 15 دقيقة') }),
  otpLimiter: rateLimit({ ...base, ...shared('otp'), windowMs: 60 * 60 * 1000, limit: 10, message: message('طلبات رمز تحقق كثيرة، حاول لاحقاً') }),
  aiLimiter: rateLimit({ ...base, ...shared('ai'), windowMs: 60 * 1000, limit: 10, keyGenerator: userOrIp, message: message('طلبات شرح كثيرة، انتظر دقيقة') }),
  uploadLimiter: rateLimit({ ...base, ...shared('upload'), windowMs: 60 * 60 * 1000, limit: 20, keyGenerator: userOrIp, message: message('عمليات رفع كثيرة') }),
  webhookLimiter: rateLimit({ ...base, windowMs: 60 * 1000, limit: 300 }),
};
