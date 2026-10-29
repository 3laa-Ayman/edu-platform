/**
 * Single place where an answer is recorded. Keeps the mistakes bank in sync automatically:
 *  - wrong / unanswered → upsert into mistakes (wrong_count++)
 *  - correct            → remove from mistakes if it was there
 */
async function recordAnswer(client, { userId, question, selected, source, entryId = null, timeSpentMs = null }) {
  // A skipped question is never recorded (and so never counted wrong / added to the mistakes bank).
  if (!selected) throw new Error('recordAnswer called without a selected option');
  const isCorrect = selected === question.correct_option;

  await client.query(
    `INSERT INTO attempts (user_id, question_id, selected_option, is_correct, source, competition_entry_id, time_spent_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, question.id, selected, isCorrect, source, entryId, timeSpentMs],
  );

  if (isCorrect) {
    const r = await client.query(`DELETE FROM mistakes WHERE user_id = $1 AND question_id = $2`, [userId, question.id]);
    return { isCorrect, removedFromMistakes: r.rowCount > 0, addedToMistakes: false };
  }

  await client.query(
    `INSERT INTO mistakes (user_id, question_id, subject_id, lesson_id, last_selected_option)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, question_id) DO UPDATE
       SET wrong_count = mistakes.wrong_count + 1,
           last_wrong_at = now(),
           last_selected_option = EXCLUDED.last_selected_option`,
    [userId, question.id, question.subject_id, question.lesson_id, selected],
  );
  return { isCorrect, removedFromMistakes: false, addedToMistakes: true };
}

/** Public projection of a question — never includes the correct answer or explanation (nor its image). */
const publicQuestion = (q, media = {}, passage = null) => ({
  id: q.id,
  subject_id: q.subject_id,
  subject: q.subject_name,
  lesson_id: q.lesson_id,
  lesson: q.lesson_name,
  category: q.category,
  exam_year: q.exam_year,
  question: q.question_text,
  options: { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d },
  image: media.question || null,
  option_images: { A: media.option_a || null, B: media.option_b || null, C: media.option_c || null, D: media.option_d || null },
  passage,
});

/**
 * Adds image URLs and reading passages to a list of questions (one query each for the whole list).
 * Questions of the same passage are kept next to each other, so the passage stays on screen between them.
 */
async function publicQuestions(rows) {
  const { mediaMap } = require('./media.service');
  const { passageMap, groupByPassage } = require('./passage.service');
  const [m, p] = await Promise.all([mediaMap(rows.map((q) => q.id)), passageMap(rows.map((q) => q.passage_id))]);
  return groupByPassage(rows).map((q) => publicQuestion(q, m[q.id], p[q.passage_id] || null));
}

module.exports = { recordAnswer, publicQuestion, publicQuestions };
