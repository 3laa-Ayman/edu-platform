const db = require('../config/db');
const { shuffle } = require('../utils/random');
const { LETTERS, normalizeChoice, optionText } = require('../utils/choices');
const { badRequest, conflict, forbidden, notFound } = require('../utils/errors');
const { recordAnswer } = require('./answer.service');
const { getTeamOf } = require('./team.service');
const { mediaMap } = require('./media.service');

const SUBMIT_GRACE_MS = 30_000;

async function getCompetition(id, client = db) {
  const { rows } = await client.query(`SELECT * FROM competitions WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('المسابقة غير موجودة');
  return rows[0];
}

/** Renders an entry's questions in the student's own shuffled order, with shuffled option labels. */
async function renderEntry(entry, client = db) {
  const ids = entry.question_order.map((o) => o.qid);
  const { rows } = await client.query(
    `SELECT id, question_text, option_a, option_b, option_c, option_d FROM questions WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  const byId = new Map(rows.map((q) => [q.id, q]));
  const media = await mediaMap(ids);
  return {
    entry_id: entry.id,
    started_at: entry.started_at,
    deadline_at: entry.deadline_at,
    submitted_at: entry.submitted_at,
    questions: entry.question_order.map(({ qid, perm }, idx) => {
      const q = byId.get(qid);
      // Displayed label LETTERS[i] shows the original option perm[i].
      const m = media[qid] || {};
      return {
        number: idx + 1,
        question_id: qid,
        question: q.question_text,
        image: m.question || null,
        options: LETTERS.map((L, i) => ({ key: L, text: optionText(q, perm[i]), image: m[`option_${perm[i].toLowerCase()}`] || null })),
      };
    }),
  };
}

async function startEntry(competitionId, user) {
  return db.withTransaction(async (c) => {
    const comp = await getCompetition(competitionId, c);
    const now = new Date();
    if (now < comp.starts_at) throw badRequest('المسابقة لم تبدأ بعد');
    if (now > comp.ends_at) throw badRequest('انتهت المسابقة');

    const existing = await c.query(
      `SELECT * FROM competition_entries WHERE competition_id = $1 AND user_id = $2 FOR UPDATE`,
      [comp.id, user.id],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].submitted_at) throw conflict('لقد قمت بتسليم هذه المسابقة بالفعل');
      return renderEntry(existing.rows[0], c); // resume
    }

    let teamId = null;
    if (comp.type === 'team_weekly') {
      const team = await getTeamOf(user.id, c);
      if (!team) throw forbidden('يجب أن تكون عضواً في تيم للمشاركة في مسابقة الجمعة (سيتم توزيعك تلقائياً قبل المسابقة)', 'TEAM_REQUIRED');
      teamId = team.id;
    }

    const { rows: qs } = await c.query(`SELECT question_id FROM competition_questions WHERE competition_id = $1`, [comp.id]);
    if (!qs.length) throw badRequest('لا توجد أسئلة في هذه المسابقة');
    // Each student gets a different question order AND a different option order per question.
    const order = shuffle(qs.map((r) => r.question_id)).map((qid) => ({ qid, perm: shuffle(LETTERS) }));
    const deadline = new Date(Math.min(now.getTime() + comp.duration_minutes * 60_000, comp.ends_at.getTime()));

    const { rows: [entry] } = await c.query(
      `INSERT INTO competition_entries (competition_id, user_id, team_id, question_order, deadline_at, total_questions)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [comp.id, user.id, teamId, JSON.stringify(order), deadline, order.length],
    );
    return renderEntry(entry, c);
  });
}

/** answers: [{ question_id, choice }] where choice is the DISPLAYED label (A–D) the student saw. */
async function submitEntry(competitionId, user, answers) {
  return db.withTransaction(async (c) => {
    const { rows: [entry] } = await c.query(
      `SELECT * FROM competition_entries WHERE competition_id = $1 AND user_id = $2 FOR UPDATE`,
      [competitionId, user.id],
    );
    if (!entry) throw badRequest('يجب بدء المسابقة أولاً');
    if (entry.submitted_at) throw conflict('تم التسليم بالفعل');
    if (Date.now() > entry.deadline_at.getTime() + SUBMIT_GRACE_MS) throw badRequest('انتهى الوقت المسموح للتسليم');

    const given = new Map(answers.map((a) => [Number(a.question_id), normalizeChoice(a.choice)]));
    const ids = entry.question_order.map((o) => o.qid);
    const { rows } = await c.query(`SELECT * FROM questions WHERE id = ANY($1::bigint[])`, [ids]);
    const byId = new Map(rows.map((q) => [q.id, q]));

    let score = 0;
    for (const { qid, perm } of entry.question_order) {
      const q = byId.get(qid);
      if (!q) continue;
      const shown = given.get(qid);
      const original = shown ? perm[LETTERS.indexOf(shown)] : null; // un-shuffle
      const { isCorrect } = await recordAnswer(c, { userId: user.id, question: q, selected: original, source: 'competition', entryId: entry.id });
      if (isCorrect) score++;
      await c.query(
        `INSERT INTO competition_answers (entry_id, question_id, selected_option, is_correct) VALUES ($1, $2, $3, $4)`,
        [entry.id, qid, original, isCorrect],
      );
    }
    const { rows: [done] } = await c.query(
      `UPDATE competition_entries
          SET submitted_at = now(), score = $2,
              duration_seconds = GREATEST(1, EXTRACT(EPOCH FROM (LEAST(now(), deadline_at) - started_at))::int)
        WHERE id = $1 RETURNING score, total_questions, duration_seconds, submitted_at`,
      [entry.id, score],
    );
    return { ...done, percent: Math.round((done.score / done.total_questions) * 100) };
  });
}

const displayName = `split_part(u.full_name, ' ', 1) || ' (' || u.student_code || ')'`;

async function leaderboard(competitionId, limit = 100) {
  const comp = await getCompetition(competitionId);
  const { rows: individuals } = await db.query(
    `SELECT RANK() OVER (ORDER BY e.score DESC, e.duration_seconds ASC) AS rank,
            ${displayName} AS student, e.score, e.total_questions, e.duration_seconds
       FROM competition_entries e JOIN users u ON u.id = e.user_id
      WHERE e.competition_id = $1 AND e.submitted_at IS NOT NULL
      ORDER BY rank LIMIT $2`,
    [competitionId, limit],
  );
  const result = { competition: { id: comp.id, title: comp.title, type: comp.type, ends_at: comp.ends_at }, individuals };

  if (comp.type === 'team_weekly') {
    // Team ranking: total points of members who submitted, ties broken by average time.
    const { rows: teams } = await db.query(
      `SELECT RANK() OVER (ORDER BY SUM(e.score) DESC, AVG(e.duration_seconds) ASC) AS rank,
              t.id AS team_id, t.name AS team, COUNT(*)::int AS participants,
              SUM(e.score)::int AS total_score, ROUND(AVG(e.score), 2)::float AS avg_score
         FROM competition_entries e JOIN teams t ON t.id = e.team_id
        WHERE e.competition_id = $1 AND e.submitted_at IS NOT NULL
        GROUP BY t.id, t.name
        ORDER BY rank LIMIT $2`,
      [competitionId, limit],
    );
    result.teams = teams;
  }
  return result;
}

/** After the competition ends: the student's answers with the correct ones. */
async function review(competitionId, userId) {
  const comp = await getCompetition(competitionId);
  if (new Date() < comp.ends_at) throw forbidden('تظهر الإجابات الصحيحة بعد انتهاء المسابقة');
  const { rows } = await db.query(
    `SELECT q.id AS question_id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
            q.correct_option, q.explanation, a.selected_option, a.is_correct
       FROM competition_entries e
       JOIN competition_answers a ON a.entry_id = e.id
       JOIN questions q ON q.id = a.question_id
      WHERE e.competition_id = $1 AND e.user_id = $2`,
    [competitionId, userId],
  );
  const media = await mediaMap(rows.map((r) => r.question_id));
  return rows.map((r) => ({ ...r, media: media[r.question_id] || {} }));
}

module.exports = { getCompetition, startEntry, submitEntry, leaderboard, review };
