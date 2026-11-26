/**
 * Study tracks of the baccalaureate (الهندسة / الطب / الفنون / الآداب…), managed by the admin.
 * A subject linked to one or more tracks is open only to students of those tracks; a subject linked to none is
 * common to every track. Admins see everything.
 */
const db = require('../config/db');
const { forbidden } = require('../utils/errors');

/** SQL condition: subject `alias` is open to track $n (NULL track → common subjects only). */
const visibleTo = (alias, param) => `(NOT EXISTS (SELECT 1 FROM track_subjects ts WHERE ts.subject_id = ${alias}.id)
   OR EXISTS (SELECT 1 FROM track_subjects ts WHERE ts.subject_id = ${alias}.id AND ts.track_id = ${param}))`;

/** The student's track, or 'all' when the admin opened every track to them. */
async function userTrack(userId) {
  const { rows: [u] } = await db.query(`SELECT track_id, all_tracks FROM users WHERE id = $1`, [userId]);
  return u?.all_tracks ? 'all' : u?.track_id ?? null;
}

/** Throws unless the subject is open to this user (admins: always). */
async function assertSubjectOpen(user, subjectId) {
  if (user.role === 'admin') return;
  const track = await userTrack(user.id);
  if (track === 'all') return;
  const { rowCount } = await db.query(`SELECT 1 FROM subjects s WHERE s.id = $1 AND ${visibleTo('s', '$2::int')}`, [subjectId, track]);
  if (!rowCount) throw forbidden('هذه المادة ليست ضمن نظامك', 'SUBJECT_NOT_IN_TRACK');
}

module.exports = { visibleTo, userTrack, assertSubjectOpen };
