const router = require('express').Router();
const db = require('../config/db');
const { validate, idParam } = require('../middleware/validate');

/** The student's own notifications (newest first) + how many are unread. */
router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, kind, title, body, link, tone, created_at, (read_at IS NOT NULL) AS is_read
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [req.user.id]);
  const { rows: [u] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [req.user.id]);
  res.json({ notifications: rows, unread: u.n });
});

router.post('/:id/read', validate({ params: idParam }), async (req, res) => {
  await db.query(`UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2`, [req.p.id, req.user.id]);
  res.status(204).end();
});

router.post('/read-all', async (req, res) => {
  await db.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [req.user.id]);
  res.status(204).end();
});

module.exports = router;
