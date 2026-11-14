const router = require('express').Router();
const { cached } = require('../utils/cache');
const db = require('../config/db');
const { validate, idParam, z } = require('../middleware/validate');
const { requireSubscription } = require('../middleware/subscription');
const svc = require('../services/competition.service');

router.get('/', validate({
  query: z.object({ status: z.enum(['upcoming', 'active', 'finished']).optional(), type: z.enum(['team_weekly', 'individual_monthly']).optional() }),
}), async (req, res) => {
  const { status, type } = req.q;
  await svc.finalizeExpired({ userId: req.user.id });
  const { rows } = await db.query(
    `SELECT c.id, c.title, c.type, c.starts_at, c.ends_at, c.duration_minutes,
            (SELECT COUNT(*) FROM competition_questions cq WHERE cq.competition_id = c.id)::int AS question_count,
            CASE WHEN now() < c.starts_at THEN 'upcoming' WHEN now() > c.ends_at THEN 'finished' ELSE 'active' END AS status,
            e.submitted_at AS my_submitted_at,
            -- the student's score stays hidden until the admin publishes the results
            CASE WHEN c.results_published_at IS NOT NULL OR $4 THEN e.score END AS my_score,
            (c.results_published_at IS NOT NULL) AS results_published
       FROM competitions c
       LEFT JOIN competition_entries e ON e.competition_id = c.id AND e.user_id = $1
      WHERE ($2::text IS NULL OR c.type = $2)
        AND ($3::text IS NULL OR $3 = CASE WHEN now() < c.starts_at THEN 'upcoming' WHEN now() > c.ends_at THEN 'finished' ELSE 'active' END)
      ORDER BY c.starts_at DESC LIMIT 50`,
    [req.user.id, type ?? null, status ?? null, req.user.role === 'admin'],
  );
  res.json({ competitions: rows });
});

router.post('/:id/start', requireSubscription('competitions'), validate({ params: idParam }), async (req, res) => {
  const r = await svc.startEntry(req.p.id, req.user);
  if (r.expired) {
    const hidden = !(await resultsPublished(req.p.id));
    return res.status(409).json({ error: { code: 'TIME_UP', message: 'انتهى وقتك في المسابقة وتم تسليم إجاباتك المحفوظة تلقائياً', details: hidden ? { results_hidden: true } : r.result } });
  }
  return res.json(r);
});

/** Autosave while solving (the page sends changes every few seconds). */
router.put('/:id/answers', validate({
  params: idParam,
  body: z.object({
    answers: z.array(z.object({ question_id: z.coerce.number().int().positive(), choice: z.string().max(3).nullable() })).max(500),
  }),
}), async (req, res) => {
  res.json(await svc.saveDraft(req.p.id, req.user, req.body.answers));
});

router.post('/:id/submit', validate({
  params: idParam,
  body: z.object({
    answers: z.array(z.object({ question_id: z.coerce.number().int().positive(), choice: z.string().max(3).nullable() })).max(500),
  }),
}), async (req, res) => {
  const r = await svc.submitEntry(req.p.id, req.user, req.body.answers);
  // Results hidden until the admin publishes them: the student only learns that the answers were submitted.
  if (!(await resultsPublished(req.p.id))) {
    return res.json({ submitted_at: r.submitted_at, total_questions: r.total_questions, results_hidden: true });
  }
  res.json(r);
});

async function resultsPublished(competitionId) {
  const { rows: [c] } = await db.query(`SELECT results_published_at FROM competitions WHERE id = $1`, [competitionId]);
  return Boolean(c?.results_published_at);
}

router.get('/:id/leaderboard', validate({ params: idParam }), async (req, res) => {
  // Everyone refreshes the ranking at the same moments (end of a competition): computed once per 10 seconds.
  const board = await cached(`leaderboard:${req.p.id}`, 10_000, () => svc.leaderboard(req.p.id));
  if (!board.published && req.user.role !== 'admin') {
    return res.json({ competition: board.competition, published: false, results_hidden: true, individuals: [], teams: board.teams ? [] : undefined });
  }
  res.json(board);
});

router.get('/:id/review', validate({ params: idParam }), async (req, res) => {
  res.json({ answers: await svc.review(req.p.id, req.user.id) });
});

module.exports = router;
