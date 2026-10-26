const db = require('../config/db');
const { forbidden } = require('../utils/errors');

const FEATURE_NAMES = {
  ai_explanations: 'الشرح بالذكاء الاصطناعي',
  past_exams: 'أسئلة الامتحانات السابقة',
  practice: 'التدريب',
  mistakes_bank: 'بنك الأخطاء',
  competitions: 'المسابقات',
  parent_reports: 'تقارير ولي الأمر',
};

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
    // Name the cheapest plan that includes the feature: "يلزم اشتراك Premium …".
    const { rows: [plan] } = await db.query(
      `SELECT code, name_ar FROM plans WHERE is_active AND (features ->> $1)::boolean ORDER BY rank, price_egp LIMIT 1`, [feature]);
    const what = FEATURE_NAMES[feature] ? ` لاستخدام ${FEATURE_NAMES[feature]}` : '';
    throw forbidden(plan ? `يلزم اشتراك ${plan.name_ar}${what}` : 'هذه الميزة غير متاحة في باقتك الحالية — قم بالترقية',
      'PLAN_UPGRADE_REQUIRED', plan ? { plan_code: plan.code, plan_name: plan.name_ar } : undefined);
  }
  req.subscription = sub;
  next();
};

module.exports = { getActiveSubscription, requireSubscription };
