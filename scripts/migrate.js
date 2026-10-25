const db = require('../src/config/db');
const { migrate } = require('../src/bootstrap');

migrate()
  .then(() => { console.log('✅ Schema applied'); return db.pool.end(); })
  .catch((e) => { console.error(e); process.exit(1); });
