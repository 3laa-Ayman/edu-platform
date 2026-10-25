const db = require('../config/db');
const { forbidden } = require('../utils/errors');

async function getActiveSubscription(userId) {
  const { rows } = await db.query(
    `SELECT s.id, s.plan_code, s.starts_at, s.ends_at, p.name_ar, p.features, p.rank
       FROM subscriptions s JOIN plans p ON p.code = s.plan_code
      WHERE s.user_id = $1 AND s.status = 'active' AND now() BETWEEN s.starts_at AND s.ends_at
      ORDER BY p.rank DESC, s.ends_at DESC
      LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

/**
 * Requires an active subscription. Optionally require a specific feature flag from plans.features
 * e.g. requireSubscription('past_exams'). Admins bypass.
 */
const requireSubscription = (feature) => async (req, res, next) => {
  if (req.user.role === 'admin') return next();
  const sub = await getActiveSubscription(req.user.id);
  if (!sub) throw forbidden('هذه الميزة تتطلب اشتراكاً فعالاً', 'SUBSCRIPTION_REQUIRED');
  if (feature && !sub.features?.[feature]) {
    throw forbidden('هذه الميزة متاحة في اشتراك البريميم فقط', 'PLAN_UPGRADE_REQUIRED');
  }
  req.subscription = sub;
  next();
};

module.exports = { getActiveSubscription, requireSubscription };
