/**
 * express-rate-limit store backed by Postgres, so the limits hold across all serverless
 * instances (an in-memory counter would be per instance and easy to bypass).
 * One atomic UPSERT per request: the window restarts when the previous one has expired.
 */
const db = require('../config/db');

class PgStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  key(k) {
    return `${this.prefix}:${k}`.slice(0, 200);
  }

  async get(k) {
    const { rows: [r] } = await db.query(`SELECT hits, reset_at FROM rate_limits WHERE key = $1 AND reset_at > now()`, [this.key(k)]);
    return r ? { totalHits: r.hits, resetTime: r.reset_at } : undefined;
  }

  async increment(k) {
    const { rows: [r] } = await db.query(
      `INSERT INTO rate_limits (key, hits, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
       RETURNING hits, reset_at`,
      [this.key(k), this.windowMs / 1000],
    );
    return { totalHits: r.hits, resetTime: r.reset_at };
  }

  async decrement(k) {
    await db.query(`UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1`, [this.key(k)]);
  }

  async resetKey(k) {
    await db.query(`DELETE FROM rate_limits WHERE key = $1`, [this.key(k)]);
  }
}

module.exports = { PgStore };
