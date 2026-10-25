const db = require('../src/config/db');
const { seed } = require('../src/bootstrap');

if (!process.env.ADMIN_PASSWORD) {
  console.error('Set ADMIN_PASSWORD in .env');
  process.exit(1);
}
seed({ overwriteAdminPassword: true })
  .then(() => db.pool.end())
  .catch((e) => { console.error(e); process.exit(1); });
