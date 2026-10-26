const crypto = require('crypto');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

const safeEqualHex = (a, b) => {
  const x = Buffer.from(String(a || ''), 'hex');
  const y = Buffer.from(String(b || ''), 'hex');
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Marks a payment as paid and creates/extends the subscription — idempotent:
 * the conditional UPDATE guarantees a webhook retry (or an admin double-click) activates only once.
 * Must be called inside a transaction.
 */
async function activatePayment(client, paymentId, { providerTxnId = null, rawPayload = null, reviewerId = null } = {}) {
  const { rows } = await client.query(
    `UPDATE payments
        SET status = 'paid', paid_at = now(), updated_at = now(),
            provider_txn_id = COALESCE($2, provider_txn_id),
            raw_payload = COALESCE($3, raw_payload),
            reviewed_by = COALESCE($4, reviewed_by),
            reviewed_at = CASE WHEN $4::bigint IS NULL THEN reviewed_at ELSE now() END
      WHERE id = $1 AND status IN ('pending', 'under_review')
      RETURNING *`,
    [paymentId, providerTxnId, rawPayload ? JSON.stringify(rawPayload) : null, reviewerId],
  );
  if (!rows.length) return null; // already processed

  const payment = rows[0];
  const subscription = await grantSubscription(client, { userId: payment.user_id, planCode: payment.plan_code, paymentId: payment.id });
  return { payment, subscription };
}

/**
 * Creates a subscription period. Renewing the same plan extends from the current end date;
 * a different plan (upgrade) starts now. `days` defaults to the plan's duration.
 * Must be called inside a transaction.
 */
async function grantSubscription(client, { userId, planCode, paymentId = null, days = null }) {
  const { rows: [plan] } = await client.query(`SELECT * FROM plans WHERE code = $1`, [planCode]);
  if (!plan) throw new AppError(400, 'الباقة غير موجودة', 'BAD_REQUEST');
  // Serialize per user so two concurrent activations compute the extension correctly.
  await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
  const { rows: [current] } = await client.query(
    `SELECT MAX(ends_at) AS ends_at FROM subscriptions
      WHERE user_id = $1 AND plan_code = $2 AND status = 'active' AND ends_at > now()`,
    [userId, planCode],
  );
  const startsAt = current.ends_at || new Date();
  const { rows: [subscription] } = await client.query(
    `INSERT INTO subscriptions (user_id, plan_code, payment_id, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $4::timestamptz + make_interval(days => $5))
     RETURNING *`,
    [userId, plan.code, paymentId, startsAt, days ?? plan.duration_days],
  );
  return subscription;
}

// ------------------------------------------------------------------ Paymob

/** Paymob "Transaction processed callback" HMAC (SHA-512 over a fixed, ordered list of fields). */
const PAYMOB_HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id',
  'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id',
  'owner', 'pending', 'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
];
const dig = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function paymobHmac(obj) {
  const str = PAYMOB_HMAC_FIELDS.map((f) => String(dig(obj, f) ?? '')).join('');
  return crypto.createHmac('sha512', env.paymob.hmacSecret || '').update(str).digest('hex');
}
const verifyPaymobHmac = (obj, received) => Boolean(env.paymob.hmacSecret) && safeEqualHex(paymobHmac(obj), received);

/** Creates a Paymob payment intention and returns the Unified Checkout URL. */
async function createPaymobCheckout(payment, user) {
  if (!env.paymob.secretKey) return devMock(payment, 'paymob');
  const res = await fetch(`${env.paymob.baseUrl}/v1/intention/`, {
    method: 'POST',
    headers: { Authorization: `Token ${env.paymob.secretKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(payment.amount_egp * 100),
      currency: 'EGP',
      payment_methods: [Number(env.paymob.integrationId)],
      items: [{ name: `subscription-${payment.plan_code}`, amount: Math.round(payment.amount_egp * 100), quantity: 1 }],
      billing_data: {
        first_name: user.full_name.split(' ')[0] || 'Student',
        last_name: user.full_name.split(' ').slice(1).join(' ') || 'Student',
        email: user.email,
        phone_number: user.phone,
      },
      special_reference: payment.reference,
      notification_url: `${env.appBaseUrl}/api/webhooks/paymob`,
      redirection_url: `${env.frontendUrl}/payments/result?ref=${payment.reference}`,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.client_secret) {
    console.error('[paymob] intention failed', res.status, data);
    throw new AppError(502, 'تعذر إنشاء عملية الدفع مع Paymob', 'GATEWAY_ERROR');
  }
  return {
    provider: 'paymob',
    checkout_url: `${env.paymob.baseUrl}/unifiedcheckout/?publicKey=${encodeURIComponent(env.paymob.publicKey)}&clientSecret=${encodeURIComponent(data.client_secret)}`,
  };
}

// ------------------------------------------------------------------ Fawry

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/** Fawry V2 server notification signature. */
function fawryCallbackSignature(b) {
  return sha256(
    `${b.fawryRefNumber ?? ''}${b.merchantRefNumber ?? ''}${Number(b.paymentAmount).toFixed(2)}${Number(b.orderAmount).toFixed(2)}` +
    `${b.orderStatus ?? ''}${b.paymentMethod ?? ''}${b.paymentRefrenceNumber ?? ''}${env.fawry.secureKey || ''}`,
  );
}
const verifyFawrySignature = (body) => Boolean(env.fawry.secureKey) && safeEqualHex(fawryCallbackSignature(body), body.messageSignature);

/** "Pay at Fawry" reference-number charge. The student pays the reference at any Fawry outlet / app. */
async function createFawryCharge(payment, user) {
  if (!env.fawry.merchantCode) return devMock(payment, 'fawry');
  const amount = Number(payment.amount_egp).toFixed(2);
  const paymentMethod = 'PAYATFAWRY';
  const body = {
    merchantCode: env.fawry.merchantCode,
    merchantRefNum: payment.reference,
    customerProfileId: String(user.id),
    customerMobile: user.phone,
    customerEmail: user.email,
    customerName: user.full_name,
    paymentMethod,
    amount: Number(amount),
    currencyCode: 'EGP',
    description: `Subscription ${payment.plan_code}`,
    paymentExpiry: Date.now() + 48 * 3600 * 1000,
    chargeItems: [{ itemId: payment.plan_code, description: payment.plan_code, price: Number(amount), quantity: 1 }],
    signature: sha256(`${env.fawry.merchantCode}${payment.reference}${user.id}${paymentMethod}${amount}${env.fawry.secureKey}`),
  };
  const res = await fetch(`${env.fawry.baseUrl}/ECommerceWeb/Fawry/payments/charge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.statusCode !== 200 || !data.referenceNumber) {
    console.error('[fawry] charge failed', res.status, data);
    throw new AppError(502, 'تعذر إنشاء رقم مرجعي من فوري', 'GATEWAY_ERROR');
  }
  return { provider: 'fawry', fawry_reference: data.referenceNumber, expires_at: new Date(body.paymentExpiry) };
}

function devMock(payment, provider) {
  if (!env.allowMocks) throw new AppError(503, `بوابة ${provider} غير مهيأة`, 'GATEWAY_NOT_CONFIGURED');
  return {
    provider,
    mock: true,
    note: 'Gateway keys are not configured — development mock. Call the dev simulate endpoint to mark it paid.',
    simulate: `POST /api/payments/${payment.reference}/dev-simulate-paid`,
  };
}

module.exports = {
  activatePayment,
  grantSubscription,
  paymobHmac,
  verifyPaymobHmac,
  createPaymobCheckout,
  fawryCallbackSignature,
  verifyFawrySignature,
  createFawryCharge,
};
