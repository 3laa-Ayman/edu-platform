const router = require('express').Router();
const db = require('../config/db');
const { validate, idParam } = require('../middleware/validate');
const { notFound } = require('../utils/errors');

/**
 * Announcements a student can see right now: active, started, not expired, and meant for them
 * (everyone / subscribers only / not-subscribed only).
 */
const VISIBLE = `
  a.is_active AND a.starts_at <= now() AND (a.expires_at IS NULL OR a.expires_at > now())
  AND (a.audience = 'all' OR (a.audience = 'subscribers') = EXISTS (
        SELECT 1 FROM subscriptions s
         WHERE s.user_id = $1 AND s.status = 'active' AND now() BETWEEN s.starts_at AND s.ends_at))`;

router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.id, a.title, a.body, a.tone, a.link_url, a.pinned, a.starts_at,
            (r.user_id IS NOT NULL) AS is_read
       FROM announcements a
       LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = $1
      WHERE ${VISIBLE}
      ORDER BY a.pinned DESC, a.starts_at DESC
      LIMIT 50`,
    [req.user.id]);
  res.json({ announcements: rows, unread: rows.filter((a) => !a.is_read).length });
});

router.post('/:id/read', validate({ params: idParam }), async (req, res) => {
  const { rowCount } = await db.query(
    `INSERT INTO announcement_reads (announcement_id, user_id)
     SELECT a.id, $1 FROM announcements a WHERE a.id = $2 AND ${VISIBLE}
     ON CONFLICT DO NOTHING`,
    [req.user.id, req.p.id]);
  if (!rowCount) {
    const { rows } = await db.query(`SELECT 1 FROM announcement_reads WHERE announcement_id = $1 AND user_id = $2`, [req.p.id, req.user.id]);
    if (!rows[0]) throw notFound('الإعلان غير موجود');
  }
  res.status(204).end();
});

router.post('/read-all', async (req, res) => {
  await db.query(
    `INSERT INTO announcement_reads (announcement_id, user_id)
     SELECT a.id, $1 FROM announcements a WHERE ${VISIBLE}
     ON CONFLICT DO NOTHING`,
    [req.user.id]);
  res.status(204).end();
});

module.exports = router;
