require('dotenv').config({ quiet: true });

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
// DEMO_MODE: a public test deployment — mocks (OTP shown on screen, simulated payments, mock AI) stay
// enabled even with NODE_ENV=production. Never enable it on the real platform.
const demoMode = bool(process.env.DEMO_MODE, false);
const allowMocks = !isProd || demoMode;

for (const key of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[key]) throw new Error(`Missing required env var ${key}`);
}
if (isProd && process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

module.exports = {
  nodeEnv,
  isProd,
  demoMode,
  allowMocks,
  port: num(process.env.PORT, 4000),
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:4000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  databaseUrl: process.env.DATABASE_URL,

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 12),
  otp: {
    ttlMinutes: num(process.env.OTP_TTL_MINUTES, 10),
    maxAttempts: num(process.env.OTP_MAX_ATTEMPTS, 5),
    resendCooldownSec: num(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60),
    devEcho: allowMocks && bool(process.env.OTP_DEV_ECHO, false),
  },

  smtp: {
    host: process.env.SMTP_HOST,
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  mailFrom: process.env.MAIL_FROM || 'Edu Platform <no-reply@example.com>',

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
    inputUsdPerM: num(process.env.GEMINI_INPUT_USD_PER_M, 0.1),
    outputUsdPerM: num(process.env.GEMINI_OUTPUT_USD_PER_M, 0.4),
    maxOutputTokens: num(process.env.GEMINI_MAX_OUTPUT_TOKENS, 700),
    usdToEgp: num(process.env.USD_TO_EGP, 50),
  },
  aiLimitEgp: num(process.env.AI_LIMIT_EGP, 100),

  paymob: {
    baseUrl: process.env.PAYMOB_BASE_URL || 'https://accept.paymob.com',
    secretKey: process.env.PAYMOB_SECRET_KEY,
    publicKey: process.env.PAYMOB_PUBLIC_KEY,
    hmacSecret: process.env.PAYMOB_HMAC_SECRET,
    integrationId: process.env.PAYMOB_INTEGRATION_ID,
  },
  fawry: {
    baseUrl: process.env.FAWRY_BASE_URL || 'https://atfawry.fawrystaging.com',
    merchantCode: process.env.FAWRY_MERCHANT_CODE,
    secureKey: process.env.FAWRY_SECURE_KEY,
  },
  manualPayment: {
    vodafoneCashNumber: process.env.VODAFONE_CASH_NUMBER,
    instapayAddress: process.env.INSTAPAY_ADDRESS,
  },

  uploadDir: require('path').resolve(__dirname, '../../uploads'),
  enableCron: bool(process.env.ENABLE_CRON, true),
  tz: process.env.TZ_NAME || 'Africa/Cairo',
};
