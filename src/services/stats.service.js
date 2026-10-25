const db = require('../config/db');

function grade(percent) {
  if (percent === null) return 'لا توجد بيانات';
  if (percent >= 85) return 'ممتاز';
  if (percent >= 75) return 'جيد جداً';
  if (percent >= 65) return 'جيد';
  if (percent >= 50) return 'مقبول';
  return 'يحتاج تحسين';
}

/** Accuracy % per subject, optionally within a date range. Every attempt counts (practice, retries, competitions). */
async function subjectPerformance(userId, { from = null, to = null } = {}) {
  const { rows } = await db.query(
    `SELECT s.id AS subject_id, s.name AS subject,
            COUNT(a.id)::int AS attempts,
            COUNT(a.id) FILTER (WHERE a.is_correct)::int AS correct,
            (SELECT COUNT(*)::int FROM mistakes m WHERE m.user_id = $1 AND m.subject_id = s.id) AS open_mistakes
       FROM attempts a
       JOIN questions q ON q.id = a.question_id
       JOIN subjects s ON s.id = q.subject_id
      WHERE a.user_id = $1
        AND ($2::timestamptz IS NULL OR a.created_at >= $2)
        AND ($3::timestamptz IS NULL OR a.created_at < $3)
      GROUP BY s.id, s.name
      ORDER BY s.name`,
    [userId, from, to],
  );
  return rows.map((r) => {
    const percent = r.attempts ? Math.round((r.correct / r.attempts) * 1000) / 10 : null;
    return { ...r, percent, rating: grade(percent) };
  });
}

function overall(subjects) {
  const attempts = subjects.reduce((s, r) => s + r.attempts, 0);
  const correct = subjects.reduce((s, r) => s + r.correct, 0);
  const percent = attempts ? Math.round((correct / attempts) * 1000) / 10 : null;
  return { attempts, correct, percent, rating: grade(percent) };
}

module.exports = { subjectPerformance, overall, grade };
