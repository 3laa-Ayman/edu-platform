const crypto = require('crypto');
const router = require('express').Router();
const db = require('../config/db');
const { validate, idParam, z } = require('../middleware/validate');
const { requireSubscription } = require('../middleware/subscription');
const { recordAnswer, publicQuestions } = require('../services/answer.service');
const { mediaMap } = require('../services/media.service');
const { normalizeChoice } = require('../utils/choices');
const { badRequest, forbidden, notFound } = require('../utils/errors');

const QUESTION_SELECT = `
  SELECT q.*, s.name AS subject_name, l.name AS lesson_name
    FROM questions q
    JOIN subjects s ON s.id = q.subject_id
    LEFT JOIN lessons l ON l.id = q.lesson_id`;

async function getQuestion(id) {
  const { rows } = await db.query(`${QUESTION_SELECT} WHERE q.id = $1 AND q.is_active`, [id]);
  if (!rows[0]) throw notFound('السؤال غير موجود');
  return rows[0];
}

/** Subjects → lessons tree with question counts (for navigation menus). */
router.get('/subjects', async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id, s.name,
            COALESCE(json_agg(json_build_object('id', l.id, 'name', l.name, 'lesson_type', l.lesson_type,
                     'questions', (SELECT COUNT(*) FROM questions q WHERE q.lesson_id = l.id AND q.is_active)))
                     FILTER (WHERE l.id IS NOT NULL), '[]') AS lessons,
            (SELECT COUNT(*)::int FROM questions q WHERE q.subject_id = s.id AND q.is_active) AS questions
       FROM subjects s LEFT JOIN lessons l ON l.subject_id = s.id
      GROUP BY s.id ORDER BY s.name`,
  );
  res.json({ subjects: rows });
});

router.get('/questions', requireSubscription('practice'), validate({
  query: z.object({
    subject_id: z.coerce.number({ message: 'اختار المادة اللي هتحل عليها' }).int().positive(),
    lesson_id: z.coerce.number().int().positive().optional(),
    category: z.enum(['lesson', 'past_exam']).optional(),
    exam_year: z.coerce.number().int().optional(),
    unsolved_only: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }),
}), async (req, res) => {
  const f = req.q;
  if (f.category === 'past_exam' && req.user.role !== 'admin' && !req.subscription.features?.past_exams) {
    throw forbidden('أسئلة الامتحانات السابقة غير متاحة في باقتك الحالية', 'PLAN_UPGRADE_REQUIRED');
  }
  const { rows } = await db.query(
    `${QUESTION_SELECT}
      WHERE q.is_active
        AND ($1::int IS NULL OR q.subject_id = $1)
        AND ($2::int IS NULL OR q.lesson_id = $2)
        AND ($3::text IS NULL OR q.category = $3)
        AND ($4::int IS NULL OR q.exam_year = $4)
        AND ($5::boolean = FALSE OR NOT EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = $6 AND a.question_id = q.id))
      -- Random order of passages/questions, but a passage's questions come together and in their upload order.
      ORDER BY md5(COALESCE('p' || q.passage_id, 'q' || q.id) || $8), q.id
      LIMIT $7`,
    [f.subject_id ?? null, f.lesson_id ?? null, f.category ?? null, f.exam_year ?? null,
      f.unsolved_only === 'true', req.user.id, f.limit, crypto.randomUUID()],
  );
  res.json({ questions: await publicQuestions(rows) });
});

router.post('/answer', requireSubscription('practice'), validate({
  body: z.object({
    question_id: z.coerce.number().int().positive(),
    choice: z.string().max(3),
    time_spent_ms: z.coerce.number().int().min(0).max(3_600_000).optional(),
  }),
}), async (req, res) => {
  const choice = normalizeChoice(req.body.choice);
  if (!choice) throw badRequest('الاختيار يجب أن يكون A أو B أو C أو D');
  const q = await getQuestion(req.body.question_id);
  const result = await db.withTransaction((c) =>
    recordAnswer(c, { userId: req.user.id, question: q, selected: choice, source: 'practice', timeSpentMs: req.body.time_spent_ms }));
  const { rows: [ai] } = await db.query(
    `SELECT 1 AS x FROM ai_explanations WHERE question_id = $1
     UNION ALL SELECT 1 FROM question_media WHERE question_id = $1 AND slot = 'explanation' LIMIT 1`, [q.id]);
  res.json({
    is_correct: result.isCorrect,
    correct_option: q.correct_option,
    added_to_mistakes: result.addedToMistakes,
    removed_from_mistakes: result.removedFromMistakes,
    // Tells the UI whether "show explanation" is free or will need Gemini.
    free_explanation_available: Boolean(q.explanation || ai),
  });
});

/** Free explanation from the question bank (or a previously generated AI explanation). Never calls Gemini. */
router.get('/questions/:id/explanation', validate({ params: idParam }), async (req, res) => {
  const q = await getQuestion(req.p.id);
  const answered = await db.query(`SELECT 1 FROM attempts WHERE user_id = $1 AND question_id = $2 LIMIT 1`, [req.user.id, q.id]);
  if (!answered.rowCount && req.user.role !== 'admin') throw badRequest('أجب على السؤال أولاً لعرض الشرح');

  const explanationImage = (await mediaMap([q.id]))[q.id]?.explanation || null;
  if (q.explanation || explanationImage) {
    return res.json({ source: 'question_bank', cost_egp: 0, correct_option: q.correct_option, explanation: q.explanation, explanation_image: explanationImage, law_note: q.law_note });
  }
  const { rows: [cached] } = await db.query(`SELECT content FROM ai_explanations WHERE question_id = $1`, [q.id]);
  if (cached) {
    return res.json({ source: 'ai_cache', cost_egp: 0, correct_option: q.correct_option, explanation: cached.content, law_note: q.law_note });
  }
  res.json({
    source: null,
    correct_option: q.correct_option,
    law_note: q.law_note,
    explanation: null,
    ai_available: true,
    message: 'لا يوجد شرح محفوظ لهذا السؤال. يمكنك طلب شرح بالذكاء الاصطناعي (يُخصم من رصيدك).',
  });
});

module.exports = { router, getQuestion };
