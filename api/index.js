/**
 * Vercel serverless entry point. The same Express app as src/server.js, without app.listen()/node-cron:
 * the schema is applied (idempotent, advisory-locked) and the admin seeded once per cold start,
 * and scheduled jobs run through Vercel Cron → /api/cron/<job> (see vercel.json).
 */
const app = require('../src/app');
const { migrate, seed } = require('../src/bootstrap');

let ready = null;
const ensureReady = () => {
  ready ??= (async () => {
    await migrate();
    await seed({ log: (m) => console.log('[boot]', m) });
  })().catch((err) => {
    ready = null; // retry on the next request
    throw err;
  });
  return ready;
};

module.exports = async (req, res) => {
  try {
    await ensureReady();
  } catch (err) {
    console.error('[boot] database setup failed', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: { code: 'DB_UNAVAILABLE', message: 'قاعدة البيانات غير متاحة — راجع DATABASE_URL' } }));
    return;
  }
  app(req, res);
};
