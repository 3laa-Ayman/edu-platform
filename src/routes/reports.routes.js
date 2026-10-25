const router = require('express').Router();
const db = require('../config/db');
const { validate, z } = require('../middleware/validate');
const { subjectPerformance, overall } = require('../services/stats.service');
const { buildReport, formatReportText, sendParentReport } = require('../services/report.service');
const { tooMany } = require('../utils/errors');

/** Student ratings: accuracy % per subject + overall rating. */
router.get('/performance', async (req, res) => {
  const subjects = await subjectPerformance(req.user.id);
  res.json({ overall: overall(subjects), subjects });
});

/** Preview what the parent will receive. */
router.get('/parent/preview', validate({ query: z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }) }), async (req, res) => {
  const report = await buildReport(req.user.id, req.q.days);
  res.json({ report, text: formatReportText(report) });
});

/** Send the report to the parent now (max once per 24h; the weekly job sends automatically). */
router.post('/parent/send', async (req, res) => {
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
