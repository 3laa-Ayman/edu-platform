#!/usr/bin/env node
/**
 * Remove test data before launch (run from the "Clean test data" GitHub workflow, or locally).
 *
 *   node scripts/cleanup-test-data.js            → preview only (counts, nothing changes)
 *   node scripts/cleanup-test-data.js --apply    → delete, in one transaction
 *
 * Test data =
 *   - student accounts whose email is on a test domain (TEST_DOMAINS) — their answers, subscriptions, payments… go too
 *   - payments left from student accounts that were already deleted (user_id IS NULL)   [--orphan-payments]
 *   - the demo questions subject (DEMO_SUBJECTS) with its lessons and questions
 *   - the default admin admin@example.com (only if another active admin exists)
 *   - teams left with no members
 * The output never prints a real person's name/email (the repo's workflow logs are public): only counts, and the
 * emails of test-domain accounts.
 */
const { Client } = require('pg');

const TEST_DOMAINS = ['test.com', 't.com', 'demo.com', 'example.com', 'example.org', 'example.net'];
const DEMO_SUBJECTS = ['البرمجة'];
const DEFAULT_ADMIN = 'admin@example.com';
const apply = process.argv.includes('--apply');
const withOrphans = process.argv.includes('--orphan-payments');

const domainOf = (email) => String(email).split('@')[1]?.toLowerCase() || '';
const isTest = (email) => TEST_DOMAINS.includes(domainOf(email)) || /\.(test|invalid|example)$/.test(domainOf(email));

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    const { rows: users } = await c.query(`SELECT id, role, email, is_active, created_at FROM users`);
    const students = users.filter((u) => u.role === 'student');
    const testStudents = students.filter((u) => isTest(u.email));
    const realStudents = students.filter((u) => !isTest(u.email));
    const ids = testStudents.map((u) => u.id);

    const byDomain = {};
    for (const u of realStudents) byDomain[domainOf(u.email)] = (byDomain[domainOf(u.email)] || 0) + 1;

    const one = async (sql, p = []) => (await c.query(sql, p)).rows[0];
    const pay = await one(`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE status = 'paid')::int paid,
                                  COALESCE(SUM(amount_egp) FILTER (WHERE status = 'paid'), 0)::numeric total
                             FROM payments WHERE user_id = ANY($1)`, [ids]);
    const orphan = await one(`SELECT COUNT(*)::int n, COALESCE(SUM(amount_egp) FILTER (WHERE status = 'paid'), 0)::numeric total
                                FROM payments WHERE user_id IS NULL`);
    const realPay = await one(`SELECT COUNT(*)::int n FROM payments WHERE user_id <> ALL($1) AND user_id IS NOT NULL`, [ids]);
    const { rows: subj } = await c.query(
      `SELECT s.id, s.name, (SELECT COUNT(*)::int FROM questions q WHERE q.subject_id = s.id) AS questions
         FROM subjects s WHERE s.name = ANY($1)`, [DEMO_SUBJECTS]);
    const allQ = await one(`SELECT COUNT(*)::int n FROM questions`);
    const admins = users.filter((u) => u.role === 'admin');
    const defAdmin = admins.find((u) => u.email.toLowerCase() === DEFAULT_ADMIN);
    const otherActiveAdmins = admins.filter((u) => u !== defAdmin && u.is_active).length;
    const { rows: comps } = await c.query(`SELECT id, title, starts_at FROM competitions ORDER BY id`);
    const { rows: anns } = await c.query(`SELECT id, title FROM announcements ORDER BY id`);

    const line = (s) => console.log(s);
    line(`\n===== ${apply ? 'APPLY' : 'PREVIEW (nothing is deleted)'} =====`);
    line(`Students: ${students.length} total`);
    line(`  test accounts to delete: ${testStudents.length}`);
    for (const d of TEST_DOMAINS) {
      const n = testStudents.filter((u) => domainOf(u.email) === d).length;
      if (n) line(`    @${d}: ${n}`);
    }
    line(`  kept (other domains): ${realStudents.length}  ${JSON.stringify(byDomain)}`);
    line(`Payments of the test accounts: ${pay.n} (paid: ${pay.paid}, ${pay.total} EGP) → deleted`);
    line(`Payments of already-deleted accounts: ${orphan.n} (${orphan.total} EGP paid) → ${withOrphans ? 'deleted' : 'kept (add orphan payments option to delete)'}`);
    line(`Payments of kept students: ${realPay.n} → kept`);
    line(`Demo subject: ${subj.length ? subj.map((s) => `«${s.name}» (${s.questions} questions)`).join(', ') : 'none'} → deleted · all questions now: ${allQ.n}`);
    line(`Default admin ${DEFAULT_ADMIN}: ${defAdmin ? (otherActiveAdmins ? 'found → deleted' : 'found but it is the only active admin → KEPT') : 'not found'} · other active admins: ${otherActiveAdmins}`);
    line(`Competitions (kept, for your info): ${comps.length}${comps.length ? ' → ' + comps.map((x) => `#${x.id} «${x.title}»`).join(' · ') : ''}`);
    line(`Announcements (kept, for your info): ${anns.length}${anns.length ? ' → ' + anns.map((x) => `#${x.id} «${x.title}»`).join(' · ') : ''}`);

    if (!apply) { await c.query('ROLLBACK'); line('\nPreview only — run again with mode "apply" to delete.'); return; }

    // Payments first (their FK is ON DELETE SET NULL, so they'd otherwise stay as orphans).
    const dp = await c.query(`DELETE FROM payments WHERE user_id = ANY($1)`, [ids]);
    const dop = withOrphans ? await c.query(`DELETE FROM payments WHERE user_id IS NULL`) : { rowCount: 0 };
    const du = await c.query(`DELETE FROM users WHERE id = ANY($1) AND role = 'student'`, [ids]);
    let dq = 0, ds = 0;
    for (const s of subj) {
      dq += (await c.query(`DELETE FROM questions WHERE subject_id = $1`, [s.id])).rowCount;
      ds += (await c.query(`DELETE FROM subjects WHERE id = $1`, [s.id])).rowCount; // lessons cascade
    }
    const da = defAdmin && otherActiveAdmins ? (await c.query(`DELETE FROM users WHERE id = $1 AND role = 'admin'`, [defAdmin.id])).rowCount : 0;
    const dt = await c.query(`DELETE FROM teams t WHERE NOT EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.id)`);
    await c.query(`UPDATE teams t SET captain_id = (SELECT m.user_id FROM team_members m WHERE m.team_id = t.id ORDER BY m.joined_at LIMIT 1)
                    WHERE captain_id IS NULL`);
    await c.query('COMMIT');
    line(`\nDeleted: ${du.rowCount} test students · ${dp.rowCount} their payments · ${dop.rowCount} old orphan payments · ` +
      `${dq} demo questions · ${ds} demo subject · ${da} default admin · ${dt.rowCount} empty teams`);
    const after = await one(`SELECT (SELECT COUNT(*) FROM users WHERE role='student')::int students,
      (SELECT COUNT(*) FROM payments)::int payments, (SELECT COUNT(*) FROM questions)::int questions,
      (SELECT COUNT(*) FROM users WHERE role='admin' AND is_active)::int admins`);
    line(`Now: ${JSON.stringify(after)}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
