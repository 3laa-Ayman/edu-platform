const bcrypt = require('bcrypt');
const env = require('../src/config/env');
const path = require('path');
const fs = require('fs');
const db = require('../src/config/db');
const { parseQuestionSheet, importQuestions } = require('../src/services/excel.service');

(async () => {
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error('Set ADMIN_PASSWORD in .env');
  const hash = await bcrypt.hash(password, env.bcryptRounds);
  await db.query(
    `INSERT INTO users (full_name, email, password_hash, phone, parent_phone, role, is_verified)
     VALUES ('Admin', $1, $2, '01000000000', '01000000001', 'admin', TRUE)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', is_verified = TRUE`,
    [email, hash],
  );
  console.log(`✅ Admin ready: ${email}`);

  const { rowCount } = await db.query(`SELECT 1 FROM products LIMIT 1`);
  if (!rowCount) {
    await db.query(`
      INSERT INTO products (title, description, category, original_price, discount_percent, coupon_code) VALUES
        ('كتاب المراجعة النهائية - فيزياء', 'مراجعة شاملة بالأسئلة', 'كتب', 250, 20, 'STUDY20'),
        ('سماعة مذاكرة عازلة للضوضاء', 'للتركيز أثناء المذاكرة', 'أدوات', 900, 15, NULL),
        ('أقلام وكشكول منظم', 'طقم أدوات مكتبية', 'أدوات', 120, 10, NULL)`);
    console.log('✅ Sample products added');
  }
  if (env.demoMode) {
    const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n FROM questions`);
    if (!n) {
      const buf = fs.readFileSync(path.join(__dirname, '../templates/questions-template.xlsx'));
      const r = await importQuestions(await parseQuestionSheet(buf), { adminId: null, filename: 'demo-seed.xlsx' });
      console.log(`✅ Demo questions imported: ${r.inserted}`);
    }
  }
  await db.pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
