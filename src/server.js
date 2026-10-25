const env = require('./config/env');
const app = require('./app');
const db = require('./config/db');
const { startJobs } = require('./jobs');

const server = app.listen(env.port, () => {
  console.log(`🚀 API running on http://localhost:${env.port} (${env.nodeEnv})`);
  if (env.enableCron) startJobs();
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(() => db.pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
