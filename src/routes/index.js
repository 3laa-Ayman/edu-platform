const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');

router.use('/auth', require('./auth.routes'));
router.use('/products', require('./products.routes'));
// Question images — public but unguessable (content hash in the URL), cached forever.
router.get('/media/q/:qid/:slot/:hash', async (req, res) => {
  const db = require('../config/db');
  const { SLOTS } = require('../services/media.service');
  const qid = Number(req.params.qid);
  if (!Number.isInteger(qid) || !SLOTS.includes(req.params.slot) || !/^[0-9a-f]{16}$/.test(req.params.hash)) {
    return res.status(404).end();
  }
  const { rows: [m] } = await db.query(
    `SELECT mime, data FROM question_media WHERE question_id = $1 AND slot = $2 AND left(hash, 16) = $3`,
    [qid, req.params.slot, req.params.hash]);
  if (!m) return res.status(404).end();
  return res.type(m.mime).set('Cache-Control', 'public, max-age=31536000, immutable').send(m.data);
});
// Picture of a reading passage / shared figure (same rules as question images).
router.get('/media/p/:pid/:hash', async (req, res) => {
  const db = require('../config/db');
  const pid = Number(req.params.pid);
  if (!Number.isInteger(pid) || !/^[0-9a-f]{16}$/.test(req.params.hash)) return res.status(404).end();
  const { rows: [p] } = await db.query(
    `SELECT image_mime, image_data FROM passages WHERE id = $1 AND image_data IS NOT NULL AND left(image_hash, 16) = $2`,
    [pid, req.params.hash]);
  if (!p) return res.status(404).end();
  return res.type(p.image_mime).set('Cache-Control', 'public, max-age=31536000, immutable').send(p.image_data);
});
router.get('/settings/public', async (req, res) => {
  const { getSettings, publicSettings } = require('../services/settings.service');
  res.json(publicSettings(await getSettings()));
});

// Everything below requires a valid JWT.
router.use(authenticate);
router.use('/catalog', require('./practice.routes').router);   // /catalog/subjects, /catalog/questions, /catalog/answer ...
router.use('/ai', require('./ai.routes'));
router.use('/mistakes', require('./mistakes.routes'));
router.use('/payments', require('./payments.routes'));
router.use('/teams', require('./teams.routes'));
router.use('/competitions', require('./competitions.routes'));
router.use('/planner', require('./planner.routes'));
router.use('/reports', require('./reports.routes'));
router.use('/announcements', require('./announcements.routes'));
router.use('/admin', requireAdmin, require('./admin.routes'), require('./admin-content.routes'), require('./admin-people.routes'));

module.exports = router;
