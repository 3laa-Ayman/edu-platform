/**
 * Tiny in-memory cache for data every student reads and that rarely changes (subjects list, announcements,
 * leaderboards). Each server instance keeps its own copy for `ttlMs`; concurrent misses share one DB query.
 * Admin changes clear this instance's cache at once; other instances catch up within the TTL.
 */
const store = new Map(); // key → { value, expires } | { pending }

async function cached(key, ttlMs, load) {
  const hit = store.get(key);
  if (hit?.pending) return hit.pending;
  if (hit && hit.expires > Date.now()) return hit.value;
  const pending = load().then(
    (value) => { store.set(key, { value, expires: Date.now() + ttlMs }); return value; },
    (err) => { store.delete(key); throw err; },
  );
  store.set(key, { pending });
  return pending;
}

/** Clears keys starting with prefix (or everything). */
function invalidate(prefix = '') {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

module.exports = { cached, invalidate };
