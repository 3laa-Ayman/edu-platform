const db = require('../config/db');

/**
 * Wrong-password protection per ACCOUNT (not per IP): many students share one IP (mobile networks, a centre's
 * Wi-Fi), so an IP limit alone would block real students. After MAX_FAILS wrong passwords in WINDOW_MIN minutes
 * only that account is paused; a correct login clears the count. Unknown identifiers are counted the same way,
 * so the answer never reveals whether an account exists. Counters live in rate_limits (shared by all instances).
 */
const MAX_FAILS = 10;
const WINDOW_MIN = 15;

const keyFor = (user, identifier) => `loginfail:${user ? `u${user.id}` : `id:${identifier}`}`;

/** Minutes left if the account is paused, else 0. */
async function lockedFor(key) {
  const { rows: [r] } = await db.query(
    `SELECT hits, CEIL(EXTRACT(EPOCH FROM (reset_at - now())) / 60)::int AS mins FROM rate_limits WHERE key = $1 AND reset_at > now()`, [key]);
  return r && r.hits >= MAX_FAILS ? Math.max(r.mins, 1) : 0;
}

async function recordFailure(key) {
  await db.query(
    `INSERT INTO rate_limits (key, hits, reset_at) VALUES ($1, 1, now() + make_interval(mins => $2))
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END`,
    [key, WINDOW_MIN]);
}

const clearFailures = (key) => db.query(`DELETE FROM rate_limits WHERE key = $1`, [key]);

module.exports = { MAX_FAILS, WINDOW_MIN, keyFor, lockedFor, recordFailure, clearFailures };
