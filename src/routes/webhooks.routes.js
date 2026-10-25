const router = require('express').Router();
const db = require('../config/db');
const pay = require('../services/payment.service');

async function logEvent(provider, signatureValid, paymentRef, result, payload) {
  await db.query(
    `INSERT INTO webhook_events (provider, signature_valid, payment_ref, result, payload) VALUES ($1, $2, $3, $4, $5)`,
    [provider, signatureValid, paymentRef, result, JSON.stringify(payload ?? {})],
  );
}

/** Looks up our payment and checks amount + provider match before trusting the callback. */
async function settle(provider, reference, { success, amountEgp, providerTxnId, raw }) {
  const { rows: [p] } = await db.query(
    `SELECT * FROM payments WHERE reference::text = $1 AND provider = $2`, [String(reference), provider]);
  if (!p) return 'payment_not_found';
  if (Math.abs(Number(amountEgp) - p.amount_egp) > 0.009) return 'amount_mismatch';
  if (!success) {
    await db.query(`UPDATE payments SET status = 'failed', raw_payload = $2, updated_at = now() WHERE id = $1 AND status = 'pending'`, [p.id, JSON.stringify(raw)]);
    return 'marked_failed';
  }
  const out = await db.withTransaction((c) => pay.activatePayment(c, p.id, { providerTxnId, rawPayload: raw }));
  return out ? 'activated' : 'already_processed';
}

/**
 * Paymob "Transaction processed callback": POST JSON { type: "TRANSACTION", obj: {...} }, HMAC in ?hmac=
 * Configure in the Paymob dashboard → integration → callback URL: {APP_BASE_URL}/api/webhooks/paymob
 */
router.post('/paymob', async (req, res) => {
  const obj = req.body?.obj;
  const valid = Boolean(obj) && pay.verifyPaymobHmac(obj, req.query.hmac);
  const reference = obj?.order?.merchant_order_id || obj?.special_reference || null;
  if (!valid) {
    await logEvent('paymob', false, reference, 'invalid_signature', req.body);
    return res.status(401).json({ ok: false });
  }
  const result = await settle('paymob', reference, {
    success: obj.success === true && obj.pending === false && !obj.is_voided && !obj.is_refunded,
    amountEgp: obj.amount_cents / 100,
    providerTxnId: String(obj.id),
    raw: req.body,
  });
  await logEvent('paymob', true, reference, result, req.body);
  res.json({ ok: true, result });
});

/** Fawry V2 server notification (configure the notification URL in the Fawry merchant portal). */
router.post('/fawry', async (req, res) => {
  const b = req.body || {};
  const valid = pay.verifyFawrySignature(b);
  if (!valid) {
    await logEvent('fawry', false, b.merchantRefNumber, 'invalid_signature', b);
    return res.status(401).json({ ok: false });
  }
  const status = String(b.orderStatus || '').toUpperCase();
  // NEW/UNPAID = reference created but not paid yet; EXPIRED/FAILED/CANCELED → failed.
  const result = ['NEW', 'UNPAID'].includes(status)
    ? 'ignored_status'
    : await settle('fawry', b.merchantRefNumber, { success: status === 'PAID', amountEgp: b.orderAmount, providerTxnId: String(b.fawryRefNumber), raw: b });
  await logEvent('fawry', true, b.merchantRefNumber, result, b);
  res.json({ ok: true, result });
});

module.exports = router;
