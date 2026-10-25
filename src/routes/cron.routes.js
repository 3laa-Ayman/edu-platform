const crypto = require('crypto');
const router = require('express').Router();
const { JOBS, runJob } = require('../jobs');
const { notFound, unauthorized } = require('../utils/errors');

/**
 * Vercel Cron calls GET /api/cron/<job> with "Authorization: Bearer <CRON_SECRET>".
 * Disabled entirely when CRON_SECRET is not set.
 */
router.get('/:job', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !Object.hasOwn(JOBS, req.params.job)) throw notFound();
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(req.headers.authorization || '');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw unauthorized();
  res.json({ job: req.params.job, result: await runJob(req.params.job) });
});

module.exports = router;
