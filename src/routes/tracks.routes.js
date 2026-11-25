const router = require('express').Router();
const db = require('../config/db');
const { validate, z } = require('../middleware/validate');
const { conflict, notFound } = require('../utils/errors');
const { invalidate } = require('../utils/cache');

/** The tracks with their own subjects (common subjects are listed once, for every track). */
router.get('/', async (req, res) => {
  const { rows: tracks } = await db.query(
    `SELECT t.id, t.name,
            COALESCE((SELECT json_agg(s.name ORDER BY s.name) FROM track_subjects ts JOIN subjects s ON s.id = ts.subject_id
                       WHERE ts.track_id = t.id), '[]') AS subjects
       FROM tracks t ORDER BY t.sort, t.id`);
  const { rows: common } = await db.query(
    `SELECT s.name FROM subjects s WHERE NOT EXISTS (SELECT 1 FROM track_subjects ts WHERE ts.subject_id = s.id) ORDER BY s.name`);
  const { rows: [me] } = await db.query(`SELECT track_id FROM users WHERE id = $1`, [req.user.id]);
  res.json({ tracks, common_subjects: common.map((s) => s.name), my_track_id: me?.track_id ?? null });
});

/** The student picks their track — once; changing it later goes through the admin. */
router.post('/choose', validate({ body: z.object({ track_id: z.number().int().positive() }) }), async (req, res) => {
  const { rows: [t] } = await db.query(`SELECT id, name FROM tracks WHERE id = $1`, [req.body.track_id]);
  if (!t) throw notFound('النظام غير موجود');
  const r = await db.query(`UPDATE users SET track_id = $2, updated_at = now() WHERE id = $1 AND role = 'student' AND track_id IS NULL`,
    [req.user.id, t.id]);
  if (!r.rowCount) throw conflict('اخترت نظامك من قبل — لتغييره تواصل مع الإدارة');
  invalidate();
  res.json({ track: t });
});

module.exports = router;
