const router = require('express').Router();
const env = require('../config/env');
const db = require('../config/db');
const { validate, z } = require('../middleware/validate');
const { receiptUpload } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimit');
const { getActiveSubscription } = require('../middleware/subscription');
const { getSettings } = require('../services/settings.service');
const pay = require('../services/payment.service');
const { badRequest, notFound, conflict } = require('../utils/errors');

async function getPlan(code) {
  const { rows } = await db.query(`SELECT * FROM plans WHERE code = $1 AND is_active`, [code]);
  if (!rows[0]) throw badRequest('خطة الاشتراك غير موجودة');
  return rows[0];
}

const publicPayment = (p) => ({
  reference: p.reference, plan_code: p.plan_code, amount_egp: p.amount_egp, provider: p.provider,
  status: p.status, admin_note: p.admin_note, created_at: p.created_at, paid_at: p.paid_at,
});

router.get('/plans', async (req, res) => {
  const [{ rows }, s] = await Promise.all([
    db.query(`SELECT code, name_ar, price_egp, duration_days, features FROM plans WHERE is_active ORDER BY rank`),
    getSettings(),
  ]);
  res.json({
    plans: rows,
    manual_payment: {
      vodafone_cash: s.vodafone_cash_number,
      instapay: s.instapay_address,
      instructions: s.manual_payment_instructions,
    },
  });
});

router.get('/me', async (req, res) => {
  const [current, history, payments] = await Promise.all([
    getActiveSubscription(req.user.id),
    db.query(`SELECT plan_code, starts_at, ends_at, status FROM subscriptions WHERE user_id = $1 ORDER BY starts_at DESC`, [req.user.id]),
    db.query(
      `SELECT reference, plan_code, amount_egp, provider, status, admin_note, created_at, paid_at
         FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id],
    ),
  ]);
  res.json({ current, history: history.rows, payments: payments.rows.map(publicPayment) });
});

/** Online payment (Paymob card/wallet, or Fawry reference) — activation happens automatically via webhook. */
router.post('/checkout', validate({
  body: z.object({ plan_code: z.string(), provider: z.enum(['paymob', 'fawry']) }),
}), async (req, res) => {
  const plan = await getPlan(req.body.plan_code);
  const { rows: [u] } = await db.query(`SELECT id, full_name, email, phone FROM users WHERE id = $1`, [req.user.id]);
  const { rows: [payment] } = await db.query(
    `INSERT INTO payments (user_id, plan_code, amount_egp, provider, method_type) VALUES ($1, $2, $3, $4, 'gateway') RETURNING *`,
    [u.id, plan.code, plan.price_egp, req.body.provider],
  );
  try {
    const gateway = req.body.provider === 'paymob' ? await pay.createPaymobCheckout(payment, u) : await pay.createFawryCharge(payment, u);
    if (gateway.fawry_reference) {
      await db.query(`UPDATE payments SET provider_txn_id = $2 WHERE id = $1`, [payment.id, String(gateway.fawry_reference)]);
    }
    res.status(201).json({ payment: publicPayment(payment), ...gateway });
  } catch (err) {
    await db.query(`UPDATE payments SET status = 'failed', admin_note = $2, updated_at = now() WHERE id = $1`, [payment.id, err.message]);
    throw err;
  }
});

/** Manual transfer (Vodafone Cash / InstaPay): upload receipt → admin reviews → activation. */
router.post('/manual', uploadLimiter, receiptUpload.single('receipt'), async (req, res) => {
  if (!req.file) throw badRequest('ارفع صورة الإيصال في الحقل receipt');
  const body = z.object({
    plan_code: z.string(),
    provider: z.enum(['vodafone_cash', 'instapay']),
    sender_account: z.string().trim().min(5).max(60),
    transfer_ref: z.string().trim().max(120).optional(),
  }).parse(req.body);
  const plan = await getPlan(body.plan_code);

  const pending = await db.query(
    `SELECT 1 FROM payments WHERE user_id = $1 AND status = 'under_review' LIMIT 1`, [req.user.id]);
  if (pending.rowCount) throw conflict('لديك إيصال قيد المراجعة بالفعل، انتظر رد الإدارة');

  const { rows: [payment] } = await db.query(
    `INSERT INTO payments (user_id, plan_code, amount_egp, provider, method_type, status, receipt_data, receipt_mime, sender_account, transfer_ref)
     VALUES ($1, $2, $3, $4, 'manual', 'under_review', $5, $6, $7, $8) RETURNING *`,
    [req.user.id, plan.code, plan.price_egp, body.provider, req.file.buffer, req.file.mimetype, body.sender_account, body.transfer_ref || null],
  );
  res.status(201).json({ message: 'تم استلام الإيصال وسيتم مراجعته وتفعيل الاشتراك قريباً', payment: publicPayment(payment) });
});

// Development helper: simulate a successful gateway callback when no gateway keys are configured.
if (env.allowMocks) {
  router.post('/:reference/dev-simulate-paid', validate({ params: z.object({ reference: z.string().uuid() }) }), async (req, res) => {
    const { rows: [p] } = await db.query(`SELECT * FROM payments WHERE reference = $1 AND user_id = $2`, [req.p.reference, req.user.id]);
    if (!p) throw notFound('عملية الدفع غير موجودة');
    // Only for payments made while the gateway is not configured (mock checkout) — never bypasses a real gateway.
    const configured = { paymob: env.paymob.secretKey, fawry: env.fawry.merchantCode }[p.provider];
    if (p.method_type !== 'gateway' || configured) throw badRequest('المحاكاة متاحة فقط للدفع التجريبي');
    const out = await db.withTransaction((c) => pay.activatePayment(c, p.id, { providerTxnId: `dev-${Date.now()}`, rawPayload: { dev: true } }));
    res.json({ activated: Boolean(out), subscription: out?.subscription ?? null });
  });
}

module.exports = router;
