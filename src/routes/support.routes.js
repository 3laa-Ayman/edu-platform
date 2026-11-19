const router = require('express').Router();
const db = require('../config/db');
const { getSettings } = require('../services/settings.service');
const { getActiveSubscription } = require('../middleware/subscription');

/** Egyptian mobile (01xxxxxxxxx / +201… / 201…) → wa.me number (201xxxxxxxxx), or null. */
const waNumber = (phone) => {
  const d = String(phone || '').replace(/\D/g, '').replace(/^0020/, '20');
  if (/^01[0125]\d{8}$/.test(d)) return `2${d}`;
  if (/^201[0125]\d{8}$/.test(d)) return d;
  return null;
};

/**
 * Customer service on WhatsApp, as the admin set it up: on/off, the number, whether students without a subscription
 * get it, and which plans include it (plan feature "priority_support"). The number is only sent to students who
 * have access; others learn which plan includes it.
 */
router.get('/', async (req, res) => {
  const s = await getSettings();
  const number = waNumber(s.support_phone);
  if (!s.support_enabled || !number) return res.json({ enabled: false });
  if (req.user.role === 'admin') return res.json({ enabled: true, available: true, whatsapp_url: `https://wa.me/${number}` });

  const sub = await getActiveSubscription(req.user.id);
  const available = sub ? Boolean(sub.features?.priority_support) : Boolean(s.support_for_unsubscribed);
  if (!available) {
    const { rows: [plan] } = await db.query(
      `SELECT name_ar FROM plans WHERE is_active AND (features ->> 'priority_support')::boolean ORDER BY rank, price_egp LIMIT 1`);
    return res.json({ enabled: true, available: false, plan_name: plan?.name_ar || null });
  }
  const { rows: [u] } = await db.query(`SELECT full_name, student_code FROM users WHERE id = $1`, [req.user.id]);
  const intro = [s.support_message, u && `(${u.full_name}${u.student_code ? ` — ${u.student_code}` : ''})`].filter(Boolean).join('\n');
  res.json({ enabled: true, available: true, whatsapp_url: `https://wa.me/${number}?text=${encodeURIComponent(intro)}` });
});

module.exports = router;
module.exports.waNumber = waNumber;
