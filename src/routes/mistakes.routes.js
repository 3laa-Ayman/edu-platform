const router = require('express').Router();
const db = require('../config/db');
const { validate, z, pagination } = require('../middleware/validate');
const { recordAnswer, publicQuestions } = require('../services/answer.service');
const { mediaMap } = require('../services/media.service');
const { requireSubscription } = require('../middleware/subscription');
const { normalizeChoice } = require('../utils/choices');
const { badRequest, notFound } = require('../utils/errors');

const filters = {
  subject_id: z.coerce.number().int().positive().optional(),
  lesson_id: z.coerce.number().int().positive().optional(),
};

/** Grouped overview: subject → lesson → count. */
router.get('/summary', async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id AS subject_id, s.name AS subject, l.id AS lesson_id, COALESCE(l.name, 'بدون درس') AS lesson,
            COUNT(*)::int AS mistakes, MAX(m.last_wrong_at) AS last_wrong_at
       FROM mistakes m
       JOIN subjects s ON s.id = m.subject_id
       LEFT JOIN lessons l ON l.id = m.lesson_id
      WHERE m.user_id = $1
      GROUP BY s.id, s.name, l.id, l.name
      ORDER BY s.name, lesson`,
    [req.user.id],
  );
  const subjects = [];
  for (const r of rows) {
    let s = subjects.find((x) => x.subject_id === r.subject_id);
    if (!s) subjects.push((s = { subject_id: r.subject_id, subject: r.subject, total: 0, lessons: [] }));
    s.total += r.mistakes;
    s.lessons.push({ lesson_id: r.lesson_id, lesson: r.lesson, mistakes: r.mistakes, last_wrong_at: r.last_wrong_at });
  }
  res.json({ total: subjects.reduce((t, s) => t + s.total, 0), subjects });
});

/** Paginated list. Includes the student's last wrong choice and the correct answer (they already saw it). */
router.get('/', validate({ query: z.object({ ...filters, ...pagination }) }), async (req, res) => {
  const { subject_id, lesson_id, page, limit } = req.q;
  const { rows } = await db.query(
    `SELECT m.question_id, m.wrong_count, m.last_selected_option, m.last_wrong_at,
            q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option,
            s.name AS subject, l.name AS lesson, COUNT(*) OVER()::int AS total
       FROM mistakes m
       JOIN questions q ON q.id = m.question_id
       JOIN subjects s ON s.id = m.subject_id
       LEFT JOIN lessons l ON l.id = m.lesson_id
      WHERE m.user_id = $1 AND ($2::int IS NULL OR m.subject_id = $2) AND ($3::int IS NULL OR m.lesson_id = $3)
      ORDER BY m.last_wrong_at DESC
      LIMIT $4 OFFSET $5`,
    [req.user.id, subject_id ?? null, lesson_id ?? null, limit, (page - 1) * limit],
  );
  res.json({ page, limit, total: rows[0]?.total ?? 0, items: rows.map(({ total, ...r }) => r) });
});

/** A re-solve quiz drawn from the mistakes bank (answers hidden). */
router.get('/quiz', requireSubscription('mistakes_bank'), validate({ query: z.object({ ...filters, limit: z.coerce.number().int().min(1).max(50).default(10) }) }), async (req, res) => {
  const { subject_id, lesson_id, limit } = req.q;
  const { rows } = await db.query(
    `SELECT q.*, s.name AS subject_name, l.name AS lesson_name
       FROM mistakes m
       JOIN questions q ON q.id = m.question_id
       JOIN subjects s ON s.id = q.subject_id
       LEFT JOIN lessons l ON l.id = q.lesson_id
      WHERE m.user_id = $1 AND ($2::int IS NULL OR m.subject_id = $2) AND ($3::int IS NULL OR m.lesson_id = $3)
      ORDER BY random() LIMIT $4`,
    [req.user.id, subject_id ?? null, lesson_id ?? null, limit],
  );
  res.json({ questions: await publicQuestions(rows) });
});

/** Re-solve one mistake. Correct → removed from the bank automatically. */
router.post('/:questionId/retry', requireSubscription('mistakes_bank'), validate({
  params: z.object({ questionId: z.coerce.number().int().positive() }),
  body: z.object({ choice: z.string().max(3) }),
}), async (req, res) => {
  const choice = normalizeChoice(req.body.choice);
  if (!choice) throw badRequest('الاختيار يجب أن يكون A أو B أو C أو D');
  const { rows: [q] } = await db.query(
    `SELECT q.* FROM mistakes m JOIN questions q ON q.id = m.question_id WHERE m.user_id = $1 AND m.question_id = $2`,
    [req.user.id, req.p.questionId],
  );
  if (!q) throw notFound('هذا السؤال غير موجود في بنك أخطائك');

  const r = await db.withTransaction((c) => recordAnswer(c, { userId: req.user.id, question: q, selected: choice, source: 'mistakes_retry' }));
  res.json({
    is_correct: r.isCorrect,
    correct_option: q.correct_option,
    removed_from_mistakes: r.removedFromMistakes,
    message: r.isCorrect ? 'إجابة صحيحة! تم حذف السؤال من بنك الأخطاء' : 'إجابة خاطئة، السؤال باقٍ في بنك الأخطاء',
    explanation: q.explanation,
    explanation_image: (await mediaMap([q.id]))[q.id]?.explanation || null,
    law_note: q.law_note,
  });
});

module.exports = router;
