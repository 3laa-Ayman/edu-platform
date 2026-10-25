const router = require('express').Router();
const db = require('../config/db');
const { validate, idParam, z } = require('../middleware/validate');
const { requireSubscription } = require('../middleware/subscription');
const svc = require('../services/competition.service');

router.get('/', validate({
  query: z.object({ status: z.enum(['upcoming', 'active', 'finished']).optional(), type: z.enum(['team_weekly', 'individual_monthly']).optional() }),
}), async (req, res) => {
  const { status, type } = req.q;
  const { rows } = await db.query(
    `SELECT c.id, c.title, c.type, c.starts_at, c.ends_at, c.duration_minutes,
            (SELECT COUNT(*) FROM competition_questions cq WHERE cq.competition_id = c.id)::int AS question_count,
            CASE WHEN now() < c.starts_at THEN 'upcoming' WHEN now() > c.ends_at THEN 'finished' ELSE 'active' END AS status,
            e.submitted_at AS my_submitted_at, e.score AS my_score
       FROM competitions c
       LEFT JOIN competition_entries e ON e.competition_id = c.id AND e.user_id = $1
      WHERE ($2::text IS NULL OR c.type = $2)
        AND ($3::text IS NULL OR $3 = CASE WHEN now() < c.starts_at THEN 'upcoming' WHEN now() > c.ends_at THEN 'finished' ELSE 'active' END)
      ORDER BY c.starts_at DESC LIMIT 50`,
    [req.user.id, type ?? null, status ?? null],
  );
  res.json({ competitions: rows });
});

router.post('/:id/start', requireSubscription('competitions'), validate({ params: idParam }), async (req, res) => {
  res.json(await svc.startEntry(req.p.id, req.user));
});

router.post('/:id/submit', validate({
  params: idParam,
  body: z.object({
    answers: z.array(z.object({ question_id: z.coerce.number().int().positive(), choice: z.string().max(3).nullable() })).max(500),
  }),
}), async (req, res) => {
  res.json(await svc.submitEntry(req.p.id, req.user, req.body.answers));
});

router.get('/:id/leaderboard', validate({ params: idParam }), async (req, res) => {
  res.json(await svc.leaderboard(req.p.id));
});

router.get('/:id/review', validate({ params: idParam }), async (req, res) => {
  res.json({ answers: await svc.review(req.p.id, req.user.id) });
});

module.exports = router;
