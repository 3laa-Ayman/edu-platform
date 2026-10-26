const router = require('express').Router();
const db = require('../config/db');
const { validate, idParam } = require('../middleware/validate');
const { aiLimiter } = require('../middleware/rateLimit');
const { requireSubscription } = require('../middleware/subscription');
const { getQuestion } = require('./practice.routes');
const { explainWithBudget } = require('../services/ai.service');
const { badRequest } = require('../utils/errors');
const { getSettings, toPoints } = require('../services/settings.service');

/**
 * Explanation flow (cheapest first):
 *   1. saved explanation in the question bank → free
 *   2. AI explanation already generated for this question by anyone → free
 *   3. Gemini call → tokens counted, cost added to the student's balance, blocked at the cap (100 EGP)
 */
router.post('/explain/:id', aiLimiter, requireSubscription('ai_explanations'), validate({ params: idParam }), async (req, res) => {
  const q = await getQuestion(req.p.id);
  const answered = await db.query(`SELECT 1 FROM attempts WHERE user_id = $1 AND question_id = $2 LIMIT 1`, [req.user.id, q.id]);
  if (!answered.rowCount && req.user.role !== 'admin') throw badRequest('أجب على السؤال أولاً لطلب الشرح');

  if (q.explanation) {
    return res.json({ source: 'question_bank', explanation: q.explanation, law_note: q.law_note, usage: { cost_egp: 0 } });
  }
  const { rows: [cached] } = await db.query(`SELECT content FROM ai_explanations WHERE question_id = $1`, [q.id]);
  if (cached) return res.json({ source: 'ai_cache', explanation: cached.content, law_note: q.law_note, usage: { cost_egp: 0 } });

  res.json(await explainWithBudget(req.user.id, q));
});

router.get('/usage', async (req, res) => {
  const { rows: [u] } = await db.query(`SELECT ai_spent_egp, ai_limit_egp FROM users WHERE id = $1`, [req.user.id]);
  const { rows: [totals] } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'success')::int AS requests,
            COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
            COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
            COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked_requests
       FROM ai_usage_logs WHERE user_id = $1`,
    [req.user.id],
  );
  const remaining = Math.max(u.ai_limit_egp - u.ai_spent_egp, 0);
  const { ai_points_per_egp: rate } = await getSettings();
  res.json({
    spent_points: toPoints(u.ai_spent_egp, rate),
    limit_points: toPoints(u.ai_limit_egp, rate),
    remaining_points: toPoints(remaining, rate),
    points_per_egp: rate,
    spent_egp: Number(u.ai_spent_egp.toFixed(4)),
    limit_egp: u.ai_limit_egp,
    remaining_egp: Number(remaining.toFixed(4)),
    used_percent: Math.round((u.ai_spent_egp / u.ai_limit_egp) * 1000) / 10,
    ...totals,
  });
});

module.exports = router;
