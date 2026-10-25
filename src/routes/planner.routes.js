const router = require('express').Router();
const db = require('../config/db');
const { validate, idParam, z } = require('../middleware/validate');
const { notFound } = require('../utils/errors');

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ بصيغة YYYY-MM-DD');
const taskBody = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(2000).optional().nullable(),
  subject_id: z.number().int().positive().optional().nullable(),
  task_date: date,
  start_time: z.string().regex(/^\d{2}:\d{2}$/, 'الوقت بصيغة HH:MM').optional().nullable(),
  duration_minutes: z.number().int().min(5).max(720).optional().nullable(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

/** Tasks for a day (default today) or a range. */
router.get('/tasks', validate({ query: z.object({ date: date.optional(), from: date.optional(), to: date.optional() }) }), async (req, res) => {
  const from = req.q.from || req.q.date || new Date().toISOString().slice(0, 10);
  const to = req.q.to || req.q.date || from;
  const { rows } = await db.query(
    `SELECT t.*, s.name AS subject FROM study_tasks t LEFT JOIN subjects s ON s.id = t.subject_id
      WHERE t.user_id = $1 AND t.task_date BETWEEN $2 AND $3
      ORDER BY t.task_date, t.start_time NULLS LAST, CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
    [req.user.id, from, to],
  );
  const planned = rows.reduce((s, t) => s + (t.duration_minutes || 0), 0);
  const done = rows.filter((t) => t.is_done).length;
  res.json({
    from, to, tasks: rows,
    summary: { total: rows.length, done, completion_percent: rows.length ? Math.round((done / rows.length) * 100) : 0, planned_minutes: planned },
  });
});

router.post('/tasks', validate({ body: taskBody }), async (req, res) => {
  const b = req.body;
  const { rows: [t] } = await db.query(
    `INSERT INTO study_tasks (user_id, title, notes, subject_id, task_date, start_time, duration_minutes, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [req.user.id, b.title, b.notes ?? null, b.subject_id ?? null, b.task_date, b.start_time ?? null, b.duration_minutes ?? null, b.priority],
  );
  res.status(201).json({ task: t });
});

router.patch('/tasks/:id', validate({ params: idParam, body: taskBody.partial().extend({ is_done: z.boolean().optional() }) }), async (req, res) => {
  const b = req.body;
  const { rows: [t] } = await db.query(
    `UPDATE study_tasks SET
        title = COALESCE($3, title), notes = COALESCE($4, notes), subject_id = COALESCE($5, subject_id),
        task_date = COALESCE($6, task_date), start_time = COALESCE($7, start_time),
        duration_minutes = COALESCE($8, duration_minutes), priority = COALESCE($9, priority),
        is_done = COALESCE($10, is_done),
        done_at = CASE WHEN $10 IS TRUE THEN now() WHEN $10 IS FALSE THEN NULL ELSE done_at END
      WHERE id = $1 AND user_id = $2 RETURNING *`,
    [req.p.id, req.user.id, b.title ?? null, b.notes ?? null, b.subject_id ?? null, b.task_date ?? null,
      b.start_time ?? null, b.duration_minutes ?? null, b.priority ?? null, b.is_done ?? null],
  );
  if (!t) throw notFound('المهمة غير موجودة');
  res.json({ task: t });
});

router.delete('/tasks/:id', validate({ params: idParam }), async (req, res) => {
  const r = await db.query(`DELETE FROM study_tasks WHERE id = $1 AND user_id = $2`, [req.p.id, req.user.id]);
  if (!r.rowCount) throw notFound('المهمة غير موجودة');
  res.status(204).end();
});

module.exports = router;
