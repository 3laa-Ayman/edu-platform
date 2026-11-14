const db = require('../config/db');

/**
 * Personal notifications shown under the 🔔 and on top of the home page until read.
 * kind: payment_approved | payment_rejected | subscription_granted | results_published | subscription_expiring
 */
async function notify(client, userId, { kind, title, body = null, link = null, tone = 'info' }) {
  await client.query(
    `INSERT INTO notifications (user_id, kind, title, body, link, tone) VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, kind, title, body, link, tone]);
}

const fmtDay = (d) => new Date(d).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' });

/** A subscription started (payment accepted / online payment / admin gift). */
async function notifySubscription(client, userId, subscription, kind) {
  const { rows: [p] } = await client.query(`SELECT name_ar FROM plans WHERE code = $1`, [subscription.plan_code]);
  const plan = p?.name_ar || subscription.plan_code;
  await notify(client, userId, kind === 'subscription_granted'
    ? { kind, tone: 'success', link: '#/', title: `🎁 تم تفعيل اشتراك ${plan}`, body: `اشتراكك ساري لحد ${fmtDay(subscription.ends_at)}.` }
    : { kind, tone: 'success', link: '#/', title: `✅ تم قبول الدفع وتفعيل اشتراك ${plan}`, body: `اشتراكك ساري لحد ${fmtDay(subscription.ends_at)}. مذاكرة موفقة!` });
}

/** Results announced: every student who took part gets one notification (not again if announced twice). */
async function notifyResults(client, competition) {
  const link = `#/competition/${competition.id}`;
  const { rowCount } = await client.query(
    `INSERT INTO notifications (user_id, kind, title, body, link, tone)
     SELECT e.user_id, 'results_published', $2::varchar, 'ادخل شوف درجتك وترتيبك والإجابات الصحيحة.', $3::varchar, 'success'
       FROM competition_entries e
      WHERE e.competition_id = $1 AND e.submitted_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = e.user_id AND n.kind = 'results_published' AND n.link = $3::varchar)`,
    [competition.id, `📢 نتيجة «${competition.title}» اتعلنت`, link]);
  return rowCount;
}

/**
 * Daily: subscriptions ending within 3 days that weren't renewed (no later subscription) → one reminder each.
 * Returns how many were sent.
 */
async function remindExpiringSubscriptions(client = db) {
  const { rows } = await client.query(
    `UPDATE subscriptions s SET reminder_sent_at = now()
       FROM plans p
      WHERE p.code = s.plan_code AND s.status = 'active' AND s.reminder_sent_at IS NULL
        AND s.ends_at > now() AND s.ends_at <= now() + interval '3 days'
        AND NOT EXISTS (SELECT 1 FROM subscriptions s2 WHERE s2.user_id = s.user_id AND s2.status = 'active'
                          AND s2.id <> s.id AND s2.ends_at > s.ends_at)
      RETURNING s.user_id, s.ends_at, p.name_ar`);
  for (const r of rows) {
    await notify(client, r.user_id, {
      kind: 'subscription_expiring', tone: 'warning', link: '#/subscribe',
      title: `⏰ اشتراك ${r.name_ar} هيخلص يوم ${fmtDay(r.ends_at)}`,
      body: 'جدّد دلوقتي عشان ماتوقفش عن المذاكرة — التجديد بيتضاف على المدة اللي فاضلة.',
    });
  }
  return rows.length;
}

module.exports = { notify, notifySubscription, notifyResults, remindExpiringSubscriptions };
