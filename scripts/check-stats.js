/**
 * Read-only check: the per-subject counters (user_subject_stats) must equal a full recount of the answers,
 * for every student.   node scripts/check-stats.js
 */
const db = require('../src/config/db');

(async () => {
  const { rows } = await db.query(`
    WITH live AS (
      SELECT a.user_id, q.subject_id, COUNT(*)::int AS attempts, COUNT(*) FILTER (WHERE a.is_correct)::int AS correct
        FROM attempts a JOIN questions q ON q.id = a.question_id
       WHERE a.selected_option IS NOT NULL GROUP BY a.user_id, q.subject_id),
    counters AS (SELECT user_id, subject_id, attempts, correct FROM user_subject_stats WHERE attempts <> 0 OR correct <> 0)
    SELECT COALESCE(l.user_id, c.user_id) AS user_id, COALESCE(l.subject_id, c.subject_id) AS subject_id,
           l.attempts AS live_attempts, c.attempts AS counter_attempts, l.correct AS live_correct, c.correct AS counter_correct
      FROM live l FULL JOIN counters c ON c.user_id = l.user_id AND c.subject_id = l.subject_id
     WHERE l.attempts IS DISTINCT FROM c.attempts OR l.correct IS DISTINCT FROM c.correct`);
  const { rows: [t] } = await db.query(`SELECT COUNT(DISTINCT user_id)::int AS students, COALESCE(SUM(attempts), 0)::int AS answers FROM user_subject_stats`);
  if (rows.length) console.log(`❌ ${rows.length} mismatches`, rows.slice(0, 20));
  else console.log(`✅ counters match a full recount (${t.students} students, ${t.answers} answers)`);
  await db.pool.end();
  process.exit(rows.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
