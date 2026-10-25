const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const env = require('./config/env');
const db = require('./config/db');
const { parseQuestionSheet, importQuestions } = require('./services/excel.service');

const MIGRATION_LOCK = 724002; // pg advisory lock key — serverless cold starts may migrate concurrently

/** Applies db/schema.sql (idempotent). */
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  await db.withTransaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await c.query(sql);
  });
}

/**
 * Creates the admin account and sample data.
 * overwriteAdminPassword: the CLI seed resets the password to ADMIN_PASSWORD; automatic boot seeding only creates it.
 */
async function seed({ overwriteAdminPassword = false, log = console.log } = {}) {
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (password) {
    const hash = await bcrypt.hash(password, env.bcryptRounds);
    const r = await db.query(
      `INSERT INTO users (full_name, email, password_hash, phone, parent_phone, role, is_verified)
       VALUES ('Admin', $1, $2, '01000000000', '01000000001', 'admin', TRUE)
       ON CONFLICT (email) DO ${overwriteAdminPassword ? `UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', is_verified = TRUE` : 'NOTHING'}`,
      [email, hash],
    );
    if (r.rowCount) log(`✅ Admin ready: ${email}`);
  } else {
    log('⚠️  ADMIN_PASSWORD not set — admin account not created');
  }

  const { rowCount } = await db.query(`SELECT 1 FROM products LIMIT 1`);
  if (!rowCount) {
    await db.query(`
      INSERT INTO products (title, description, category, original_price, discount_percent, coupon_code) VALUES
        ('كتاب المراجعة النهائية - فيزياء', 'مراجعة شاملة بالأسئلة', 'كتب', 250, 20, 'STUDY20'),
        ('سماعة مذاكرة عازلة للضوضاء', 'للتركيز أثناء المذاكرة', 'أدوات', 900, 15, NULL),
        ('أقلام وكشكول منظم', 'طقم أدوات مكتبية', 'أدوات', 120, 10, NULL)`);
    log('✅ Sample products added');
  }

  if (env.demoMode) {
    const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n FROM questions`);
    if (!n) {
      const buf = fs.readFileSync(path.join(__dirname, '../templates/questions-template.xlsx'));
      const r = await importQuestions(await parseQuestionSheet(buf), { adminId: null, filename: 'demo-seed.xlsx' });
      log(`✅ Demo questions imported: ${r.inserted}`);
    }
  }
}

module.exports = { migrate, seed };
