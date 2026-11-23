/**
 * "Sign in with Google": verifies the ID token the Google button gives the browser (signature, audience = our
 * client id, issuer, expiry) and returns the verified Google account. Google has confirmed the email, so no
 * email code is needed.
 *
 * Tests/dev only (never in production): a token "dev:<email>:<name>" stands for a verified Google account.
 */
const { OAuth2Client } = require('google-auth-library');
const env = require('../config/env');
const { badRequest, AppError } = require('../utils/errors');

let client = null;
const enabled = () => Boolean(env.googleClientId);

async function verifyGoogleCredential(credential) {
  if (!enabled()) throw new AppError(404, 'تسجيل الدخول بجوجل غير مفعّل', 'GOOGLE_DISABLED');
  if (!env.isProd && env.otp.devEcho && credential.startsWith('dev:')) {
    const [, email, name] = credential.split(':');
    return { sub: `dev-${email}`, email: email.toLowerCase(), name: name || email.split('@')[0] };
  }
  client ??= new OAuth2Client(env.googleClientId);
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: env.googleClientId });
    payload = ticket.getPayload();
  } catch {
    throw badRequest('تعذّر التحقق من حساب جوجل — حاول مرة أخرى');
  }
  if (!payload?.email || !payload.email_verified) throw badRequest('بريد حساب جوجل غير مؤكد');
  return { sub: payload.sub, email: payload.email.toLowerCase(), name: payload.name || payload.email.split('@')[0] };
}

module.exports = { verifyGoogleCredential, googleEnabled: enabled };
