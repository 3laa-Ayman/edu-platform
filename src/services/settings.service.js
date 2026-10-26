/**
 * Platform settings editable from the admin dashboard (stored in the `settings` table).
 * Environment variables only provide the initial defaults.
 */
const { z } = require('zod');
const env = require('../config/env');
const db = require('../config/db');

const SCHEMA = z.object({
  site_name: z.string().trim().min(2).max(60),
  support_phone: z.string().trim().max(30),
  vodafone_cash_number: z.string().trim().max(30),
  instapay_address: z.string().trim().max(80),
  manual_payment_instructions: z.string().trim().max(500),
  default_ai_limit_egp: z.number().min(0).max(10000),
  usd_to_egp: z.number().positive().max(10000),
  ai_points_per_egp: z.number().int().min(1).max(100000),
});

const defaults = () => ({
  site_name: 'منصة المذاكرة',
  support_phone: '',
  vodafone_cash_number: env.manualPayment.vodafoneCashNumber || '',
  instapay_address: env.manualPayment.instapayAddress || '',
  manual_payment_instructions: 'حوّل المبلغ ثم ارفع صورة الإيصال مع رقم العملية، وسيتم التفعيل بعد مراجعة الإدارة.',
  default_ai_limit_egp: env.aiLimitEgp,
  usd_to_egp: env.gemini.usdToEgp,
  // Students see their AI budget in points: 100 points = 1 EGP of model cost (so 100 EGP = 10,000 points).
  ai_points_per_egp: 100,
});

// Short cache: serverless instances pick up admin changes within a few seconds.
const TTL_MS = 10_000;
let cache = null;
let cachedAt = 0;

async function getSettings() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const { rows } = await db.query(`SELECT key, value FROM settings`);
  const out = defaults();
  for (const r of rows) if (r.key in out) out[r.key] = r.value;
  cache = out;
  cachedAt = Date.now();
  return out;
}

async function updateSettings(patch, adminId) {
  const valid = SCHEMA.partial().parse(patch);
  await db.withTransaction(async (c) => {
    for (const [key, value] of Object.entries(valid)) {
      await c.query(
        `INSERT INTO settings (key, value, updated_by) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, JSON.stringify(value), adminId],
      );
    }
  });
  cache = null;
  return getSettings();
}

/** Fields safe to expose without login. */
const publicSettings = (s) => ({ site_name: s.site_name, support_phone: s.support_phone, ai_points_per_egp: s.ai_points_per_egp });

/** EGP amount → points for display, to one decimal (so a 0.3-point request is visible in the balance). */
const toPoints = (egp, rate) => Math.round(Number(egp) * rate * 10) / 10;

module.exports = { getSettings, updateSettings, publicSettings, toPoints, SETTINGS_SCHEMA: SCHEMA };
