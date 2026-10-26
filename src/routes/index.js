const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');

router.use('/auth', require('./auth.routes'));
router.use('/products', require('./products.routes'));
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
router.use('/admin', requireAdmin, require('./admin.routes'), require('./admin-content.routes'), require('./admin-people.routes'));

module.exports = router;
