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
app.use(express.static(require('path').join(__dirname, '../public'), { maxAge: env.isProd ? '1h' : 0 }));

app.use('/api/webhooks', webhookLimiter, require('./routes/webhooks.routes'));
app.use('/api/cron', webhookLimiter, require('./routes/cron.routes'));
app.use('/api', globalLimiter, require('./routes'));

app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'المسار غير موجود' } }));
app.use(errorHandler);

module.exports = app;
