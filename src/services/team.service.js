const crypto = require('crypto');
const db = require('../config/db');
const { shuffle } = require('../utils/random');

const TEAM_SIZE = 4;
const AUTO_ASSIGN_LOCK = 724001; // pg advisory lock key

const randomTeamName = () => `فريق ${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

/**
 * Random grouping of students without a team (runs before the Friday competition).
 *
 *  1. Collect eligible students without a team (verified, active, with an active subscription) and shuffle them.
 *  2. First top-up existing incomplete teams that opted in (allow_auto_fill), fullest teams first,
 *     so near-complete teams are completed before new ones are formed.
 *  3. Split the remainder into ceil(n/4) new teams, dealt round-robin so sizes differ by at most 1
 *     (e.g. 9 students → 3+3+3 instead of 4+4+1).
 *
 * Runs in one transaction behind an advisory lock, so concurrent runs cannot double-assign.
 */
async function autoAssignTeams({ requireSubscription = true } = {}) {
  return db.withTransaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [AUTO_ASSIGN_LOCK]);

    const { rows } = await c.query(
      `SELECT u.id FROM users u
        WHERE u.role = 'student' AND u.is_verified AND u.is_active AND u.student_code IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = u.id)
          AND ($1::boolean = FALSE OR EXISTS (
                SELECT 1 FROM subscriptions s
                 WHERE s.user_id = u.id AND s.status = 'active' AND now() BETWEEN s.starts_at AND s.ends_at))`,
      [requireSubscription],
    );
    const pool = shuffle(rows.map((r) => r.id));
    const summary = { eligible: pool.length, added_to_existing: 0, new_teams: [] };
    if (!pool.length) return summary;

    const { rows: openTeams } = await c.query(
      `SELECT t.id, COUNT(tm.user_id)::int AS size
         FROM teams t JOIN team_members tm ON tm.team_id = t.id
        WHERE t.allow_auto_fill
        GROUP BY t.id HAVING COUNT(tm.user_id) < $1
        ORDER BY COUNT(tm.user_id) DESC, random()`,
      [TEAM_SIZE],
    );
    for (const team of openTeams) {
      // Lock the team row (same lock taken when accepting invites) and re-count under the lock.
      await c.query(`SELECT id FROM teams WHERE id = $1 FOR UPDATE`, [team.id]);
      const { rows: [{ n }] } = await c.query(`SELECT COUNT(*)::int AS n FROM team_members WHERE team_id = $1`, [team.id]);
      team.size = n;
      while (team.size < TEAM_SIZE && pool.length) {
        await c.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`, [team.id, pool.pop()]);
        team.size++;
        summary.added_to_existing++;
      }
      if (!pool.length) break;
    }

    if (pool.length) {
      const teamCount = Math.ceil(pool.length / TEAM_SIZE);
      const groups = Array.from({ length: teamCount }, () => []);
      pool.forEach((uid, i) => groups[i % teamCount].push(uid));

      for (const members of groups) {
        const { rows: [team] } = await c.query(
          `INSERT INTO teams (name, captain_id, is_auto_generated) VALUES ($1, $2, TRUE) RETURNING id, name`,
          [randomTeamName(), members[0]],
        );
        for (const uid of members) {
          await c.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`, [team.id, uid]);
        }
        summary.new_teams.push({ team_id: team.id, name: team.name, size: members.length });
      }
    }

    // Invitations addressed to students who now have a team are no longer actionable.
    await c.query(
      `UPDATE team_invites SET status = 'expired', responded_at = now()
        WHERE status = 'pending' AND invitee_id IN (SELECT user_id FROM team_members)`,
    );
    return summary;
  });
}

async function getTeamOf(userId, client = db) {
  const { rows } = await client.query(
    `SELECT t.* FROM teams t JOIN team_members tm ON tm.team_id = t.id WHERE tm.user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

module.exports = { TEAM_SIZE, autoAssignTeams, getTeamOf, randomTeamName };
