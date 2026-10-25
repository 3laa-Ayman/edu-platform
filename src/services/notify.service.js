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

async function sendOtpEmail(to, code, purpose) {
  const title = purpose === 'reset_password' ? 'إعادة تعيين كلمة المرور' : 'تأكيد البريد الإلكتروني';
  const text = `${title}\nرمز التحقق الخاص بك: ${code}\nصالح لمدة ${env.otp.ttlMinutes} دقائق. لا تشاركه مع أي شخص.`;
  return sendEmail({ to, subject: `${title} — رمز التحقق`, text, html: `<div dir="rtl"><h3>${title}</h3><p>رمز التحقق:</p><h1>${code}</h1></div>` });
}

module.exports = { sendEmail, sendSms, sendOtpEmail };
