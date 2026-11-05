const nodemailer = require('nodemailer');
const env = require('../config/env');

const transporter = env.smtp.host
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null;

/** Sends an email via SMTP, or prints it to the console when SMTP is not configured (development). */
async function sendEmail({ to, subject, text, html }) {
  if (!transporter) {
    console.log(`\n[mail:console] to=${to}\nsubject: ${subject}\n${text}\n`);
    return { channel: 'log' };
  }
  await transporter.sendMail({ from: env.mailFrom, to, subject, text, html });
  return { channel: 'email' };
}

/**
 * SMS / WhatsApp placeholder. Plug a provider here (e.g. Twilio, Vonage, an Egyptian SMS gateway,
 * or the WhatsApp Cloud API). Until then the message is logged.
 */
async function sendSms(phone, text) {
  console.log(`\n[sms:console] to=${phone}\n${text}\n`);
  return { channel: 'log' };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Verification code email. A complete, branded message (not just a bare code) with a plain-text twin: thin
 * code-only emails from a new sender are a classic spam signal.
 */
async function sendOtpEmail(to, code, purpose) {
  const { getSettings } = require('./settings.service');
  const site = (await getSettings().catch(() => ({}))).site_name || 'المنصة';
  const title = { reset_password: 'إعادة تعيين كلمة المرور', new_device: 'تسجيل دخول من جهاز جديد' }[purpose] || 'تأكيد البريد الإلكتروني';
  const why = {
    reset_password: `طلبت تغيير كلمة المرور لحسابك على ${site}.`,
    new_device: `فيه محاولة دخول لحسابك على ${site} من جهاز جديد.`,
  }[purpose] || `شكراً لتسجيلك في ${site}! فاضل خطوة واحدة: تأكيد بريدك الإلكتروني.`;
  const warn = purpose === 'new_device'
    ? 'لو مش انت اللي بتحاول تدخل، ماتديش الرمز لحد وغيّر كلمة المرور فوراً.'
    : 'لو مش انت اللي طلبت ده، تجاهل الرسالة دي ومحدش هيقدر يستخدم حسابك.';
  const text = [
    `${site} — ${title}`, '', why, '',
    `رمز التحقق: ${code}`,
    `الرمز صالح لمدة ${env.otp.ttlMinutes} دقائق، ولا تشاركه مع أي شخص.`, '',
    warn, '', `فريق ${site}`,
  ].join('\n');
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f5f6fa;font-family:Tahoma,Arial,sans-serif;color:#1c2033">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px;border:1px solid #e3e6ef">
    <div style="font-size:20px;font-weight:bold;color:#4f46e5;margin-bottom:16px">${escapeHtml(site)}</div>
    <h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(title)}</h2>
    <p style="margin:0 0 18px;line-height:1.7">${escapeHtml(why)}</p>
    <p style="margin:0 0 8px">رمز التحقق الخاص بك:</p>
    <div style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;background:#eceafd;color:#1c2033;border-radius:10px;padding:14px;direction:ltr">${escapeHtml(code)}</div>
    <p style="margin:14px 0 0;font-size:13px;color:#6b7088;line-height:1.7">الرمز صالح لمدة ${env.otp.ttlMinutes} دقائق، ولا تشاركه مع أي شخص.<br>${escapeHtml(warn)}</p>
    <p style="margin:22px 0 0;font-size:13px;color:#6b7088">فريق ${escapeHtml(site)}</p>
  </div>
</body></html>`;
  return sendEmail({ to, subject: `${title} — ${site}`, text, html });
}

module.exports = { sendEmail, sendSms, sendOtpEmail };
