const router = require('express').Router();
const env = require('../config/env');
const db = require('../config/db');
const { validate, z } = require('../middleware/validate');
const { subjectPerformance, overall } = require('../services/stats.service');
const { buildReport, formatReportText, sendParentReport } = require('../services/report.service');
const { tooMany } = require('../utils/errors');
const { requireSubscription } = require('../middleware/subscription');

/** Student ratings: accuracy % per subject + overall rating. */
router.get('/performance', async (req, res) => {
  const [subjects, { rows: [today] }] = await Promise.all([
    subjectPerformance(req.user.id),
    // Answers given today (Cairo time) — skipped questions are never recorded, so they don't count.
    db.query(
      `SELECT COUNT(*)::int AS answered, COUNT(*) FILTER (WHERE is_correct)::int AS correct
         FROM attempts
        WHERE user_id = $1 AND selected_option IS NOT NULL
          AND created_at >= (date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)`,
      [req.user.id, env.tz]),
  ]);
  res.json({ overall: overall(subjects), subjects, today });
});

/** Preview what the parent will receive. */
router.get('/parent/preview', validate({ query: z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }) }), async (req, res) => {
  const report = await buildReport(req.user.id, req.q.days);
  res.json({ report, text: formatReportText(report) });
});

/** Send the report to the parent now (max once per 24h; the weekly job sends automatically). */
router.post('/parent/send', requireSubscription('parent_reports'), async (req, res) => {
  const { rowCount } = await db.query(
    `SELECT 1 FROM parent_reports WHERE user_id = $1 AND status = 'sent' AND sent_at > now() - interval '24 hours'`, [req.user.id]);
  if (rowCount) throw tooMany('تم إرسال تقرير لولي الأمر خلال آخر 24 ساعة');
  const { status, channel } = await sendParentReport(req.user.id);
  res.json({ status, channel });
});

router.get('/parent/history', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, period_start, period_end, channel, status, sent_at FROM parent_reports WHERE user_id = $1 ORDER BY sent_at DESC LIMIT 50`,
    [req.user.id]);
  res.json({ reports: rows });
});

module.exports = router;
