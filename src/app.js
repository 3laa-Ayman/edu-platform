const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const env = require('./config/env');
const db = require('./config/db');
const { globalLimiter, webhookLimiter } = require('./middleware/rateLimit');
const errorHandler = require('./middleware/errorHandler');

const app = express();
app.set('trust proxy', 1); // behind Nginx / a load balancer → correct client IP for rate limiting
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    // blob: lets the admin preview uploaded receipts fetched with the auth header.
    directives: { 'img-src': ["'self'", 'data:', 'blob:'] },
  },
}));
app.use(cors({
  origin: env.corsOrigins.includes('*') && !env.isProd ? true : env.corsOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
if (env.nodeEnv !== 'test') app.use(morgan(env.isProd ? 'combined' : 'dev'));

app.get('/health', async (req, res) => {
  await db.query('SELECT 1');
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Frontend (static SPA, hash routing) served from the same origin as the API.
// index.html is never cached and points at /js and /css with ?v=<hash of their contents>, so after a deploy every
// browser loads the new files at once (no hour of stale pages, no mix of old and new scripts).
const PUBLIC = require('path').join(__dirname, '../public');
const indexHtml = (() => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const version = (file) => require('crypto').createHash('sha1').update(fs.readFileSync(path.join(PUBLIC, file))).digest('hex').slice(0, 10);
  return html.replace(/(src|href)="\/((?:js|css)\/[\w.-]+\.(?:js|css))"/g, (m, attr, file) => `${attr}="/${file}?v=${version(file)}"`);
})();
const sendIndex = (req, res) => res.set('Cache-Control', 'no-cache').type('html').send(indexHtml);
app.get(['/', '/index.html'], sendIndex);
app.use(express.static(PUBLIC, {
  index: false,
  maxAge: env.isProd ? '1h' : 0,
  // Versioned assets (?v=hash) can be kept for a year: a new version gets a new URL.
  setHeaders: (res) => { if (env.isProd && /[?&]v=/.test(res.req.originalUrl)) res.set('Cache-Control', 'public, max-age=31536000, immutable'); },
}));

app.use('/api/webhooks', webhookLimiter, require('./routes/webhooks.routes'));
app.use('/api/cron', webhookLimiter, require('./routes/cron.routes'));
app.use('/api', globalLimiter, require('./routes'));

app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'المسار غير موجود' } }));
app.use(errorHandler);

module.exports = app;
